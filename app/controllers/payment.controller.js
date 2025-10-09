// payment.controller.js
const stripe = require("../config/stripe");
const { Order } = require("../models");
const { Invoice } = require("../models");

const getFxGtqToUsd = () => {
  const raw = process.env.FX_GTQ_TO_USD;
  const val = Number(raw);
  if (!raw || !Number.isFinite(val) || val <= 0) {
    throw new Error("FX_GTQ_TO_USD no configurado o inválido");
  }
  return val; // fx = USD por 1 GTQ
};

const toUsdCentsFromGtq = (gtq, fx) => {
  const usd = Number(gtq) * fx;      // GTQ -> USD
  return Math.round(usd * 100);      // a centavos
};

// Helper nuevo: USD cents -> GTQ cents
const toGtqCentsFromUsdCents = (usd_cents, fx) => {
  // usd = usd_cents / 100
  // gtq = usd / fx
  // gtq_cents = Math.round(gtq * 100) = Math.round(usd_cents / fx)
  return Math.round(usd_cents / fx);
};

// Crear Sesión de Pago
exports.createCheckoutSession = async (req, res) => {
  try {
    const { items = [], userId } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items vacíos." });
    }

    const fx = getFxGtqToUsd();

    const line_items = items.map((it) => {
      const priceGtq = Number(it.price) || 0;
      const qty = Number(it.quantity) || 1;
      const unit_amount = toUsdCentsFromGtq(priceGtq, fx); // USD cents por unidad
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

    // <-- FIX: guardar GTQ en centavos (INTEGER)
    const amount_gtq_cents = toGtqCentsFromUsdCents(amount_cents, fx);

    const order = await Order.create({
      userId,
      amount_cents,            // USD cents (INTEGER)
      currency: "usd",
      amount_gtq: amount_gtq_cents, // INTEGER en BD
      status: "pending",
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
        metadata: { orderId: String(order.id) }
      }
    });

    await order.update({
      stripeSessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error creando sesión de pago" });
  }
};

// Webhook de Stripe con Factura
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
        console.log(`Checkout completado. Orden ${orderId} en procesamiento.`);
        await Order.update(
          {
            status: "processing",
            stripeSessionId: session.id,
            paymentIntentId,
          },
          { where: { id: orderId } }
        );
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;
      if (orderId) {
        const order = await Order.findByPk(orderId);
        if (order && order.status !== "paid") {
          console.log(`Pago confirmado para orden ${orderId}. Generando factura...`);
          await order.update({
            status: "paid",
            paymentIntentId: intent.id,
          });
          try {
            const invoice = await Invoice.create({
              orderId: order.id,
              userId: order.userId,
              totalAmount_usd: order.amount_cents / 100,      // USD en unidades
              totalAmount_gtq: order.amount_gtq / 100,        // <-- convertir de centavos a GTQ
              currency: order.currency,
              status: "issued",
            });
            console.log(`Factura generada #${invoice.id} para la orden ${order.id}`);
          } catch (invoiceErr) {
            console.error("Error creando factura:", invoiceErr);
            return res
              .status(500)
              .send({
                message: "Error al crear la factura."
              })
            
          }
        }
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;

      if (orderId) {
        console.log(`Pago fallido para la orden ${orderId}.`);
        await Order.update(
          { status: "failed", paymentIntentId: intent.id },
          { where: { id: orderId } }
        );
      }
    }

    return res.json({ received: true });
  } catch (e) {
    return res.status(500).send("Webhook handler error");
  }
};
