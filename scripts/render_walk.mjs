// Frame sequence along the adopted long-take walk (r05 step 4 tooling; stage 5 of the production plan).
// One page builds the world once (viewer batch mode) and renders every frame from it, so the
// per-frame cost is only the GPU accumulation and the PNG read-back.
// Usage: node scripts/render_walk.mjs --from 0 --to 15 --fps 30 --spp 32 --out renders/walk-test
//        [--shutter 0.0167] [--w 1920 --h 1080] [--look clear-afternoon] [--shadow 4096] [--resume]
//        [--channel chrome] [--angle d3d11|gl|vulkan|metal]
// Always uses the GPU (hardware WebGL); a run that lands on SwiftShader stops with an error.
// Output: <out>/frames/frame-000000.png ... and <out>/walk-report.json (world log, environment,
// per-frame times). --resume keeps frames that already exist (the world is deterministic, so a
// resumed run draws the same frames). Encode with: py -3 scripts/encode_frames.py <out>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const required = (name) => { const v = opt(name); if (v === undefined) throw new Error(`--${name} is required`); return Number(v); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = required('from'), to = required('to'), fps = required('fps'), spp = required('spp');
if (!(to > from) || !(fps > 0) || !(spp >= 1)) throw new Error('need --to > --from, --fps > 0, --spp >= 1');
const w = Number(opt('w', 1920)), h = Number(opt('h', 1080));
const look = opt('look', 'clear-afternoon');
const shutter = Number(opt('shutter', 0));
const out = path.resolve(ROOT, opt('out', 'renders/walk'));
const framesDir = path.join(out, 'frames');
const resume = args.includes('--resume');
fs.mkdirSync(framesDir, { recursive: true });

const count = Math.floor((to - from) * fps + 1e-9) + 1;
const frames = Array.from({ length: count }, (_, n) => ({ n, t: +(from + n / fps).toFixed(6), file: path.join(framesDir, `frame-${String(n).padStart(6, '0')}.png`) }));

const server = await startServer(0);
const port = server.address().port;
const defaultAngle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl';
const launch = { headless: true, channel: opt('channel', 'chrome'), args: ['--ignore-gpu-blocklist', '--enable-gpu', `--use-angle=${opt('angle', defaultAngle)}`, '--disable-gpu-sandbox'] };
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, '')}`); });
const q = new URLSearchParams({ still: '1', batch: '1', w, h, look, spp: String(spp) });
if (shutter > 0) q.set('shutter', String(shutter));
if (opt('shadow')) q.set('shadow', opt('shadow'));

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/viewer/index.html?${q}`);
await page.waitForFunction(() => window.__worldReady || window.__error, null, { timeout: 900000, polling: 500 });
const world = await page.evaluate(() => ({
  error: window.__error || null, moduleErrors: window.__moduleErrors || [], gpu: window.__gpu || null,
  fontWarnings: window.__fontWarnings || [], fontSources: window.__fontSources || null, log: window.__log,
}));
const worldMs = Date.now() - t0;
const fail = (msg) => { console.error(msg); fs.writeFileSync(path.join(out, 'walk-report.json'), JSON.stringify({ error: msg, world, console: logs.slice(-60) }, null, 2)); process.exit(1); };
if (world.error || world.moduleErrors.length) fail(`world failed: ${world.error || world.moduleErrors.join('; ')}`);
if (/swiftshader/i.test(world.gpu || '')) fail(`WebGL renderer is ${world.gpu}; render_walk.mjs needs the GPU`);
console.log(`world ready in ${worldMs} ms on ${world.gpu}${world.fontWarnings.length ? ` (WARNING missing fonts: ${world.fontWarnings.join(', ')})` : ''}`);

const perFrame = [];
const started = Date.now();
for (const f of frames) {
  if (resume && fs.existsSync(f.file)) continue;
  const tf = Date.now();
  // Grain seed per frame. The grade shader hashes vUv * 1931 + seed, so an integer step would only
  // slide the same grain by about a pixel; a non-integer step kept small (float precision) gives a
  // fresh pattern every frame, and stays deterministic for --resume.
  const seed = +((f.n * 17.37) % 97).toFixed(4);
  const accumulation = await page.evaluate(([t, s]) => window.__renderView({ walk: t, seed: s }), [f.t, seed]);
  const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  if (!dataUrl.startsWith('data:image/png;base64,')) fail(`frame ${f.n}: canvas read-back failed`);
  fs.writeFileSync(f.file, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
  perFrame.push({ n: f.n, t: f.t, ms: Date.now() - tf, gpu_ms: accumulation.ms });
  if (perFrame.length % 30 === 0 || f.n === frames.length - 1) {
    const done = perFrame.length, avg = (Date.now() - started) / done;
    console.log(`frame ${f.n + 1}/${frames.length}  ${avg.toFixed(0)} ms/frame  eta ${((frames.length - f.n - 1) * avg / 60000).toFixed(1)} min`);
  }
}
await browser.close();
server.close();

const git = (cmd) => { try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
const ms = perFrame.map((p) => p.ms).sort((a, b) => a - b);
const report = {
  from, to, fps, frames: frames.length, rendered: perFrame.length, w, h, look, spp, shutter,
  world_ms: worldMs,
  frame_ms: ms.length ? { median: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1] } : null,
  environment: {
    mode: 'gpu', webgl_renderer: world.gpu, launch, browser: browser.version(), node: process.version, platform: process.platform,
    three: JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/three/package.json'), 'utf8')).version,
    source_commit: git('git rev-parse HEAD'), worktree_dirty: git('git status --porcelain -- viewer scripts data scenes') ? true : false,
  },
  fontWarnings: world.fontWarnings, fontSources: world.fontSources,
  world_log: world.log, console: logs.slice(-60), per_frame: perFrame,
};
fs.writeFileSync(path.join(out, 'walk-report.json'), JSON.stringify(report, null, 2));
console.log(`${perFrame.length} frames in ${((Date.now() - started) / 1000).toFixed(1)} s (median ${report.frame_ms ? report.frame_ms.median : '-'} ms/frame)`);
