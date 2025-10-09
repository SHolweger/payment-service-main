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
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },

    totalAmount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "Total en centavos de USD",
    },

    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "usd",
    },

    nit: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "CF",
    },

    receipt_url: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "URL del recibo o comprobante de pago (Stripe o FEL)",
    },

    serie: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Serie fiscal (si se integra con FEL)",
    },

    numero: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Número correlativo de factura",
    },

    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "emitida",
      comment: "Estado de la factura (emitida, anulada, etc.)",
    },

    issued_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: "Fecha y hora en que se emitió la factura",
    },
  });

  Invoice.associate = (models) => {
    Invoice.belongsTo(models.Order, {
      foreignKey: "orderId",
      as: "order",
    });

    Invoice.hasMany(models.InvoiceDetail, {
      foreignKey: "invoiceId",
      as: "details",
      onDelete: "CASCADE",
    });
  };

  return Invoice;
};
