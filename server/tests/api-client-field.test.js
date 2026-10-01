'use strict';
// The new field UI tags EVERY request it makes with X-Airro-Ui: field (the server's demo fence reads
// it); the old UI's calls stay untagged; the owner's rules screen is never tagged (an owner without Demo
// penuh must still be able to save the rules).
const path = require('path');

function loadApi() {
  const calls = [];
  const win = { AIRRO_API_BASE: 'http://x/api/v1', AIRRO_API_RETRY_MS: [0, 0] };
  global.window = win;
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.fetch = async (url, opts) => { calls.push({ url, method: opts.method, headers: opts.headers }); return { status: 200, ok: true, json: async () => ({ data: {} }), headers: { get: () => null } }; };
  jest.isolateModules(() => require(path.join(__dirname, '..', '..', 'api.js')));
  return { API: win.API, calls };
}
afterEach(() => { delete global.window; delete global.fetch; delete global.localStorage; });

it('every field call carries the header; the old calls do not', async () => {
  const { API, calls } = loadApi();
  const F = API.distribusi.field;
  await F.context('2026-10-01', 'DK 1');
  await F.board('2026-10-01', 'DK 1');
  await F.sale({ customerId: 'c', qty: 1 });
  await F.mark('d1', { status: 'terkirim' });
  await F.upload({ data: 'x' });
  await API.distribusi.deliveries.board('2026-10-01', 'DK 1');
  const tagged = calls.slice(0, 5); const old = calls[5];
  tagged.forEach((c) => expect(c.headers['X-Airro-Ui']).toBe('field'));
  expect(old.headers['X-Airro-Ui']).toBeUndefined();
  expect(calls[0].url).toBe('http://x/api/v1/distribusi/field-context?date=2026-10-01&fleet=DK%201');
  expect(calls[3]).toMatchObject({ method: 'PATCH', url: 'http://x/api/v1/distribusi/deliveries/d1' });
});
it('the owner rules screen is never tagged', async () => {
  const { API, calls } = loadApi();
  await API.distribusi.fieldRules.get();
  await API.distribusi.fieldRules.set({ ritSop: { enabled: true } });
  calls.forEach((c) => expect(c.headers['X-Airro-Ui']).toBeUndefined());
  expect(calls[1]).toMatchObject({ method: 'PUT', url: 'http://x/api/v1/distribusi/field-rules' });
});
it('the field namespace covers every adaptor method', () => {
  const { API } = loadApi();
  ['context', 'board', 'customers', 'runs', 'ritRoute', 'daySummary', 'myChangeRequests', 'mark', 'sale', 'openRun', 'closeRun', 'setLocation', 'setLocationPhoto', 'setPhone', 'addOrder', 'adjust', 'gallonDamage', 'expense', 'correct', 'void', 'reassign', 'withdraw', 'closeDay', 'upload', 'photo', 'outstanding', 'position']
    .forEach((m) => expect(typeof API.distribusi.field[m]).toBe('function'));
});
it('outstanding is a tagged read scoped to the armada', async () => {
  const { API, calls } = loadApi();
  await API.distribusi.field.outstanding('DK 1');
  expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://x/api/v1/distribusi/deliveries/outstanding?fleet=DK%201' });
  expect(calls[0].headers['X-Airro-Ui']).toBe('field');
});

it('position is a tagged POST', async () => {
  const { API, calls } = loadApi();
  await API.distribusi.field.position({ lat: 1, lng: 2, accuracy: 5 });
  expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://x/api/v1/distribusi/position' });
  expect(calls[0].headers['X-Airro-Ui']).toBe('field');
});
