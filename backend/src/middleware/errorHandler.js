'use strict';
const { ZodError } = require('zod');
const { Prisma } = require('@prisma/client');
const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let code = err.code && typeof err.code === 'string' && status < 500 ? err.code : 'internal_error';
  let message = status < 500 ? err.message : 'Internal server error';
  let details = err.details;
  if (err instanceof ZodError) {
    status = 400; code = 'validation_error'; message = 'Invalid request';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') { status = 404; code = 'not_found'; message = 'Resource not found'; }
    else if (err.code === 'P2002') { status = 409; code = 'conflict'; message = 'Resource already exists'; }
  } else if (err.type === 'entity.too.large') {
    status = 413; code = 'payload_too_large'; message = 'Request body too large';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; code = 'invalid_json'; message = 'Malformed JSON body';
  }
  if (status >= 500) logger.error('request failed', { method: req.method, path: req.path, error: err.message, stack: err.stack });
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
};
