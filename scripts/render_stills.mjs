// Headless still renderer for the six route stations (three.js + Chromium SwiftShader, CPU only).
// Usage: node scripts/render_stills.mjs [--out renders/r02] [--stations a,b] [--w 1920 --h 1080] [--look clear-afternoon] [--only terrain,buildings]
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
const stations = (opt('stations') ? opt('stations').split(',') : scene.route.stations.map((s) => s.id));
const out = path.resolve(ROOT, opt('out', 'renders/r02'));
const w = Number(opt('w', 1920)), h = Number(opt('h', 1080));
const look = opt('look', 'clear-afternoon');
const only = opt('only');
const timeoutMs = Number(opt('timeout', 900000));
fs.mkdirSync(out, { recursive: true });

const server = await startServer(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const report = [];
let failed = false;
for (const id of stations) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const q = new URLSearchParams({ station: id, still: '1', w, h, look });
  if (only) q.set('only', only);
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/viewer/index.html?${q}`);
  try {
    await page.waitForFunction(() => window.__renderDone || window.__error, null, { timeout: timeoutMs, polling: 500 });
  } catch (e) { logs.push(`[timeout] ${e.message}`); }
  const state = await page.evaluate(() => ({ error: window.__error || null, moduleErrors: window.__moduleErrors || [], done: !!window.__renderDone, stats: window.__stats ? window.__stats() : null, log: window.__log }));
  const file = path.join(out, `${id}.png`);
  if (state.done) {
    await page.locator('canvas').screenshot({ path: file });
  }
  const ms = Date.now() - t0;
  const entry = { station: id, file: path.relative(ROOT, file), ms, ...state, console: logs.slice(-40) };
  report.push(entry);
  if (!state.done || state.error || state.moduleErrors.length) failed = true;
  console.log(`${id}: ${state.done ? 'ok' : 'FAILED'} ${ms} ms ${state.error || ''} ${state.moduleErrors.join('; ')}`);
  if (state.stats) console.log('  ', JSON.stringify(state.stats));
  await page.close();
}
await browser.close();
server.close();
fs.writeFileSync(path.join(out, 'render-report.json'), JSON.stringify({ look, w, h, stations: report }, null, 2));
process.exit(failed ? 1 : 0);
