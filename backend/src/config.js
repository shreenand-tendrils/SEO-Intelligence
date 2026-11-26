'use strict';
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
module.exports = {
  port: num(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  crawlerUrl: (process.env.CRAWLER_INTERNAL_URL || 'http://127.0.0.1:5002').replace(/\/$/, ''),
  internalToken: process.env.INTERNAL_API_TOKEN || '',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:8080').split(',').map((s) => s.trim()).filter(Boolean),
  jsonLimit: process.env.API_JSON_LIMIT || '1mb',
  internalJsonLimit: process.env.INTERNAL_JSON_LIMIT || '50mb',
  rateLimitPerMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 600),
  aiRateLimitPerMinute: num(process.env.AI_RATE_LIMIT_PER_MINUTE, 20),
  bodyTextCap: num(process.env.BODY_TEXT_CAP, 20000),
  logLevel: process.env.LOG_LEVEL || 'info',
};
