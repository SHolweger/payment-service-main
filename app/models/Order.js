//Order.js
// models/Order.js
module.exports = (sequelize, DataTypes) => {
 const Order = sequelize.define("Order", {
   id: {
     type: DataTypes.UUID,
     defaultValue: DataTypes.UUIDV4,
     primaryKey: true,
   },
   userId: {
     type: DataTypes.UUID,
     allowNull: false,
   },
   amount_cents: {
     type: DataTypes.INTEGER,
     allowNull: false,
   },
   nit:{
      type: DataTypes.STRING,
      allowNull: true
   },
   amount_gtq: {
     type: DataTypes.INTEGER,
     allowNull: false,
   },
   currency: {
     type: DataTypes.STRING,
     allowNull: false,
   },
   status: {
     type: DataTypes.STRING,
     allowNull: false,
     defaultValue: "pending",
   },
 });
 return Order;
};