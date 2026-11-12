#!/usr/bin/env node
// SumiRE（墨入れ / 菫）コマンド
//
//   sumire [フォルダ | ファイル]   そのフォルダのスクリプトを、なぞり書きノートとして開く
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, isTraceable } from '../lib/server.js';

const HELP = `SumiRE（墨入れ / 菫）— コードを上からなぞって、指で覚えるローカルのタイピングノート

使い方:
  sumire [フォルダ]          そのフォルダのスクリプトをノートにして開く（省略時は今いるフォルダ）
  sumire <ファイル>          そのファイルのページを開いた状態で起動する
      --port <番号>          ポート番号（初期値 4848。使用中なら次の番号を使う）
      --no-open              ブラウザを開かない
  sumire --version           版を表示する`;

// ---------- Node.js のバージョン確認 ----------
// Node2Shell（CVE-2026-111497）が修正された版より古い Node.js では起動しない（HanaME と同じ基準）。
// 修正版: 22.23.4 / 24.22.1 / 26.12.1。それ以外の系列（奇数版・23/25・21以前）はサポート終了のため対象外
{
  const FIXED = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };
  const cur = process.versions.node.split('.').map(Number);
  const min = FIXED[cur[0]] ?? (cur[0] > 26 ? [cur[0], 0, 0] : null);
  const older = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (!min || older(cur, min) < 0) {
    console.error(
      `Node.js ${process.versions.node} では起動できません。\n` +
      'Node2Shell（CVE-2026-111497）が修正された Node.js 22.23.4 / 24.22.1 / 26.12.1 以降に更新してください。',
    );
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('-')));

if (flags.has('--help') || flags.has('-h')) {
  console.log(HELP);
  process.exit(0);
}
if (flags.has('--version') || flags.has('-v')) {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------- 引数 ----------
let portArg = 4848;
const positionals = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' || args[i] === '-p') {
    portArg = Number(args[++i]);
    if (!Number.isInteger(portArg) || portArg < 1 || portArg > 65535) fail('--port には 1〜65535 の番号を指定してください');
    continue;
  }
  if (!args[i].startsWith('-')) positionals.push(args[i]);
}

const target = path.resolve(positionals[0] ?? '.');
if (!fs.existsSync(target)) fail(`見つかりません: ${target}`);

let root = target;
let openFile = null;
if (fs.statSync(target).isFile()) {
  // 今いるフォルダの中のファイルなら、今いるフォルダ全体をノートにして、そのページを開く
  const cwd = process.cwd();
  const fromCwd = path.relative(cwd, target);
  const underCwd = !fromCwd.startsWith('..') && !path.isAbsolute(fromCwd);
  root = underCwd ? cwd : path.dirname(target);
  openFile = path.relative(root, target).split(path.sep).join('/');
  if (!isTraceable(openFile)) fail(`なぞり書きできない種類のファイルです: ${openFile}`);
}

// 画面（dist/）が作られていないと何も表示できない
const distIndex = fileURLToPath(new URL('../dist/index.html', import.meta.url));
if (!fs.existsSync(distIndex)) {
  fail('画面のファイル（dist/）がありません。SumiRE のフォルダで npm run build を実行してください。');
}

function openBrowser(url) {
  // 自分のサーバーの URL 以外は開かない（ファイル名が URL に入るため、念のため形を確かめる）
  if (!/^http:\/\/localhost:\d{1,5}\/(#[A-Za-z0-9%._~!*'()=-]*)?$/.test(url)) return;
  // Windows では cmd.exe を通さずに開く（cmd の記号の解釈によるコマンド実行を避ける）
  const [cmd, cmdArgs] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

// ---------- 起動 ----------
const app = createServer(root);
let port;
try {
  port = await app.listen(portArg);
} catch (e) {
  fail(`サーバーを起動できませんでした: ${e.message}`);
}

const files = await app.listFiles();
const hash = openFile ? `#file=${encodeURIComponent(openFile)}` : '';
const url = `http://localhost:${port}/${hash}`;

console.log(`SumiRE: ${root}`);
console.log(`  ${files.length} ファイル → ${url}`);
console.log('  終了するには Ctrl+C');
if (files.length === 0) console.log('  （なぞり書きできるスクリプトが見つかりませんでした）');

if (!flags.has('--no-open')) openBrowser(url);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
