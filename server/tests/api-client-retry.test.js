'use strict';
/*
 * THE BROWSER API CLIENT RIDES OUT A MOMENT OF OVERLOAD.
 *
 * "Dashboard gagal dimuat" happened because one refused request was final: a 429 (budget used up
 * for a minute) or a 502/503/504 (the backend restarting) turned straight into an error screen,
 * everywhere at once. A READ is now retried a couple of times with a short pause; a WRITE never is —
 * repeating a POST/PUT/PATCH/DELETE the server may already have applied could double it.
 */
const path = require('path');

function loadApi(responses) {
  const calls = [];
  const queue = responses.slice();
  const win = { AIRRO_API_BASE: 'http://x/api/v1', AIRRO_API_RETRY_MS: [0, 0] };
  global.window = win;
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts.method });
    const r = queue.length > 1 ? queue.shift() : queue[0];
    if (r === 'offline') throw new TypeError('Failed to fetch');
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body || {}, headers: { get: (h) => (r.headers || {})[String(h).toLowerCase()] || null } };
  };
  jest.isolateModules(() => require(path.join(__dirname, '..', '..', 'api.js')));
  return { API: win.API, calls };
}
afterEach(() => { delete global.window; delete global.fetch; delete global.localStorage; });

describe('reads are retried through a momentary failure', () => {
  it('429 then 200 → the caller just gets the data', async () => {
    const { API, calls } = loadApi([{ status: 429, body: { error: { message: 'Terlalu banyak' } } }, { status: 200, body: { data: [1] } }]);
    await expect(API.entries.list('limit=5')).resolves.toEqual({ data: [1] });
    expect(calls).toHaveLength(2);
  });

  it('a backend restart (502, 503) is ridden out', async () => {
    const { API, calls } = loadApi([{ status: 502 }, { status: 503 }, { status: 200, body: { ok: 1 } }]);
    await expect(API.entries.list()).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(3);
  });

  it('a dropped connection is retried too', async () => {
    const { API, calls } = loadApi(['offline', { status: 200, body: { ok: 1 } }]);
    await expect(API.entries.list()).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it('gives up after the retries and reports the real error', async () => {
    const { API, calls } = loadApi([{ status: 503, body: { error: { message: 'down' } } }]);
    await expect(API.entries.list()).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(3);                 // first try + 2 retries
  });

  it('a real answer (404, 403, 400) is never retried', async () => {
    const { API, calls } = loadApi([{ status: 404, body: { error: { message: 'x' } } }]);
    await expect(API.entries.list()).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(1);
  });
});

describe('writes are never repeated', () => {
  it('a POST that gets 503 fails once — it may already have been applied', async () => {
    const { API, calls } = loadApi([{ status: 503 }, { status: 200 }]);
    await expect(API.entries.create({ a: 1 })).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
  });
});
