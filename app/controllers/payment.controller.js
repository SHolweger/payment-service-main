const stripe = require("../config/stripe");
const axios = require("axios");
const { Order, Invoice, InvoiceDetail } = require("../models");

const ENVIO_BASE = process.env.ENVIO_SERVICE || "http://localhost:4001";
const RUTA_ENVIO = `${ENVIO_BASE}/envio-service/envio`;
const RUTA_ESTADO_ENVIO = `${ENVIO_BASE}/envio-service/estado_envio`;
const RUTA_ENVIO_PRODUCTO = `${ENVIO_BASE}/envio-service/envio_producto`;

const getFxGtqToUsd = () => {
  const raw = process.env.FX_GTQ_TO_USD;
  const val = Number(raw);
  if (!raw || !Number.isFinite(val) || val <= 0) {
    throw new Error("FX_GTQ_TO_USD no configurado o inválido");
  }
  return val;
};

const toUsdCentsFromGtq = (gtq, fx) => Math.round(Number(gtq) * fx * 100);
const toGtqCentsFromUsdCents = (usd_cents, fx) => Math.round(usd_cents / fx);

exports.createCheckoutSession = async (req, res) => {
  try {
    const { items = [], userId, nit, direccion_destino, costo_envio, fecha_estimada } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items vacíos." });
    }

    const compactItems = items.map((it) => ({
      n: String(it.name || "Item").slice(0, 70),
      p: Number(it.price) || 0,
      q: Number(it.quantity) || 1,
      v: Number(it.producto_talla_id || 0),
      pid: Number(it.producto_id || 0),
    }));

    const fx = getFxGtqToUsd();
    const line_items = items.map((it) => ({
      price_data: {
        currency: "usd",
        product_data: { name: String(it.name || "Item").slice(0, 200) },
        unit_amount: toUsdCentsFromGtq(Number(it.price) || 0, fx),
      },
      quantity: Number(it.quantity) || 1,
    }));

    const amount_cents = line_items.reduce(
      (acc, li) => acc + li.price_data.unit_amount * li.quantity,
      0
    );
    const amount_gtq_cents = toGtqCentsFromUsdCents(amount_cents, fx);

    const order = await Order.create({
      userId,
      amount_cents,
      currency: "usd",
      amount_gtq: amount_gtq_cents,
      status: "pending",
      nit: nit || "CF",
      stock_discounted: false,
    });

    const FRONTEND_URL = process.env.FRONTEND_URL;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      success_url: `${FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/payment/cancel?session_id={CHECKOUT_SESSION_ID}`,
      metadata: { orderId: String(order.id) },
      client_reference_id: String(userId || ""),
      payment_intent_data: {
        metadata: {
          orderId: String(order.id),
          nit: String(nit || "CF"),
          items: JSON.stringify(compactItems),
          direccion_destino: String(direccion_destino || "Sin dirección"),
          costo_envio_gtq: String(Number(costo_envio || 0)),
          fecha_estimada: String(fecha_estimada || ""),
        },
      },
    });

    await order.update({
      stripeSessionId: session.id,
      paymentIntentId:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error creando sesión de pago" });
  }
};

async function createOrGetInvoice(order, intentId) {
  let invoice = await Invoice.findOne({ where: { orderId: order.id } });
  if (invoice) return { invoice, receiptUrl: invoice.receipt_url || null };

  let receiptUrl = null;
  try {
    const pi = await stripe.paymentIntents.retrieve(intentId, {
      expand: ["latest_charge", "charges.data.balance_transaction"],
    });
    if (pi?.latest_charge && typeof pi.latest_charge === "object") {
      receiptUrl = pi.latest_charge.receipt_url || null;
    } else if (pi?.charges?.data?.length) {
      receiptUrl = pi.charges.data[0]?.receipt_url || null;
    }
  } catch (e) {
    console.warn("No se pudo expandir PaymentIntent para receipt_url:", e?.message);
  }

  invoice = await Invoice.create({
    orderId: order.id,
    userId: order.userId,
    totalAmount: order.amount_cents,
    currency: order.currency,
    nit: order.nit || "CF",
    receipt_url: receiptUrl,
    serie: "A",
    numero: Date.now().toString().slice(-6),
    issuedAt: new Date(),
  });

  return { invoice, receiptUrl };
}

