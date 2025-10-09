const stripe = require("../config/stripe");
const { Order, Invoice, InvoiceDetail } = require("../models");

const getFxGtqToUsd = () => {
  const raw = process.env.FX_GTQ_TO_USD;
  const val = Number(raw);
  if (!raw || !Number.isFinite(val) || val <= 0) {
    throw new Error("FX_GTQ_TO_USD no configurado o inválido");
  }
  return val;
};

const toUsdCentsFromGtq = (gtq, fx) => {
  const usd = Number(gtq) * fx;     
  return Math.round(usd * 100);     
};

const toGtqCentsFromUsdCents = (usd_cents, fx) => {
  return Math.round(usd_cents / fx);
};
exports.createCheckoutSession = async (req, res) => {
  try {
    const { items = [], userId, nit } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items vacíos." });
    }

    const compactItems = items.map((it) => ({
      n: String(it.name || "Item").slice(0, 70), 
      p: Number(it.price) || 0,                  
      q: Number(it.quantity) || 1,              
    }));

    const fx = getFxGtqToUsd();

    const line_items = items.map((it) => {
      const priceGtq = Number(it.price) || 0;
      const qty = Number(it.quantity) || 1;
      const unit_amount = toUsdCentsFromGtq(priceGtq, fx);
      return {
        price_data: {
          currency: "usd",
          product_data: { name: String(it.name || "Item").slice(0, 200) },
          unit_amount,
        },
        quantity: qty,
      };
    });

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

        let invoice = await Invoice.findOne({ where: { orderId } });
        if (!invoice) {
          let receiptUrl = null;
          try {
            const pi = await stripe.paymentIntents.retrieve(intent.id, {
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
          });
        }

        const detailCount = await InvoiceDetail.count({ where: { invoiceId: invoice.id } });
        if (detailCount === 0) {
          let fxFromOrder = null;
          if (order.amount_gtq > 0) {
            fxFromOrder = order.amount_cents / order.amount_gtq; 
          } else {
            fxFromOrder = getFxGtqToUsd();
          }

          let metaItems = [];
          try {
            if (intent?.metadata?.items) {
              metaItems = JSON.parse(intent.metadata.items);
            }
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
              }));
            } catch (e) {
              console.warn("No se pudieron leer line_items del Session:", e?.message);
            }
          }

          for (const it of metaItems) {
            const name = String(it.n || "Item").slice(0, 200);
            const qty = Number(it.q) || 1;
            const priceGTQ = Number(it.p) || 0; 
            const priceUSD = priceGTQ * fxFromOrder;

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
