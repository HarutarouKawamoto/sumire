// README のスクリーンショット（docs/images/screen-light.png / screen-dark.png）を撮り直す
//
//   node scripts/capture-readme.mjs
//
// sample/ を SumiRE のサーバーで開き、Microsoft Edge（ヘッドレス）で途中まで打った画面を撮る。
// 事前に npm run build で dist/ を最新にしておくこと。Windows の Edge を前提にしている。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../lib/server.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'images');
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) throw new Error('Microsoft Edge が見つかりません');

const SHOTS = [
  // 昼：retry.ts を 15 行打ち、16 行目の途中で 1 文字打ち間違えたところ
  { name: 'screen-light.png', scheme: 'light', file: 'harness/retry.ts', lines: 15, partial: 'const value = aw', typo: 'e' },
  // 夜：queue.ts を 9 行打ち、10 行目の途中まで
  { name: 'screen-dark.png', scheme: 'dark', file: 'harness/queue.ts', lines: 9, partial: 'add(task: Ta', typo: '' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- サーバーと Edge を起動 ----------
const app = createServer(path.join(ROOT, 'sample'));
const port = await app.listen(4990);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sumire-capture-'));
const edge = spawn(EDGE, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });

let devtoolsPort;
for (let i = 0; i < 100 && !devtoolsPort; i++) {
  await sleep(100);
  try { devtoolsPort = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {}
}
if (!devtoolsPort) throw new Error('Edge の DevTools に接続できませんでした');

const targets = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

// ---------- 撮影 ----------
// ページの中で実行する：ピン留めを外し、表示されているゴースト文字をそのまま打つ
const typeInPage = ({ lines, partial, typo }) => {
  document.getElementById('btn-pin-top').click();
  const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  const ghost = () =>
    [...document.querySelectorAll('.code-line.is-active .char-ghost')].map((s) => s.textContent).join('');
  for (let i = 0; i < lines; i++) {
    for (const ch of ghost()) press(ch);
    press('Enter');
  }
  for (const ch of partial + typo) press(ch);
};

await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
fs.mkdirSync(OUT, { recursive: true });

for (const shot of SHOTS) {
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: shot.scheme }] });
  await cdp('Page.navigate', { url: 'about:blank' });
  await cdp('Page.navigate', { url: `http://localhost:${port}/#file=${encodeURIComponent(shot.file)}` });
  await sleep(1500);
  await cdp('Runtime.evaluate', {
    expression: `(${typeInPage})(${JSON.stringify(shot)})`,
    awaitPromise: true,
  });
  await sleep(800);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, shot.name), Buffer.from(data, 'base64'));
  console.log(`docs/images/${shot.name}`);
}

ws.close();
edge.kill();
await app.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
