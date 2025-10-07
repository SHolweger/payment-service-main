const paymentController = require('../controllers/payment.controller');
const express = require('express');

class PaymentRoute {
  constructor(app) {
    this.app = app;
    this.registerRoutes();
  }

  registerRoutes() {
    const router = express.Router();

    router.post('/create-checkout-session', paymentController.createCheckoutSession);

    router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.webhook);

    this.app.use('/api/payment', router);
  }
}

module.exports = PaymentRoute;
