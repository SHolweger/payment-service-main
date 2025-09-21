const stripe = require("../config/stripe");
const Order = require("../models/Order");

exports.createCheckoutSession = async (req, res) => {
  try {
    const { items, userId } = req.body;

    // Calcular monto total (de momento hardcodeado para pruebas)
    const amount = items.reduce((acc, item) => acc + item.price * item.quantity, 0);

    // Crear orden en BD
    const order = await Order.create({
      userId,
      amount,
      currency: "usd",
      status: "pending",
    });

    const FRONTEND_URL = process.env.FRONTEND_URL;

    // Crear sesión en Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: items.map(item => ({
        price_data: {
          currency: "usd",
          product_data: { name: item.name },
          unit_amount: item.price * 100, // Stripe en centavos
        },
        quantity: item.quantity,
      })),
      mode: "payment",
      success_url: `${FRONTEND_URL}/payment/success`, 
      cancel_url: `${FRONTEND_URL}/payment/cancel`,
      payment_intent_data: {
        metadata: { orderId: order.id }
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creando sesión de pago" });
  }
};

exports.webhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Procesar el evento
  //if (event.type === "checkout.session.completed") { 
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log('Pago recibido:', paymentIntent.id);
    const session = event.data.object;
    const orderId = paymentIntent.metadata.orderId;
    console.log('Sesión de pago: ', session);
    await Order.update(
      { status: "paid" },
      { where: { id: orderId } }
    );
  }

  res.json({ received: true });
};