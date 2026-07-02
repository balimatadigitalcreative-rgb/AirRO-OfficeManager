'use strict';
// In-process Server-Sent-Events hub.
//
// This works because the API runs as a SINGLE fork instance (see
// deploy/ecosystem.config.js) — every EventSource client connects to the same
// Node process, so an in-memory registry can broadcast to all of them without any
// external broker. If this is ever scaled to multiple workers/instances, swap this
// registry for a shared pub/sub (Redis, Postgres LISTEN/NOTIFY) — the broadcast()
// call sites stay the same.
const clients = new Set();

function addClient(res) {
  clients.add(res);
  return () => clients.delete(res);
}

// Push a compact change notice { entity, action, id } to every connected client.
// Kept intentionally tiny — the client re-fetches the affected entity over REST.
function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch (e) { /* broken pipe; cleaned up on 'close' */ }
  }
}

function clientCount() { return clients.size; }

// Heartbeat comment keeps idle connections from being closed by proxies/timeouts.
const heartbeat = setInterval(() => {
  for (const res of clients) { try { res.write(': ping\n\n'); } catch (e) {} }
}, 25000);
heartbeat.unref();

module.exports = { addClient, broadcast, clientCount };
