'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const bus = require('../lib/eventbus');

// GET /events — Server-Sent Events stream of { entity, action, id } change notices.
// A browser EventSource cannot send an Authorization header, so the JWT is passed
// as ?token=... (we still accept a Bearer header too, for curl/tests).
function stream(req, res) {
  const header = req.headers.authorization || '';
  const token = (header.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token;
  if (!token) { res.status(401).end(); return; }
  try { jwt.verify(token, config.jwt.secret); }
  catch (e) { res.status(401).end(); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // belt-and-suspenders: tell Nginx not to buffer
  });
  res.write('retry: 3000\n\n'); // client auto-reconnect backoff hint
  res.write(`data: ${JSON.stringify({ entity: 'hello', action: 'connected', id: null })}\n\n`);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const remove = bus.addClient(res);
  req.on('close', remove);
}

module.exports = { stream };
