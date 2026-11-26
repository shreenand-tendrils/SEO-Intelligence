'use strict';
const express = require('express');
const { asyncHandler: h } = require('../utils/http');
const c = require('../controllers/internalController');

const r = express.Router();
r.post('/crawls/:id/progress', h(c.progress));
r.post('/crawls/:id/pages', h(c.pages));
r.post('/crawls/:id/complete', h(c.complete));
r.post('/crawls/:id/fail', h(c.fail));
r.get('/crawls/:id/export', h(c.exportCrawl));
r.get('/crawls', h(c.listCrawls));
r.post('/ai/conversations', h(c.createConversation));
r.get('/ai/conversations', h(c.listConversations));
r.get('/ai/conversations/:id', h(c.getConversation));
r.delete('/ai/conversations/:id', h(c.deleteConversation));
r.post('/ai/conversations/:id/messages', h(c.addMessage));
module.exports = r;
