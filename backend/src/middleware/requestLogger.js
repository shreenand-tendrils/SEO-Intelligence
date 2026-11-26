'use strict';
const logger = require('../utils/logger');

module.exports = function requestLogger(req, res, next) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (req.path.startsWith('/internal/') && res.statusCode < 400 && req.path.endsWith('/progress')) return;
    logger.info('http', { method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) });
  });
  next();
};
