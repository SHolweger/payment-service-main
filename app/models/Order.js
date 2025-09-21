const { DataTypes } = require("sequelize");
const sequelize = require("../config/db.config");

const Order = sequelize.define("Order", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  currency: {
    type: DataTypes.STRING,
    defaultValue: "usd"
  },
  status: {
    type: DataTypes.ENUM("pending", "paid", "failed"),
    defaultValue: "pending"
  }
});

module.exports = Order;
