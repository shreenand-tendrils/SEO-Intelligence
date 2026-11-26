'use strict';
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}
const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
const badRequest = (msg, details) => new ApiError(400, 'bad_request', msg, details);
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data, meta, status = 200) => res.status(status).json(meta ? { data, meta } : { data });

function pageParams(q, { defaultSize = 50, maxSize = 500 } = {}) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(q.pageSize || q.page_size, 10) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
const pageMeta = ({ page, pageSize }, total) => ({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
module.exports = { ApiError, notFound, badRequest, asyncHandler, ok, pageParams, pageMeta };
