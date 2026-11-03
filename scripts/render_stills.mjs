// Headless still renderer for the six route stations (three.js + Chromium SwiftShader, CPU only).
// Usage: node scripts/render_stills.mjs [--out renders/r04] [--walk 0,60,120] [--views r04-gate-establishing] [--stations a,b] [--w 1920 --h 1080] [--look clear-afternoon] [--only terrain,buildings]
//        GPU machine: add --gpu (hardware WebGL instead of SwiftShader). Optional --channel chrome|chromium|msedge
//        (default chromium = Playwright's full Chromium in new headless mode) and --angle d3d11|gl|vulkan|metal
//        (default per OS). The report records the WebGL renderer string; a --gpu run that still lands on
//        SwiftShader is reported as a failure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  const globalRoot = execSync('npm root -g').toString().trim();
  ({ chromium } = require(path.join(globalRoot, 'playwright')));
}

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const scene = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/shinjuku/kabukicho/1976/scene.json'), 'utf8'));
const walkTimes = opt('walk') ? opt('walk').split(',').map(Number) : null; // seconds on the adopted walk
const viewIds = opt('views') ? opt('views').split(',') : null; // supplementary review cameras (not route stations)
const stations = viewIds ? viewIds : walkTimes ? walkTimes.map((t) => `walk-${String(t).padStart(6, '0')}`) : (opt('stations') ? opt('stations').split(',') : scene.route.stations.map((s) => s.id));
const out = path.resolve(ROOT, opt('out', 'renders/r04'));
const w = Number(opt('w', 1920)), h = Number(opt('h', 1080));
const look = opt('look', 'clear-afternoon');
const only = opt('only');
const timeoutMs = Number(opt('timeout', 900000));
fs.mkdirSync(out, { recursive: true });

const server = await startServer(0);
const port = server.address().port;
const useGpu = args.includes('--gpu');
const defaultAngle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl';
const launchOpts = useGpu
  ? { headless: true, channel: opt('channel', 'chromium'), args: ['--ignore-gpu-blocklist', '--enable-gpu', `--use-angle=${opt('angle', defaultAngle)}`, '--disable-gpu-sandbox'] }
  : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] };
const browser = await chromium.launch(launchOpts);
const browserVersion = browser.version();
const report = [];
let failed = false;
for (const id of stations) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const q = new URLSearchParams({ station: id, still: '1', w, h, look });
  if (walkTimes) { q.delete('station'); q.set('walk', String(walkTimes[stations.indexOf(id)])); }
  if (viewIds) { q.delete('station'); q.set('view', id); }
  if (only) q.set('only', only);
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/viewer/index.html?${q}`);
  try {
    await page.waitForFunction(() => window.__renderDone || window.__error, null, { timeout: timeoutMs, polling: 500 });
  } catch (e) { logs.push(`[timeout] ${e.message}`); }
  const state = await page.evaluate(() => ({
    error: window.__error || null, moduleErrors: window.__moduleErrors || [], done: !!window.__renderDone, stats: window.__stats ? window.__stats() : null, log: window.__log,
    // provenance tags of everything generated, and the fictional shop-name list (production plan: keep a list)
    gpu: window.__gpu || null, fontWarnings: window.__fontWarnings || [],
    provenance: window.__ctx ? window.__ctx.provenance : null,
    fictionalNames: window.__ctx && window.__ctx.signage ? window.__ctx.signage.fictionalNames : null,
  }));
  const file = path.join(out, `${id}.png`);
  if (state.done) {
    // Read the canvas directly (still mode sets preserveDrawingBuffer). Playwright's element
    // screenshot can exceed its 30 s budget under heavy shared CPU load; fall back to it only if
    // toDataURL fails.
    const dataUrl = await page.evaluate(() => { try { return document.querySelector('canvas').toDataURL('image/png'); } catch (e) { return null; } });
    if (dataUrl && dataUrl.startsWith('data:image/png;base64,')) {
      fs.writeFileSync(file, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
    } else {
      await page.locator('canvas').screenshot({ path: file, timeout: 300000 });
    }
  }
  const ms = Date.now() - t0;
  const entry = { station: id, file: path.relative(ROOT, file), ms, ...state, console: logs.slice(-40) };
  report.push(entry);
  if (!state.done || state.error || state.moduleErrors.length) failed = true;
  if (useGpu && /swiftshader/i.test(state.gpu || '')) { failed = true; console.log(`  --gpu requested but WebGL renderer is ${state.gpu}`); }
  if (state.fontWarnings.length) console.log(`  WARNING missing fonts: ${state.fontWarnings.join(', ')}`);
  console.log(`${id}: ${state.done ? 'ok' : 'FAILED'} ${ms} ms ${state.error || ''} ${state.moduleErrors.join('; ')}`);
  if (state.stats) console.log('  ', JSON.stringify(state.stats));
  await page.close();
}
await browser.close();
server.close();
const git = (cmd) => { try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
const environment = {
  three: JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/three/package.json'), 'utf8')).version,
  browser: browserVersion, node: process.version, cpus: (await import('node:os')).cpus().length,
  platform: process.platform, mode: useGpu ? 'gpu' : 'swiftshader', launch: launchOpts, webgl_renderer: report.length ? report[0].gpu : null,
  source_commit: git('git rev-parse HEAD'), worktree_dirty: git('git status --porcelain -- viewer scripts data scenes') ? true : false,
};
for (const e of report) e.environment = environment;
// merge with an existing report in the same directory (several invocations may share an output dir)
const reportPath = path.join(out, 'render-report.json');
let merged = report;
try {
  const prev = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (prev.look === look && prev.w === w && prev.h === h) merged = [...prev.stations.filter((p) => !report.some((r) => r.station === p.station)), ...report];
} catch { /* no previous report */ }
fs.writeFileSync(reportPath, JSON.stringify({ look, w, h, environment, stations: merged }, null, 2));
process.exit(failed ? 1 : 0);
