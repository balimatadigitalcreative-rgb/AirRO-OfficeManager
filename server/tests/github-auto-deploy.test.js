'use strict';
// AUTO-DEPLOY (static): a push to master — or "Run workflow" on GitHub — runs the normal gated
// deploy/update.sh on the VPS over SSH. The key used for it can run THAT and nothing else (forced
// command), the server's identity is pinned (no blind trust), and nothing here can skip the test gate.
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

describe('GitHub workflow', () => {
  const wf = () => read('.github/workflows/deploy-vps.yml');
  it('runs on a push to master and on demand, one deploy at a time (never cancels a running one)', () => {
    expect(wf()).toMatch(/on:\s*\n\s*push:\s*\n\s*branches: \[master\]\s*\n\s*workflow_dispatch:/);
    expect(wf()).toMatch(/concurrency:\s*\n\s*group: deploy-vps\s*\n\s*cancel-in-progress: false/);
  });
  it('pins the server key, uses only the deploy key, and fails the job when the deploy fails', () => {
    expect(wf()).toMatch(/-o StrictHostKeyChecking=yes/);
    expect(wf()).toMatch(/-o IdentitiesOnly=yes/);
    expect(wf()).toMatch(/printf '%s %s\\n' "\$DEPLOY_HOST" "\$HOST_KEY" > ~\/\.ssh\/known_hosts/);
    expect(wf()).toMatch(/set -euo pipefail/);
    expect(wf()).not.toMatch(/ssh-keyscan|StrictHostKeyChecking=no/);
  });
  it('never skips the test gate; without its secrets it only warns (first push before setup)', () => {
    expect(wf()).not.toMatch(/skip-tests|skip-offsite|restore-db/);
    expect(wf()).toMatch(/::warning::/);
    expect(wf()).toMatch(/secrets\.VPS_SSH_KEY/);
    expect(wf()).toMatch(/secrets\.VPS_HOST_KEY/);
  });
});

describe('VPS side', () => {
  it('the one-time setup makes a key that can only run the deploy (forced command, no shell/forwarding)', () => {
    const s = read('deploy/setup-github-deploy.sh');
    expect(s).toMatch(/ssh-keygen -t ed25519 -N '' -C 'airro-github-deploy'/);
    expect(s).toMatch(/command=\\"bash \$APP_DIR\/deploy\/remote-deploy\.sh\\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty /);
    expect(s).toMatch(/\/etc\/ssh\/ssh_host_ed25519_key\.pub/);
    expect(s).toMatch(/grep -qF/);   // running it twice does not add the key twice
  });
  it('the forced command loads node/pm2 like a login shell and runs the normal gated update.sh — no flags', () => {
    const r = read('deploy/remote-deploy.sh');
    expect(r).toMatch(/\. "\$HOME\/\.nvm\/nvm\.sh"/);
    expect(r).toMatch(/^exec bash deploy\/update\.sh$/m);
    expect(r).not.toMatch(/--skip|--restore/);
  });
});
