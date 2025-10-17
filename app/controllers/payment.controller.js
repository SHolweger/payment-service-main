const stripe = require("../config/stripe");
const axios = require("axios");
const { Order, Invoice, InvoiceDetail } = require("../models");

const ENVIO_BASE = process.env.ENVIO_SERVICE || "http://localhost:4001";
const PRODUCTO_SERVICE = process.env.PRODUCTO_SERVICE || "http://localhost:4003";
const CARRITO_SERVICE=process.env.WISHLIST_SERVICE  
const TOKEN_SERVICIOS = process.env.SERVICES_TOKEN || null;

const RUTA_ENVIO = `${ENVIO_BASE}/envio-service/envio`;
const RUTA_ESTADO_ENVIO = `${ENVIO_BASE}/envio-service/estado_envio`;
const RUTA_ENVIO_PRODUCTO = `${ENVIO_BASE}/envio-service/envio_producto`;


const http = axios.create({
  timeout: 10000,
  validateStatus: (s) => s < 500,
});

const headers = TOKEN_SERVICIOS ? { Authorization: `Bearer ${TOKEN_SERVICIOS}` } : {};

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


function buildShippingMeta({ meta = {}, order }) {
  const om = order?.shipping_meta || {};

  const direccion_destino =
    (typeof meta.direccion_destino === "string" && meta.direccion_destino.trim()) ||
    (typeof om.direccion_destino === "string" && om.direccion_destino.trim()) ||
    "Sin dirección";


  const costo_envio_gtq =
    meta.costo_envio_gtq != null
      ? Number(meta.costo_envio_gtq)
      : om.costo_envio_gtq != null
      ? Number(om.costo_envio_gtq)
      : om.costo_envio != null
      ? Number(om.costo_envio)
      : 0;

  let fecha_estimada =
    (typeof meta.fecha_estimada === "string" && meta.fecha_estimada) ||
    (typeof om.fecha_estimada === "string" && om.fecha_estimada) ||
    "";

  if (!fecha_estimada) {
    const hoy = new Date();
    fecha_estimada = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 3)
      .toISOString()
      .slice(0, 10);
  } else if (fecha_estimada.includes("T")) {
    fecha_estimada = fecha_estimada.slice(0, 10);
  }

  return {
    direccion_destino,
    costo_envio_gtq: Number.isFinite(costo_envio_gtq) ? costo_envio_gtq : 0,
    fecha_estimada,
  };
}


