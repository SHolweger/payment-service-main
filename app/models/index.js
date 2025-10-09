const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db.config");
const OrderModel = require("./Order");
const InvoiceModel = require("./Invoice");
const InvoiceDetailModel = require("./InvoiceDetail");


const db = {};
db.sequelize = sequelize;
db.Sequelize = Sequelize;

db.Order = OrderModel(sequelize, DataTypes);
db.Invoice = InvoiceModel(sequelize, DataTypes);
db.InvoiceDetail = InvoiceDetailModel(sequelize, DataTypes);

db.Order.hasOne(db.Invoice, {
  foreignKey: "orderId",
  as: "invoice",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

db.Invoice.belongsTo(db.Order, {
  foreignKey: "orderId",
  as: "order",
});

db.Invoice.hasMany(db.InvoiceDetail, {
  foreignKey: "invoiceId",
  as: "details",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

db.InvoiceDetail.belongsTo(db.Invoice, {
  foreignKey: "invoiceId",
  as: "invoice",
});

module.exports = db;
