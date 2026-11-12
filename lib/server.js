// SumiRE（墨入れ / 菫）ローカルサーバー
//
// 起動したフォルダの中のスクリプトファイルを、画面（dist/）に渡すだけの読み取り専用サーバー。
// 127.0.0.1 だけで待ち受け、ファイルを書き換える API は持たない。
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ignore from 'ignore';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');

/** なぞり書きの対象にする拡張子 */
export const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.rs', '.go', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.php',
  '.rb', '.swift', '.dart', '.lua', '.sh', '.ps1', '.sql',
  '.json', '.yaml', '.yml', '.toml', '.css', '.scss', '.html',
]);

/** 中を見ないフォルダ（.gitignore に書かれていなくても飛ばす） */
const ALWAYS_SKIP = new Set([
  'node_modules', '.git', '.sumire', '.haname', 'dist', 'build', 'out', '.next', '.nuxt',
  '.svelte-kit', '.turbo', '.cache', 'coverage', 'vendor', '__pycache__', '.venv', 'venv', 'target',
]);

/** 写経しても意味のない、機械が作るファイル */
const GENERATED_FILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|Cargo\.lock|poetry\.lock)$|\.min\.(js|css)$|\.map$/i;

/** 1 ファイルの上限（これより大きいものは一覧に出さない） */
const MAX_BYTES = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

// すべての応答に付けるヘッダー（MIME 推測・参照元の送信・他サイトへの埋め込みを防ぐ）
const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
};
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * HTTP2Shell（Node2Shell / CVE-2026-111497）対策：
 * リクエストの Content-Encoding に br（Brotli）が含まれているか。
 * 大文字小文字を問わず、"gzip, br" のような複数指定も見る。
 * このサーバーはリクエストの本文を読まないが、将来 POST を足したときに Brotli の展開へ
 * 外部の入力が届かないよう、本文を読む前の最初の段で拒否しておく
 */
export function hasBrotliEncoding(headers) {
  const value = headers['content-encoding'];
  if (!value) return false;
  const list = Array.isArray(value) ? value.join(',') : String(value);
  return list.split(',').some((v) => v.trim().toLowerCase() === 'br');
}

/** なぞり書きの対象になるファイル名か（拡張子と、機械が作るファイルの除外だけを見る） */
export function isTraceable(rel) {
  if (GENERATED_FILE.test(rel)) return false;
  return SUPPORTED_EXTENSIONS.has(path.extname(rel).toLowerCase());
}

/**
 * @param {string} root なぞり書きするフォルダ
 */
