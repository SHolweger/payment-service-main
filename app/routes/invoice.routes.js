const express = require("express");
const invoiceController = require("../controllers/invoice.controller");

class InvoiceRoute {
  constructor(app) {
    this.app = app;
    this.registerRoutes();
  }

  registerRoutes() {
    const router = express.Router();
    router.post("/create", invoiceController.createInvoiceWithNit);
    this.app.use("/api/invoice", router);
  }
}

module.exports = InvoiceRoute;