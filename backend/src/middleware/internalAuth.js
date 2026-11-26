'use strict';
const crypto = require('crypto');
const config = require('../config');
const { ApiError } = require('../utils/http');

// Crawler -> backend calls. The internal router is never exposed by the
// frontend proxy; with INTERNAL_API_TOKEN set every call must carry it.
module.exports = function internalAuth(req, _res, next) {
  const want = config.internalToken;
  if (!want) {
    if (config.nodeEnv === 'production') return next(new ApiError(503, 'internal_token_missing', 'INTERNAL_API_TOKEN is not configured'));
    return next();
  }
  const got = String(req.get('X-Internal-Token') || '');
  const a = Buffer.from(got); const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return next(new ApiError(401, 'unauthorized', 'Invalid internal token'));
  return next();
};
