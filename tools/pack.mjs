#!/usr/bin/env node
// Packs src/ into one locked file, preview.bin, that only opens with the password.
//
//   node tools/pack.mjs <password>          (or set FPL_PASSWORD)
//
// Nothing in src/ is committed. preview.bin holds all of it, encrypted.
// Format: "FPL1" | salt (16) | iv (12) | AES-256-GCM( gzip( container ) )
// Container: "FPB1" | u32 count | [ u16 pathLen | path | u32 dataLen | data ] ...
// Key: PBKDF2-HMAC-SHA256, 600,000 rounds, from the trimmed, lowercased password.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const outFile = path.join(root, 'preview.bin');
const ROUNDS = 600000;

const password = (process.argv[2] || process.env.FPL_PASSWORD || '').trim().toLowerCase();
if (!password) {
  console.error('Give the password: node tools/pack.mjs <password>');
  process.exit(1);
}

async function walk(dir, base = '') {
  const out = [];
  for (const name of (await readdir(dir)).sort()) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full, rel)));
    else out.push(rel);
  }
  return out;
}

const files = await walk(srcDir);
if (!files.includes('index.html')) {
  console.error('src/index.html is missing. Run tools/unpack.mjs first, or check the folder.');
  process.exit(1);
}

const enc = new TextEncoder();
const parts = [enc.encode('FPB1')];
const count = Buffer.alloc(4);
count.writeUInt32BE(files.length);
parts.push(count);
let rawBytes = 0;
for (const rel of files) {
  const data = await readFile(path.join(srcDir, rel));
  const p = enc.encode(rel);
  const head = Buffer.alloc(2);
  head.writeUInt16BE(p.length);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  parts.push(head, p, len, data);
  rawBytes += data.length;
}
const container = Buffer.concat(parts);
const zipped = gzipSync(container, { level: 9 });

const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: ROUNDS, hash: 'SHA-256' },
  baseKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt']
);
const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, zipped));

const packed = Buffer.concat([enc.encode('FPL1'), salt, iv, cipher]);
await writeFile(outFile, packed);

// Stamp the login page with this build so browsers and caches never pair it with an older file.
const stamp = Buffer.from(await crypto.subtle.digest('SHA-256', packed)).toString('hex').slice(0, 10);
const pagePath = path.join(root, 'index.html');
const pageHtml = await readFile(pagePath, 'utf8');
const stamped = pageHtml.replace(/preview\.bin\?v=[0-9a-f]+/, 'preview.bin?v=' + stamp);
if (stamped !== pageHtml) await writeFile(pagePath, stamped);
const kb = (n) => Math.round(n / 1024) + ' KB';
console.log(`Packed ${files.length} files (${kb(rawBytes)}) into preview.bin (${kb(cipher.length + 32)}).`);
