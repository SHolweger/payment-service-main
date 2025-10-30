const express = require('express');
const paymentController = require('../controllers/payment.controller');

class PaymentRoute {
  constructor(app) {
    this.app = app;
    this.app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

    this.registerRoutes();
  }

  registerRoutes() {
    const router = express.Router();

    /**
     * @openapi
     * tags:
     *   - name: Payment
     *     description: Integración de pagos con Stripe Checkout
     */

    /**
     * @openapi
     * /api/payment/create-checkout-session:
     *   post:
     *     summary: Crear sesión de pago (Stripe Checkout)
     *     tags: [Payment]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [userId, items]
     *             properties:
     *               userId:
     *                 type: string
     *                 example: "a0f1a0b2-1c2d-3e4f-5a6b-7c8d9e0f"
     *               nit:
     *                 type: string
     *                 example: "CF"
     *               direccion_destino:
     *                 type: string
     *                 example: "2a calle 5-10, Zona 1, Antigua Guatemala"
     *               costo_envio:
     *                 type: number
     *                 example: 35.50
     *               fecha_estimada:
     *                 type: string
     *                 example: "2025-11-06"
     *               items:
     *                 type: array
     *                 items:
     *                   type: object
     *                   required: [name, price, quantity]
     *                   properties:
     *                     name: { type: string, example: "Playera Tech DryFit" }
     *                     price: { type: number, example: 129.99, description: "Precio en GTQ" }
     *                     quantity: { type: integer, example: 2 }
     *                     producto_talla_id: { type: integer, example: 101 }
     *                     producto_id: { type: integer, example: 55 }
     *     responses:
     *       200:
     *         description: URL de Stripe Checkout creada correctamente
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 url:
     *                   type: string
     *                   example: "https://checkout.stripe.com/c/pay/cs_test_..."
     *       400:
     *         description: Solicitud inválida (items vacíos, etc.)
     *       500:
     *         description: Error creando sesión de pago
     */
    router.post('/create-checkout-session', paymentController.createCheckoutSession);

    /**
     * @openapi
     * /api/payment/webhook:
     *   post:
     *     summary: Webhook de Stripe
     *     description: |
     *       Debe recibir el cuerpo **RAW** (`application/json`) para validar la firma
     *       con `stripe.webhooks.constructEvent`. No requiere autenticación.
     *     tags: [Payment]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: string
     *             description: Cuerpo RAW enviado por Stripe (no parseado por JSON parser)
     *     responses:
     *       200:
     *         description: Evento procesado
     *       400:
     *         description: Firma inválida o payload malformado
     */
    router.post('/webhook', paymentController.webhook);

    this.app.use('/api/payment', router);
  }
}

module.exports = PaymentRoute;
