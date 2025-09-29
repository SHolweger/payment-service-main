// controllers/payment.controller.js
const stripe = require("../config/stripe");
const { Order } = require("../models");

// convierte Q -> cents USD usando env FX_GTQ_TO_USD (1 GTQ = X USD)
const getFxGtqToUsd = () => {
  const raw = process.env.FX_GTQ_TO_USD;
  const val = Number(raw);
  if (!raw || !Number.isFinite(val) || val <= 0) {
    throw new Error("FX_GTQ_TO_USD no configurado o inválido");
  }
  return val; // USD por 1 GTQ
};

const toUsdCentsFromGtq = (gtq, fx) => {
  const usd = Number(gtq) * fx;              // USD
  return Math.round(usd * 100);              // cents USD (entero)
};

exports.createCheckoutSession = async (req, res) => {
  try {
    const { items = [], userId } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items vacíos." });
    }

    const fx = getFxGtqToUsd();

    // Construir line_items ya convertidos a USD cents
    const line_items = items.map((it) => {
      const priceGtq = Number(it.price) || 0;      // precio viene en GTQ desde el front
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

    // Total en cents USD (suma por línea para coincidir con Stripe)
    const amount_cents = line_items.reduce((acc, li) => {
      return acc + (li.price_data.unit_amount * li.quantity);
    }, 0);

    // Crear orden en BD en USD (centavos)
    const order = await Order.create({
      userId,
      amount_cents,
      currency: "usd",
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
    });

    await order.update({
      stripeSessionId: session.id,
      paymentIntentId: session.payment_intent || null,
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
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        const orderId = session.metadata?.orderId;
        if (orderId) {
          await Order.update(
            { status: "paid", stripeSessionId: session.id, paymentIntentId: session.payment_intent },
            { where: { id: orderId } }
          );
        }
      }
    }
    return res.json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).send("Webhook handler error");
  }
};