async function createInvoiceDetails(invoice, order, metaItems, fxFromOrder) {
  const existing = await InvoiceDetail.count({ where: { invoiceId: invoice.id } });
  if (existing > 0) return;

  let fx = fxFromOrder;
  if (!fx || !Number.isFinite(fx)) {
    fx = order.amount_gtq > 0 ? order.amount_cents / order.amount_gtq : getFxGtqToUsd();
  }

  for (const it of metaItems) {
    const name = String(it.n || "Item").slice(0, 200);
    const qty = Number(it.q) || 1;
    const priceGTQ = Number(it.p) || 0;
    const priceUSD = priceGTQ * fx;
    const subtotalGTQ = priceGTQ * qty;
    const subtotalUSD = priceUSD * qty;

    await InvoiceDetail.create({
      invoiceId: invoice.id,
      producto: name,
      cantidad: qty,
      precio_unitario_gtq: priceGTQ.toFixed(2),
      precio_unitario_usd: priceUSD.toFixed(2),
      subtotal_gtq: subtotalGTQ.toFixed(2),
      subtotal_usd: subtotalUSD.toFixed(2),
    });
  }
}

async function decrementStockByVariant(order, metaItems) {
  const PRODUCTO_SERVICE = process.env.PRODUCTO_SERVICE;
  if (!PRODUCTO_SERVICE) {
    console.warn("PRODUCTO_SERVICE no configurado; se omite decremento de stock.");
    return true;
  }
  if (order.stock_discounted) {
    console.info("Stock ya descontado previamente. Se omite.");
    return true;
  }

  const byVariant = {};
  for (const it of metaItems) {
    const vId = Number(it.v || 0);
    const qty = Number(it.q) || 1;
    if (!vId || vId <= 0) continue;
    byVariant[vId] = (byVariant[vId] || 0) + qty;
  }

  if (Object.keys(byVariant).length === 0) {
    console.warn("No hay variantIds válidos en metadata; no se descuenta stock.");
    await order.update({ stock_discounted: true });
    return true;
  }

  const calls = Object.entries(byVariant).map(([variantId, qty]) =>
    axios.post(
      `${PRODUCTO_SERVICE}/producto-service/producto-talla-color/${variantId}/decrement`,
      { qty }
    )
  );

  const results = await Promise.allSettled(calls);
  await order.update({ stock_discounted: true });

  for (const r of results) {
    if (r.status === "rejected") {
      console.error("Fallo decremento de stock:", r.reason?.message);
    }
  }
  return results.every((r) => r.status === "fulfilled");
}

async function ensureEstadoEnvio(id_envio) {
  try {
    await axios.post(RUTA_ESTADO_ENVIO, { id_envio });
    return true;
  } catch (e) {
    console.warn("No se pudo crear Estado de Envío:", e?.message);
    return false;
  }
}

async function resolveProductIdForItem(PRODUCTO_SERVICE, it) {
  if (Number(it?.pid) > 0) return Number(it.pid);
  const variantId = Number(it?.v);
  if (!PRODUCTO_SERVICE || !variantId) return null;
  try {
    const r = await axios.get(
      `${PRODUCTO_SERVICE}/producto-service/producto-talla-color/${variantId}`
    );
    const data = r?.data;
    const productId =
      data?.producto_id || data?.id_producto || data?.producto?.id || data?.productoId || null;
    return Number(productId) || null;
  } catch (e) {
    console.warn("No se pudo resolver producto desde variante:", variantId, e?.message);
    return null;
  }
}

