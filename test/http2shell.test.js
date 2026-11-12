// HTTP2Shell（Node2Shell / CVE-2026-111497）対策のテスト
//
//   npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, hasBrotliEncoding } from '../lib/server.js';

const SAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sample');

describe('hasBrotliEncoding', () => {
  test('br を含むものは true', () => {
    assert.equal(hasBrotliEncoding({ 'content-encoding': 'br' }), true);
    assert.equal(hasBrotliEncoding({ 'content-encoding': 'BR' }), true);
    assert.equal(hasBrotliEncoding({ 'content-encoding': 'deflate, br' }), true);
    assert.equal(hasBrotliEncoding({ 'content-encoding': 'gzip,Br ' }), true);
    assert.equal(hasBrotliEncoding({ 'content-encoding': ['gzip', 'br'] }), true);
  });

  test('br を含まないものは false', () => {
    assert.equal(hasBrotliEncoding({}), false);
    assert.equal(hasBrotliEncoding({ 'content-encoding': 'gzip' }), false);
    assert.equal(hasBrotliEncoding({ 'content-encoding': 'identity' }), false);
    // "br" を一部に含むだけの別の値は対象外
    assert.equal(hasBrotliEncoding({ 'content-encoding': 'xbr' }), false);
  });
});

describe('サーバー', () => {
  let app;
  let port;

  before(async () => {
    app = createServer(SAMPLE);
    port = await app.listen(4980);
  });
  after(() => app.close());

  /** 指定したヘッダー・メソッド・本文でリクエストを送り、ステータスを返す */
  const request = (method, headers, body) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/files', method, headers: { host: `127.0.0.1:${port}`, ...headers } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

  test('br の GET は 415', async () => {
    assert.equal(await request('GET', { 'content-encoding': 'br' }), 415);
  });

  test('br の POST は（405 より先に）415', async () => {
    // 中身は Brotli として壊れたデータ。展開されないので、何が入っていても 415 で終わる
    const junk = Buffer.from([0x1b, 0xff, 0xff, 0xff, 0x00, 0x13, 0x37]);
    assert.equal(await request('POST', { 'content-encoding': 'gzip, BR', 'content-length': junk.length }, junk), 415);
  });

  test('ほかの Host から来た br も 415（すべての確認より先に断る）', async () => {
    assert.equal(await request('GET', { host: 'evil.example', 'content-encoding': 'br' }), 415);
  });

  test('br でなければ、これまでどおり動く', async () => {
    assert.equal(await request('GET', {}), 200);
    assert.equal(await request('GET', { 'content-encoding': 'gzip' }), 200);
    assert.equal(await request('POST', {}), 405);
  });
});
