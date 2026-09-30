'use strict';
/*
 * "DASHBOARD GAGAL DIMUAT" ACROSS EVERY MODULE — the request volume behind it.
 *
 * The API allows a fixed number of requests per minute. It used to be counted per IP, so a whole
 * office (one public IP) and phones on mobile data (carrier NAT) shared one budget, and every open
 * tab spent ~33 requests a minute doing nothing: a 5s /state poll, six 15-20s REST polls (one the
 * whole cash book), and a ~30-request "resync" on every return to the tab and every stream
 * reconnect. A few tabs used up the minute; the next dashboard load got 429 and showed an error.
 *
 * The limiter is now per user (rate-limit.test.js) and reads retry through a blip
 * (api-client-retry.test.js). These pin the volume side, which lives in two browser files.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const cloud = fs.readFileSync(path.join(root, 'cloud.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'finance-shell.jsx'), 'utf8');

describe('cloud.js: the /state safety-net poll', () => {
  it('a hidden tab does not poll, and a live stream slows the net to 30s', () => {
    const tick = cloud.slice(cloud.indexOf('function pollTick()'), cloud.indexOf('function startPoll()'));
    expect(tick).toMatch(/document\.hidden\) return;/);
    expect(tick).toMatch(/sseLive\(\) && Date\.now\(\) - lastPollRun < 30000\) return;/);
    expect(cloud).toMatch(/setInterval\(pollTick, 5000\)/);
  });
});

describe('cloud.js: the full resync', () => {
  it('fires at most once per 30s', () => {
    expect(cloud).toMatch(/const RESYNC_MIN_MS = 30000;/);
    expect(cloud).toMatch(/if \(now - lastResync < RESYNC_MIN_MS\) return;/);
  });
  it('the stream\'s first open is the page load, not a reconnect', () => {
    expect(cloud).toMatch(/if \(openedOnce\) resync\('reconnect'\); else \{ openedOnce = true; lastResync = Date\.now\(\); \}/);
  });
  it('nothing calls onEvent(focus) around the throttle', () => {
    const direct = cloud.match(/onEvent\(\{ entity: 'focus'/g) || [];
    expect(direct).toHaveLength(1);                           // only inside resync()
  });
});

describe('finance-shell: backstop polls and the focus resync', () => {
  it('all six timed REST polls are gated by backstopDue', () => {
    ['setoran', 'entries', 'staff', 'cashbons', 'approvals', 'events'].forEach((k) => {
      expect(shell).toMatch(new RegExp("backstopDue\\('" + k + "'\\)\\) reload"));
    });
    expect(shell).toMatch(/const BACKSTOP_LIVE_MS = 120000;/);
  });
  it('a focus resync reloads config (~14 requests) at most every 10 minutes', () => {
    expect(shell).not.toMatch(/evt\.entity === 'config' \|\| evt\.entity === 'focus'/);
    expect(shell).toMatch(/evt\.entity === 'focus' && Date\.now\(\) - configFocusAt >= CONFIG_FOCUS_MIN_MS/);
  });
});
