/* Verify the documented dev command actually serves the app. */
const { spawn } = require('child_process');
const path = require('path');

const root = 'C:/Users/PAB-EDU-NB4282/github-repo/marginalia';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const child = spawn(npx, ['vite', '--configLoader', 'native', '--port', '5199', '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

let out = '';
child.stdout.on('data', (d) => (out += d.toString()));
child.stderr.on('data', (d) => (out += d.toString()));

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

(async () => {
  try {
    const res = await waitForServer('http://localhost:5199/');
    const html = await res.text();
    const servesRoot = html.includes('id="root"');
    const servesEntry = html.includes('/src/main.tsx');
    console.log(`dev server HTTP ${res.status}`);
    console.log(`serves #root: ${servesRoot}`);
    console.log(`serves /src/main.tsx: ${servesEntry}`);

    // Ask Vite to transform the entry module; a config error surfaces here.
    const mod = await fetch('http://localhost:5199/src/main.tsx');
    console.log(`main.tsx transform HTTP ${mod.status}`);
    const modBody = await mod.text();
    const hasImport = /import\s|createRoot/.test(modBody);
    console.log(`transformed module looks like TS->JS: ${hasImport}`);

    const ok = res.status === 200 && servesRoot && servesEntry && mod.status === 200 && hasImport;
    console.log(ok ? 'PASS  dev server serves the app' : 'FAIL  dev server output wrong');
    child.kill('SIGTERM');
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('FAIL', err.message);
    console.error(out.slice(0, 1200));
    child.kill('SIGTERM');
    process.exit(1);
  }
})();
