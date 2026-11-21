const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('NEXO_DEV_ACCOUNT seeds a complete developer profile in a fresh SQLite database', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-dev-seed-'));
  const port = await getFreePort();
  const dbPath = path.join(dataDir, 'fresh.db');
  const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DB_PATH: dbPath,
      NODE_ENV: 'development',
      ELECTRON_DESKTOP: '1',
      NEXO_DEV_ACCOUNT: 'true',
      NEXO_DEV_EMAIL: 'dev@nexo.local',
      NEXO_DEV_PASSWORD: 'Nexo-Test-Password-123!'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

  try {
    let ready = false;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Server exited before startup:\n' + logs);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/security/csrf-token`);
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(ready, true, 'server should start on a fresh database:\n' + logs);

    const db = new Database(dbPath, { readonly: true });
    try {
      const user = db.prepare('SELECT email, display_name, username, discriminator, profile_complete, avatar_preset FROM users WHERE email = ?').get('dev@nexo.local');
      assert.ok(user, 'developer account should be inserted');
      assert.equal(user.display_name, 'Nexo Dev');
      assert.equal(user.discriminator, '0001');
      assert.equal(user.profile_complete, 1);
      assert.equal(user.avatar_preset, 0);
      const settings = db.prepare('SELECT badges FROM user_settings WHERE user_id = (SELECT id FROM users WHERE email = ?)').get('dev@nexo.local');
      assert.deepEqual(JSON.parse(settings.badges).sort(), ['dev', 'premium']);
      const subscription = db.prepare("SELECT id FROM premium_subscriptions WHERE user_id = (SELECT id FROM users WHERE email = ?) AND status = 'active' AND metadata LIKE '%\"dev\":true%'").get('dev@nexo.local');
      assert.ok(subscription, 'developer premium subscription should be seeded');
    } finally {
      db.close();
    }
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 3000).unref();
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
