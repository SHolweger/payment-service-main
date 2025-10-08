//payment.controller.js
const stripe = require("../config/stripe");
const { Order } = require("../models");
const { Invoice } = require("../models");

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

//Crear Sesión de Pago
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

   const amount_gtq = amount_cents / 100 / fx;
   const order = await Order.create({
     userId,
     amount_cents,
     currency: "usd",
     amount_gtq,
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

//Webhook de Stripe con Factura
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
   // --- Evento: Checkout completado (cliente terminó el flujo de pago) ---
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
   // --- Evento: Pago exitoso (Stripe confirma el cobro) ---
   if (event.type === "payment_intent.succeeded") {
     const intent = event.data.object;
     const orderId = intent.metadata?.orderId;
     if (orderId) {
       const order = await Order.findByPk(orderId);
       if (order && order.status !== "paid") {
         console.log(`Pago confirmado para orden ${orderId}. Generando factura...`);
         // Marcar como pagada
         await order.update({
           status: "paid",
           paymentIntentId: intent.id,
         });
         // Crear factura asociada
         try {
           const invoice = await Invoice.create({
             orderId: order.id,
             userId: order.userId,
             totalAmount_usd: order.amount_cents / 100,
             totalAmount_gtq: order.amount_gtq, // asegúrate de tener este campo en Order
             currency: order.currency,
             status: "issued",
           });
           console.log(`Factura generada #${invoice.id} para la orden ${order.id}`);
         } catch (invoiceErr) {
           console.error("Error creando factura:", invoiceErr);
         }
       }
     }
   }
   // --- Evento: Pago fallido ---
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
   // Confirmar recepción del webhook
   return res.json({ received: true });
 } catch (e) {
   console.error("Webhook handler error:", e);
   return res.status(500).send("Webhook handler error");
 }
};