exports.createCheckoutSession = async (req, res) => {
  try {
    const { items = [], userId, nit, direccion_destino, costo_envio, fecha_estimada } = req.body;

    console.log("[checkout] BODY recibido =>", {
      userId,
      nit,
      direccion_destino,
      costo_envio,
      fecha_estimada,
      items_count: Array.isArray(items) ? items.length : 0,
    });

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
      shipping_meta: {
        direccion_destino: direccion_destino || "Sin dirección",
        costo_envio_gtq: Number(costo_envio || 0),
        fecha_estimada: fecha_estimada || "",
      },
    });

    console.log("[checkout] METADATA a enviar =>", {
      orderId: order.id,
      nit,
      direccion_destino,
      costo_envio,
      fecha_estimada,
      items_len: items.length,
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
    console.error("[checkout] ERROR general:", err);
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
  if (!PRODUCTO_SERVICE) return true;
  if (order.stock_discounted) return true;

  const byVariant = {};
  for (const it of metaItems) {
    const vId = Number(it.v || 0);
    const qty = Number(it.q) || 1;
    if (!vId || vId <= 0) continue;
    byVariant[vId] = (byVariant[vId] || 0) + qty;
  }

  if (Object.keys(byVariant).length === 0) {
    await order.update({ stock_discounted: true });
    return true;
  }

  const calls = Object.entries(byVariant).map(async ([variantId, qty]) => {
    const url = `${PRODUCTO_SERVICE}/producto-service/producto-talla/${variantId}/decrement`;
    console.log("[stock] POST", url, { qty });
    try {
      const r = await http.post(url, { qty }, { headers });
      console.log("[stock] response", r.status, r.data);
      return r.status;
    } catch (e) {
      console.error("[stock] ERROR", e.response?.status, e.response?.data || e.message);
      throw e;
    }
  });

  const results = await Promise.allSettled(calls);
  await order.update({ stock_discounted: true });

  return results.every((r) => r.status === "fulfilled");
}

async function ensureEstadoEnvio(id_envio) {
  try {
    await http.post(RUTA_ESTADO_ENVIO, { id_envio }, { headers });
    return true;
  } catch (e) {
    console.warn("No se pudo crear Estado de Envío:", e?.message);
    return false;
  }
}

async function createEnvioProductoBatch(id_envio, metaItems) {
  if (!Array.isArray(metaItems) || metaItems.length === 0) return;
  const payloads = [];
  for (const it of metaItems) {
    const cantidad = Number(it.q) || 1;
    const id_producto = Number(it.pid) || null;
    if (!id_producto) continue;
    payloads.push({ id_envio, id_producto, cantidad });
  }
  if (payloads.length === 0) return;
  const calls = payloads.map((body) => http.post(RUTA_ENVIO_PRODUCTO, body, { headers }));
  await Promise.allSettled(calls);
}
async function deleteCarritoUser(order){
  if(!order){
    console.log("No viene la orden")
    return;
  }
  if(!WISHLIST_SERVICE){
    console.log("No se pudo importar la ruta del carrito")
    return;
  }
  const user_id= order.userId;
  if(!user_id){
    console.log("No se guardo el user_id")
    return;
  }
  const response_carrito=await axios.delete(`${CARRITO_SERVICE}/cart-wishlist-service/cart/clear/${user_id}`,
    {
      withCredentials: true
    }
  )
  if(response_carrito.status===200 || response_carrito.status===204){
    console.log("Carrito limpiado ok")
    return true;
  }else{
    console.warn("Fallo al limpiar el carrito");
    return false;
  }
}
async function createEnvioFromOrder(order, meta) {
  console.log("[envio] meta recibido =>", {
    direccion_destino: meta?.direccion_destino,
    costo_envio_gtq: meta?.costo_envio_gtq,
    fecha_estimada: meta?.fecha_estimada,
  });

  const direccion_final = String(meta?.direccion_destino || "Sin dirección").trim() || "Sin dirección";
  const rawCosto = Number(meta?.costo_envio_gtq || 0);
  const costo_final = Number.isFinite(rawCosto) && rawCosto > 0 ? rawCosto : 0.01;

  let fecha_estimada = String(meta?.fecha_estimada || "");
  if (!fecha_estimada) {
    const hoy = new Date();
    fecha_estimada = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 3)
      .toISOString()
      .slice(0, 10);
  } else if (fecha_estimada.includes("T")) {
    fecha_estimada = fecha_estimada.slice(0, 10);
  }

  const body = {
    id_usuario: order.userId,
    direccion_destino: direccion_final,
    costo_envio: Number(costo_final.toFixed(2)),
    fecha_estimada,
  };

  console.log("[envio] POST", RUTA_ENVIO, body);
  try {
    const resp = await http.post(RUTA_ENVIO, body, { headers });
    console.log("[envio] response", resp.status, resp.data);
    const envio = resp?.data?.envio || resp?.data || null;
    if (!envio?.id_envio) return null;
    return envio;
  } catch (e) {
    console.error("[envio] ERROR", e.response?.status, e.response?.data || e.message);
    return null;
  }
}



exports.webhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
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

      console.log("[webhook] payment_intent.succeeded =>", intent.id);
      console.log("[webhook] metadata recibido =>", intent.metadata);

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
        console.log("[webhook] metaItems parsed len:", metaItems.length);

        
        const shippingMeta = buildShippingMeta({ meta: intent?.metadata || {}, order });
        console.log("[webhook] shippingMeta usado =>", shippingMeta);

        const { invoice } = await createOrGetInvoice(order, intent.id);
        await createInvoiceDetails(invoice, order, metaItems, fxFromOrder);
        await decrementStockByVariant(order, metaItems);

        const envio = await createEnvioFromOrder(order, shippingMeta);

        if (envio?.id_envio) {
          await createEnvioProductoBatch(envio.id_envio, metaItems);
          await ensureEstadoEnvio(envio.id_envio);
          await deleteCarritoUser(order);
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
