// 紹介サイト（site/）のスクリーンショットとループ動画を撮る。
//
//   npm run build（dist/ を最新にする）→ cd site/tools && npm install && node capture.mjs
//   SCENES=stills node capture.mjs   … 静止画だけ
//   SCENES=loops  node capture.mjs   … ループ動画だけ
//
// site/demo/komorebi-reserve（架空の喫茶店の席予約 API のコード）を SumiRE で開き、
// Playwright（Microsoft Edge）で打ち込みながら撮る。
// 出力: site/images/*.webp（静止画）と site/images/*.mp4（無音のループ）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../../lib/server.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, '..');
const OUT = path.join(SITE, 'images');
const DEMO = path.join(SITE, 'demo', 'komorebi-reserve');
const W = 1280;
const H = 760;
const SCENES = process.env.SCENES ?? 'all';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sumire-site-'));

// ---------- ページの中で実行する：表示されているゴースト文字をそのまま打つ ----------
const typeInPage = ({ lines, partial = '', typo = '' }) => {
  const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  const ghost = () => [...document.querySelectorAll('.code-line.is-active .char-ghost')].map((s) => s.textContent).join('');
  for (let i = 0; i < lines; i++) {
    for (const ch of ghost()) press(ch);
    press('Enter');
  }
  for (const ch of partial + typo) press(ch);
};

async function open({ scheme = 'light', video = null } = {}) {
  const app = createServer(DEMO);
  const port = await app.listen(4990);
  const base = `http://localhost:${port}/`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: video ? 1 : 2,
    colorScheme: scheme,
    locale: 'ja-JP',
    ...(video ? { recordVideo: { dir: video, size: { width: W, height: H } } } : {}),
  });
  const page = await context.newPage();
  const p = {
    page,
    async go(file, { pin = false } = {}) {
      await page.goto('about:blank');
      await page.goto(`${base}#file=${encodeURIComponent(file)}`);
      await page.waitForSelector('.code-line.is-active');
      await sleep(600);
      // 打っている行を上に固定しない（打ち終えた行と、これから打つ行の両方が見えるように）
      const pinned = await page.locator('#btn-pin-top').evaluate((b) => b.classList.contains('is-active'));
      if (pinned !== pin) {
        await page.click('#btn-pin-top');
      }
      await page.mouse.move(W - 40, H - 120);
      await sleep(300);
    },
    async typeFast(opts) { await page.evaluate(typeInPage, opts); await sleep(500); },
    // 打っている行を、画面の上から ratio の位置に置く
    async center(ratio = 0.55) {
      await page.evaluate((r) => {
        const line = document.querySelector('.code-line.is-active');
        const sc = document.getElementById('editor-container');
        sc.scrollTop += line.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight * r;
      }, ratio);
      await sleep(400);
    },
    async close() { await context.close(); await browser.close(); await app.close(); },
  };
  return p;
}

async function still(page, name, clip) {
  const png = path.join(tmp, `${name}.png`);
  await page.screenshot({ path: png, ...(clip ? { clip } : {}) });
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '86', '-compression_level', '6', path.join(OUT, `${name}.webp`)]);
  console.log(`images/${name}.webp`);
}

async function lineClip(page, { above = 3, below = 3 } = {}) {
  const b = await page.locator('.code-line.is-active').boundingBox();
  const y = Math.max(0, b.y - b.height * above);
  return { x: 0, y, width: W, height: Math.min(H, b.y + b.height * (below + 1)) - y };
}

// ================= 静止画 =================
async function stills() {
  const p = await open({ scheme: 'light' });
  const { page } = p;

  // 1 ファイルを最後まで打つ（ファイル名の横に ✓ と 100%）
  await p.go('src/reservations/types.ts');
  const total = await page.locator('.code-line').count();
  await p.typeFast({ lines: total });
  await sleep(500);
  // 打ち終えると次のファイルへめくられるので、1 つ戻って打ち終えた画面を撮る
  await page.keyboard.press('Alt+ArrowLeft');
  await sleep(900);
  await page.mouse.move(W - 40, H - 120);
  await still(page, 'done');

  // いちばん大きい画面：createReservation.ts を途中まで打ち、1 文字打ち間違えたところ
  await p.go('src/reservations/createReservation.ts');
  await p.typeFast({ lines: 21, partial: 'if (findConflicts(input.slot, input.seatId, exi', typo: 'd' });
  await p.center(0.5);
  await still(page, 'typing');
  await still(page, 'typo', await lineClip(page, { above: 2, below: 2 }));
  await still(page, 'status', { x: 0, y: H - 26, width: W, height: 26 });

  // コメントの行は飛ばす（薄いまま残る）
  await page.keyboard.press('Backspace');
  await p.typeFast({ lines: 0, partial: 'sting).length > 0) {' });
  await p.center(0.62);
  await still(page, 'skip', await lineClip(page, { above: 5, below: 2 }));
  await p.close();

  // 夜の配色（Dark+）
  const n = await open({ scheme: 'dark' });
  await n.go('src/reservations/overlap.ts');
  await n.typeFast({ lines: 9, partial: 'return existing.fil' });
  await n.center(0.5);
  await still(n.page, 'night');
  await n.close();
}

// ================= ループ動画 =================
async function loops() {
  const dir = fs.mkdtempSync(path.join(tmp, 'v-'));
  const p = await open({ scheme: 'light', video: dir });
  const { page } = p;
  await p.go('src/reservations/overlap.ts');
  await p.typeFast({ lines: 2 });
  await p.center(0.42);
  const t0 = Date.now();
  await sleep(700);
  const kb = (s, d = 95) => page.keyboard.type(s, { delay: d });
  // 1 行目：途中で打ち間違え、Backspace で直す
  await kb('return a.date === b.date && a.form');
  await sleep(350);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Backspace'); await sleep(140); }
  await kb('rom < b.to && b.from < a.to;');
  await sleep(250);
  await page.keyboard.press('Enter');
  await sleep(300);
  await kb('}');
  await sleep(250);
  await page.keyboard.press('Enter');
  await sleep(1400);
  const length = (Date.now() - t0) / 1000;
  const video = page.video();
  await p.close();
  const raw = await video.path();
  const from = Math.max(0, duration(raw) - length);
  const dest = path.join(OUT, 'loop-type.mp4');
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(from), '-i', raw, '-t', String(length),
    '-an', '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', dest]);
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(from + length - 0.1), '-i', raw, '-frames:v', '1',
    '-c:v', 'libwebp', '-quality', '86', path.join(OUT, 'loop-type-poster.webp')]);
  console.log('images/loop-type.mp4');
}

// WebM には長さの情報がないことがあるので、最後まで読んで測る
function duration(file) {
  const log = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const m = [...log.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].at(-1);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

try {
  if (SCENES === 'all' || SCENES === 'stills') await stills();
  if (SCENES === 'all' || SCENES === 'loops') await loops();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
