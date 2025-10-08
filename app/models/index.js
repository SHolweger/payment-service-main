// models/index.js
const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db.config");

// Importa la definición (que exporta una función)
const OrderModel = require("./Order");
const InvoiceModel = require("./Invoice"); // si tu modelo se llama Invoice.js

const db = {};
db.sequelize = sequelize;

// Ejecuta la definición para obtener el modelo inicializado
db.Order = OrderModel(sequelize, DataTypes);
db.Invoice = InvoiceModel(sequelize, DataTypes);

// Relación 1:1 entre Order e Invoice
db.Order.hasOne(db.Invoice, { foreignKey: "orderId" });
db.Invoice.belongsTo(db.Order, { foreignKey: "orderId" });

module.exports = db;