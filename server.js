//server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./app/models');
const PaymentRoute = require('./app/routes/payment.routes.js');
require("dotenv").config();


// Variables de entorno (puedes usar dotenv si prefieres)
const APP_PORT = process.env.APP_PORT || 8082; // distinto al resto de microservicios
const API_GATEWAY_URL = process.env.API_GATEWAY_URL;

class Server {
  constructor() {
    this.app = express();
    this.port = APP_PORT;

    // Middleware especial para el webhook (Stripe necesita el body crudo en ese endpoint)
    this.app.use((req, res, next) => {
      if (req.originalUrl === '/api/payment/webhook') {
        next(); // raw body lo maneja la ruta directamente
      } else {
        express.json()(req, res, next);
      }
    });

    this.configureMiddlewares();
    this.configureRoutes();
    this.connectDatabase();
  }

  configureMiddlewares() {
    this.app.use(cors({
      origin: API_GATEWAY_URL,
      credentials: true
    }));
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
  }

  configureRoutes() {
    new PaymentRoute(this.app);
  }

  async connectDatabase() {
    try {
      await db.sequelize.sync({ alter: true }); 
      console.log('Base de datos conectada y sincronizada.');

      const tables = await db.sequelize.getQueryInterface().showAllTables();
      console.log('Tablas en la base de datos:', tables);
    } catch (error) {
      console.error('Error al conectar con la base de datos:', error);
    }
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`Servicio de Pago corriendo en el puerto ${this.port}`);
    });
  }
}

const server = new Server();
server.start();
