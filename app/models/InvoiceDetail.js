// models/InvoiceDetail.js
module.exports = (sequelize, DataTypes) => {
  const InvoiceDetail = sequelize.define("InvoiceDetail", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    invoiceId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "Invoices", key: "id" }, // opcional si usas migraciones
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    producto: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    cantidad: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    precio_unitario_gtq: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    precio_unitario_usd: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    subtotal_gtq: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    subtotal_usd: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
  });

  InvoiceDetail.associate = (models) => {
    InvoiceDetail.belongsTo(models.Invoice, {
      foreignKey: "invoiceId",  
      as: "invoice",            
    });
  };

  return InvoiceDetail;
};
