import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createTarokServer } from '../server/index.mjs';

// Disposable gameplay server with the actual deployment CSP. Never uses live saves.
const config = await readFile(new URL('../ops/it13/nginx.conf', import.meta.url), 'utf8');
const csp = config.match(/add_header Content-Security-Policy "([^"]+)" always;/)?.[1];
if (!csp) throw new Error('Deployment CSP not found');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-security-browser-'));
const server = await createTarokServer({ dataDir });
server.httpServer.prependListener('request', (_request, response) => {
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('X-Frame-Options', 'DENY');
});
try {
  const address = await server.listen(0, '127.0.0.1');
  const child = spawn(process.execPath, ['scripts/verify-browser.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, BASE_URL: `http://127.0.0.1:${address.port}`,
      ARTIFACTS_DIR: 'artifacts/security-gameplay' },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
}
