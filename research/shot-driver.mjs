// Screenshot driver for the Launch Radar v4 dashboard (Node stdlib only).
// Launches headless Chrome for Testing over CDP, loads the dashboard from a
// local output dir, scrolls to the wanted element and captures a 1440x900
// PNG. Usage:
//   node research/shot-driver.mjs <dashboard-dir> <out-dir>
// Takes: 1-board.png (#board -> toolbar), 2-detail.png
// (#detail=steakhouse-financial), 3-filtered.png (#filter=farm -> toolbar).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = '/home/hatch/.cache/chrome-for-testing/chrome-linux64/chrome';
const PORT = 9224;
const PROFILE = '/tmp/r4-shot-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dashDir = process.argv[2];
const outDir = process.argv[3];
if (!dashDir || !outDir) {
  console.error('usage: node research/shot-driver.mjs <dashboard-dir> <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m);
        this.pending.delete(m.id);
      }
    };
  }
  ready() {
    return new Promise((res) => {
      if (this.ws.readyState === 1) return res();
      this.ws.onopen = () => res();
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res) => this.pending.set(id, res));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  }
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
  '--disable-dev-shm-usage', '--window-size=1440,900', '--hide-scrollbars',
  `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore', detached: true });
chrome.unref();

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

try {
  for (let i = 0; i < 60; i++) {
    try { const v = await getJson('/json/version'); if (v?.webSocketDebuggerUrl) break; } catch {}
    await sleep(500);
  }
  const targets = await getJson('/json/list');
  const page = targets.find((t) => t.type === 'page');
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const shots = [
    { name: '1-board.png', hash: '#board', scrollSel: '.toolbar', waitMs: 1500 },
    { name: '2-detail.png', hash: '#detail=steakhouse-financial', scrollSel: '#detail', waitMs: 1500 },
    { name: '3-filtered.png', hash: '#filter=farm', scrollSel: '.toolbar', waitMs: 1500 },
  ];
  for (const s of shots) {
    // about:blank first: a same-document (hash-only) navigation would not
    // reload the page, so the new hash would never be read.
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(300);
    const url = `file://${dashDir}/index.html${s.hash}`;
    await cdp.send('Page.navigate', { url });
    await sleep(s.waitMs);
    const info = await cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(s.scrollSel)});
      if (!el) return { ok: false };
      const r = el.getBoundingClientRect();
      return { ok: true, top: r.top + window.scrollY, h: document.body.scrollHeight,
               rendered: !!window.RADAR && document.querySelectorAll('#board-body tr').length };
    })()`);
    if (!info?.ok) throw new Error(`selector ${s.scrollSel} not found for ${s.name}`);
    await cdp.eval(`window.scrollTo(0, ${Math.max(0, info.top - 8)})`);
    await sleep(400);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, s.name), Buffer.from(shot.result.data, 'base64'));
    console.log(`${s.name}: element top ${Math.round(info.top)}px, page ${info.h}px, rows ${info.rendered}`);
  }
  console.log('done');
} finally {
  try { process.kill(-chrome.pid, 'SIGTERM'); } catch {}
  process.exit(0);
}
