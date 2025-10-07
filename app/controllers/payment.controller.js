const stripe = require("../config/stripe");
const { Order } = require("../models");

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
      const orderId = session.metadata?.orderId || null;
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : null;

      if (orderId) {
        await Order.update(
          {
            status: session.payment_status === "paid" ? "paid" : "processing",
            stripeSessionId: session.id,
            paymentIntentId
          },
          { where: { id: orderId } }
        );
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId || null;

      if (orderId) {
        await Order.update(
          { status: "paid", paymentIntentId: intent.id },
          { where: { id: orderId } }
        );
      } else {
        await Order.update(
          { status: "paid" },
          { where: { paymentIntentId: intent.id } }
        );
      }
    }

    return res.json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).send("Webhook handler error");
  }
};
