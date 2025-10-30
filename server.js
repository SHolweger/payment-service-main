require('dotenv').config();

const express = require('express');
const cors = require('cors');
const db = require('./app/models');
const PaymentRoute = require('./app/routes/payment.routes.js');

// OpenAPI + Scalar
const swaggerJsdoc = require('swagger-jsdoc');
const { apiReference } = require('@scalar/express-api-reference');

const APP_PORT = process.env.APP_PORT || 8082;
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || '*';

class Server {
  constructor() {
    this.app = express();
    this.port = APP_PORT;

    this.app.use((req, res, next) => {
      if (req.originalUrl === '/api/payment/webhook') {
        return express.raw({ type: 'application/json' })(req, res, next);
      }
      return express.json({ limit: '1mb' })(req, res, next);
    });

    this.configureMiddlewares();
    this.configureOpenAPI();   
    this.configureRoutes();
    this.connectDatabase();
  }

  configureMiddlewares() {
    this.app.set('trust proxy', 1);
    this.app.use(cors({
      origin: API_GATEWAY_URL,
      credentials: true,
      methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
      allowedHeaders: ['Content-Type','Authorization','Stripe-Signature']
    }));
    this.app.use(express.urlencoded({ extended: true }));
  }

  configureOpenAPI() {
    const openapiDefinition = {
      openapi: '3.0.3',
      info: {
        title: 'Payment Service',
        version: '1.0.0',
        description: 'Servicio de pagos con Stripe (Checkout + Webhook).',
      },
      servers: [{ url: `http://localhost:${this.port}/api/payment` }],
      components: {
        securitySchemes: {
          stripeSignature: { type: 'apiKey', in: 'header', name: 'Stripe-Signature' }
        },
        schemas: {
          CheckoutItem: {
            type: 'object',
            required: ['name','price','quantity'],
            properties: {
              name: { type: 'string', example: 'Playera Tech Dry' },
              price: { type: 'number', example: 199.99 },
              quantity: { type: 'integer', example: 2, minimum: 1 },
              producto_talla_id: { type: 'integer', example: 315 },
              producto_id: { type: 'integer', example: 77 }
            }
          },
          CreateCheckoutBody: {
            type: 'object',
            required: ['items','userId'],
            properties: {
              userId: { type: 'string', example: 'c3f0f2e2-1b1a-4c4f-9f0e-abc123' },
              nit: { type: 'string', example: 'CF' },
              direccion_destino: { type: 'string', example: '4a av 10-20 Z.1, Antigua' },
              costo_envio: { type: 'number', example: 25.00 },
              fecha_estimada: { type: 'string', example: '2025-11-08' },
              items: { type: 'array', items: { $ref: '#/components/schemas/CheckoutItem' } }
            }
          },
          CheckoutResponse: {
            type: 'object',
            properties: { url: { type: 'string', example: 'https://checkout.stripe.com/c/pay_...' } }
          },
          ErrorResponse: {
            type: 'object',
            properties: { error: { type: 'string', example: 'Mensaje de error' } }
          }
        }
      },
      paths: {
        '/create-checkout-session': {
          post: {
            tags: ['Checkout'],
            summary: 'Crear sesión de Stripe Checkout',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateCheckoutBody' } } }
            },
            responses: {
              200: { description: 'URL de Stripe Checkout', content: { 'application/json': { schema: { $ref: '#/components/schemas/CheckoutResponse' } } } },
              400: { description: 'Solicitud inválida', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
              500: { description: 'Error servidor', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
            }
          }
        },
        '/webhook': {
          post: {
            tags: ['Webhook'],
            summary: 'Webhook de Stripe',
            description: 'Recibe eventos de Stripe (RAW body). **No probar desde el navegador**. Usa Stripe CLI.',
            security: [{ stripeSignature: [] }],
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } }
            },
            responses: {
              200: { description: 'Recibido' },
              400: { description: 'Firma inválida' }
            }
          }
        }
      }
    };

    const openapi = swaggerJsdoc({ definition: openapiDefinition, apis: [] });

    this.app.get('/openapi.json', (_req, res) => res.json(openapi));

    this.app.use('/docs', apiReference({
      spec: { url: '/openapi.json' }
    }));

    console.log(`Docs:  http://localhost:${this.port}/docs`);
    console.log(`Spec:  http://localhost:${this.port}/openapi.json`);
  }

  configureRoutes() {
    this.app.get('/health', (_req, res) => res.json({ ok: true }));
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
