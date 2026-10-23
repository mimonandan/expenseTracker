import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

async function unusedPort() {
  const reservation = createServer();
  await new Promise((resolve, reject) => reservation.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

async function waitUntilReady(child, endpoint) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`API process exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* The server has not started listening yet. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('API did not become ready within 8 seconds.');
}

test('API health and authentication boundary work without cloud credentials', async t => {
  const port = await unusedPort();
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const entry = fileURLToPath(new URL('./index.js', import.meta.url));
  const child = spawn(process.execPath, [entry], {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      SUPABASE_ANON_KEY: '',
      OPENAI_API_KEY: '',
      OPENAI_MODEL: '',
    },
  });
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    if (child.exitCode != null) return;
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  });

  await waitUntilReady(child, `${base}/health`);
  const health = await fetch(`${base}/health`).then(response => response.json());
  assert.deepEqual(health, { status: 'ok', database: 'unconfigured' });

  const protectedRoutes = [
    fetch(`${base}/api/transactions`),
    fetch(`${base}/api/alerts/ai-status`),
    fetch(`${base}/api/summary`),
    fetch(`${base}/api/transactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    fetch(`${base}/api/transactions`, { method: 'DELETE' }),
  ];
  const responses = await Promise.all(protectedRoutes);
  assert.deepEqual(responses.map(response => response.status), [401, 401, 401, 401, 401]);

  const invalidJson = await fetch(`${base}/api/transactions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(invalidJson.status, 400);

  const oversizedBody = `{"pad":"${'x'.repeat(1024 * 1024)}"}`;
  const tooLarge = await fetch(`${base}/api/transactions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: oversizedBody,
  });
  assert.equal(tooLarge.status, 413);
});
