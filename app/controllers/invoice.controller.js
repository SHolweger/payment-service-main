const { Invoice, Order } = require("../models");

exports.createInvoiceWithNit = async (req, res) => {
  try {
    const { orderId, nit } = req.body;

    if (!orderId || !nit) {
      return res.status(400).json({ error: "Falta orderId o nit" });
    }

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const existingInvoice = await Invoice.findOne({ where: { orderId } });
    if (existingInvoice) return res.status(400).json({ error: "Factura ya creada" });

    const invoice = await Invoice.create({
      orderId: order.id,
      userId: order.userId,
      totalAmount_usd: order.amount_cents / 100,
      totalAmount_gtq: order.amount_gtq,
      currency: order.currency,
      companyName: process.env.COMPANY_NAME
    });

    return res.status(201).json({ message: "Factura creada", invoice });
  } catch (err) {
    console.error("Error creando factura con NIT:", err);
    return res.status(500).json({ error: "Error interno" });
  }
};