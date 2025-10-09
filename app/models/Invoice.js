// models/Invoice.js
module.exports = (sequelize, DataTypes) => {
 const Invoice = sequelize.define("Invoice", {
   id: {
     type: DataTypes.UUID,
     defaultValue: DataTypes.UUIDV4,
     primaryKey: true,
   },
   orderId: {
     type: DataTypes.UUID,
     allowNull: false,
     references: { model: "Orders", key: "id" },
   },
   userId: {
     type: DataTypes.UUID,
     allowNull: false,
   },
   totalAmount: {
     type: DataTypes.INTEGER, // en centavos USD
     allowNull: false,
   },
   currency: {
     type: DataTypes.STRING,
     allowNull: false,
     defaultValue: "usd",
   },
   issuedAt: {
     type: DataTypes.DATE,
     defaultValue: DataTypes.NOW,
   },
   pdfUrl: {
     type: DataTypes.STRING,
     allowNull: true, 
   },
   companyName:{
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "FitZone S.A"
   }
 });

 return Invoice;
};