export function createServer(root) {
  root = path.resolve(root);
  const realRoot = fs.realpathSync(root);
  const ig = ignore();
  try { ig.add(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')); } catch {}

  const toRel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  const inside = (p, base) => p === base || p.startsWith(base + path.sep);

  const isSkipped = (rel, isDir) => {
    if (rel === '') return false;
    if (rel.split('/').some((p) => ALWAYS_SKIP.has(p))) return true;
    return ig.ignores(isDir ? rel + '/' : rel);
  };

  // 画面から渡されたパスを、フォルダの中の「一覧に出るファイル」だけに限って絶対パスに直す。
  // ../ による脱出と、シンボリックリンク（ジャンクション）でフォルダの外を指すものを拒否する
  function resolveFile(rel) {
    rel = String(rel ?? '');
    if (rel === '' || rel.includes('\0') || path.isAbsolute(rel)) throw new HttpError(400, 'bad path');
    const abs = path.resolve(root, rel);
    if (!inside(abs, root)) throw new HttpError(400, 'outside root');
    const norm = toRel(abs);
    let skipped;
    try { skipped = isSkipped(norm, false); } catch { throw new HttpError(400, 'bad path'); }
    if (skipped || !isTraceable(norm)) throw new HttpError(403, 'not a traceable file');
    let real;
    try { real = fs.realpathSync(abs); } catch { throw new HttpError(404, 'not found'); }
    if (!inside(real, realRoot)) throw new HttpError(403, 'outside root (link)');
    return { abs: real, rel: norm };
  }

  async function walk(dirAbs, out) {
    let entries;
    try { entries = await fsp.readdir(dirAbs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dirAbs, e.name);
      const rel = toRel(abs);
      // リンクは辿らない（フォルダの外を指していることがある）
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!isSkipped(rel, true)) await walk(abs, out);
      } else if (e.isFile() && isTraceable(rel) && !isSkipped(rel, false)) {
        let st;
        try { st = await fsp.stat(abs); } catch { continue; }
        if (st.size === 0 || st.size > MAX_BYTES) continue;
        out.push({ path: rel, size: st.size });
      }
    }
  }

  // フォルダが先、ファイルが後。名前の数字は数として並べる（HanaME と同じ並び）
  const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
  function compareTree(a, b) {
    const pa = a.split('/');
    const pb = b.split('/');
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      const lastA = i === pa.length - 1;
      const lastB = i === pb.length - 1;
      if (lastA !== lastB) return lastA ? 1 : -1;
      const c = collator.compare(pa[i], pb[i]);
      if (c !== 0) return c;
    }
    return pa.length - pb.length;
  }

  async function listFiles() {
    const files = [];
    await walk(root, files);
    files.sort((a, b) => compareTree(a.path, b.path));
    return files;
  }

  async function readText(rel) {
    const { abs } = resolveFile(rel);
    const st = await fsp.stat(abs);
    if (st.size > MAX_BYTES) throw new HttpError(413, 'file too large');
    const buf = await fsp.readFile(abs);
    if (buf.includes(0)) throw new HttpError(415, 'binary file');
    return buf.toString('utf8').replace(/^﻿/, '');
  }

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { ...SEC_HEADERS, 'cache-control': 'no-store', ...headers });
    res.end(body);
  };
  const sendJson = (res, status, data) =>
    send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8' });

  async function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const abs = path.resolve(DIST, rel);
    if (!inside(abs, DIST)) throw new HttpError(404, 'not found');
    let buf;
    try { buf = await fsp.readFile(abs); } catch { throw new HttpError(404, 'not found'); }
    const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
    const headers = { 'content-type': type };
    if (type.startsWith('text/html')) headers['content-security-policy'] = PAGE_CSP;
    send(res, 200, buf, headers);
  }

  let port = 0;
  const allowedHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`];

  const server = http.createServer(async (req, res) => {
    try {
      // HTTP2Shell 対策：Brotli で圧縮された本文は、読まずに 415 で断る（すべての確認より先に行う）
      if (hasBrotliEncoding(req.headers)) throw new HttpError(415, 'brotli request body is not accepted');
      // DNS リバインディング対策：自分の名前で来たリクエストだけに答える
      if (!allowedHosts().includes(req.headers.host)) throw new HttpError(403, 'bad host');
      // 読み取り専用。GET（と HEAD）以外は受け付けない
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === '/api/files') {
        return sendJson(res, 200, { root, name: path.basename(root), files: await listFiles() });
      }
      if (url.pathname === '/api/file') {
        const rel = url.searchParams.get('path');
        return sendJson(res, 200, { path: rel, content: await readText(rel) });
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not found');
      return await serveStatic(res, url.pathname);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      sendJson(res, status, { error: e instanceof HttpError ? e.message : 'internal error' });
    }
  });

  return {
    root,
    listFiles,
    /** 空いているポートが見つかるまで、指定のポートから順に試す */
    listen(startPort, tries = 20) {
      return new Promise((resolve, reject) => {
        const attempt = (p, left) => {
          const onError = (err) => {
            server.off('listening', onListening);
            if (err.code === 'EADDRINUSE' && left > 1) attempt(p + 1, left - 1);
            else reject(err);
          };
          const onListening = () => {
            server.off('error', onError);
            port = server.address().port;
            resolve(port);
          };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(p, '127.0.0.1');
        };
        attempt(startPort, tries);
      });
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
