const sequelize = require("../config/db.config"); // tu instancia hardcodeada
const Order = require("./Order");

const db = {};
db.sequelize = sequelize;
db.Order = Order;

module.exports = db;
