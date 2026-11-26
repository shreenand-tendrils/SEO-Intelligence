'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const requestLogger = require('./middleware/requestLogger');
const internalAuth = require('./middleware/internalAuth');
const errorHandler = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(compression());
  app.use(requestLogger);

  // Internal API (crawler service only). Larger body limit for page chunks.
  app.use('/internal', internalAuth, express.json({ limit: config.internalJsonLimit }), require('./routes/internal'));

  app.use('/api', cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    maxAge: 600,
  }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: config.rateLimitPerMinute, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests' } } }));
  app.use('/api', express.json({ limit: config.jsonLimit }));
  app.use('/api', require('./routes/api'));
  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