async function createEnvioProductoBatch(id_envio, metaItems) {
  const PRODUCTO_SERVICE = process.env.PRODUCTO_SERVICE;
  if (!Array.isArray(metaItems) || metaItems.length === 0) return;
  const payloads = [];
  for (const it of metaItems) {
    const cantidad = Number(it.q) || 1;
    let id_producto = Number(it.pid) || null;
    if (!id_producto) {
      id_producto = await resolveProductIdForItem(PRODUCTO_SERVICE, it);
    }
    if (!id_producto) continue;
    payloads.push({ id_envio, id_producto, cantidad });
  }
  if (payloads.length === 0) return;
  const calls = payloads.map((body) =>
    axios.post(RUTA_ENVIO_PRODUCTO, body, { withCredentials: true })
  );
  const results = await Promise.allSettled(calls);
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("Error creando envio_producto:", r.reason?.message);
    }
  }
}

async function createEnvioFromOrder(order, meta) {
  const direccion_final = String(meta?.direccion_destino || "Sin dirección");
  const costo_envio_gtq = Number(meta?.costo_envio_gtq || 0);
  let fecha_estimada = String(meta?.fecha_estimada || "");
  if (!fecha_estimada) {
    const hoy = new Date();
    fecha_estimada = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 3)
      .toISOString()
      .slice(0, 10);
  }
  try {
    const body = {
      id_usuario: order.userId,
      direccion_destino: direccion_final,
      costo_envio: Number.isFinite(costo_envio_gtq) ? Number(costo_envio_gtq.toFixed(2)) : 0,
      fecha_estimada,
    };
    const resp = await axios.post(RUTA_ENVIO, body, { withCredentials: true });
    const envio = resp?.data?.envio || resp?.data || null;
    if (!envio?.id_envio) return null;
    return envio;
  } catch (e) {
    console.error("Error creando Envío:", e?.message);
    return null;
  }
}

exports.webhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : null;
      if (orderId) {
        await Order.update(
          { status: "processing", stripeSessionId: session.id, paymentIntentId },
          { where: { id: orderId } }
        );
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;
      if (orderId) {
        const order = await Order.findByPk(orderId);
        if (!order) return res.json({ received: true });
        if (order.status !== "paid") {
          await order.update({ status: "paid", paymentIntentId: intent.id });
        }

        let fxFromOrder =
          order.amount_gtq > 0 ? order.amount_cents / order.amount_gtq : getFxGtqToUsd();

        let metaItems = [];
        try {
          if (intent?.metadata?.items) metaItems = JSON.parse(intent.metadata.items);
        } catch (_) {
          metaItems = [];
        }
        if (!metaItems.length && order.stripeSessionId) {
          try {
            const lineItems = await stripe.checkout.sessions.listLineItems(
              order.stripeSessionId,
              { limit: 100 }
            );
            metaItems = lineItems.data.map((li) => ({
              n: li.description || li.price?.product || "Item",
              q: li.quantity || 1,
              p:
                li.quantity && fxFromOrder
                  ? (li.amount_subtotal / 100) / fxFromOrder / li.quantity
                  : 0,
              v: 0,
              pid: 0,
            }));
          } catch (e) {
            console.warn("No se pudieron leer line_items del Session:", e?.message);
          }
        }

        const { invoice } = await createOrGetInvoice(order, intent.id);
        await createInvoiceDetails(invoice, order, metaItems, fxFromOrder);
        try {
          await decrementStockByVariant(order, metaItems);
        } catch (stockErr) {
          console.error("Error al descontar stock:", stockErr?.message);
        }

        const envio = await createEnvioFromOrder(order, {
          direccion_destino: intent?.metadata?.direccion_destino,
          costo_envio_gtq: Number(intent?.metadata?.costo_envio_gtq || 0),
          fecha_estimada: intent?.metadata?.fecha_estimada || "",
        });

        if (envio?.id_envio) {
          try {
            await createEnvioProductoBatch(envio.id_envio, metaItems);
          } catch (e) {
            console.error("Fallo creación Envío-Producto:", e?.message);
          }
          try {
            await ensureEstadoEnvio(envio.id_envio);
          } catch (e) {
            console.error("Fallo ensureEstadoEnvio:", e?.message);
          }
        } else {
          console.warn("No se creó Envío; se omite Envío-Producto y Estado.");
        }
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;
      if (orderId) {
        await Order.update(
          { status: "failed", paymentIntentId: intent.id },
          { where: { id: orderId } }
        );
      }
    }

    return res.json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.json({ received: true });
  }
};
