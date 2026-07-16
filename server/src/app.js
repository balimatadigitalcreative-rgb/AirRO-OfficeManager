'use strict';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config/env');
const routes = require('./routes');
const { apiLimiter } = require('./middleware/rateLimiters');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  // Nginx is the single proxy in front (127.0.0.1). Trust exactly ONE hop so req.ip is the real
  // client IP from X-Forwarded-For (rate limits + logs key on the client, not on Nginx).
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '12mb' })); // shared-state blobs can include attached photos
  if (!config.isTest) app.use(morgan('dev'));

  // General API rate guard (SSE + health exempt). Login/forgot get their own stricter limiters.
  app.use('/api/v1', apiLimiter, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
