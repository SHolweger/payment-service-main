module.exports = (sequelize, DataTypes) => {
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
    amount_cents: {
      type: DataTypes.INTEGER,
      allowNull: false 
    },   
    amount_gtq:   { 
      type: DataTypes.INTEGER,
      allowNull: false 
    }, 
    currency: { 
      type: DataTypes.STRING,
      allowNull: false, 
      defaultValue: "usd" 
    },
    nit:{ 
      type: DataTypes.STRING, 
      allowNull: true 
    },
    status:{ 
      type: DataTypes.STRING, 
      allowNull: false, 
      defaultValue: "pending" 
    },
    stripeSessionId: { 
      type: DataTypes.STRING 
    },
    paymentIntentId: { 
      type: DataTypes.STRING 
    },
  });

  Order.associate = (models) => {
    Order.hasOne(models.Invoice, { foreignKey: "orderId", as: "invoice" });
  };

  return Order;
};
