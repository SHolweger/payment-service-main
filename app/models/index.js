// models/index.js
const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db.config");

// Importa la definición (que exporta una función)
const OrderModel = require("./Order");

const db = {};
db.sequelize = sequelize;

// Ejecuta la definición para obtener el modelo inicializado
db.Order = OrderModel(sequelize, DataTypes);

module.exports = db;
