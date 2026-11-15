#!/usr/bin/env node
// Opens preview.bin with the password and writes its files back into src/.
//
//   node tools/unpack.mjs <password> [--force]
//
// Use --force to overwrite an existing src/ folder.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const args = process.argv.slice(2);
const force = args.includes('--force');
const password = (args.find((a) => !a.startsWith('--')) || process.env.FPL_PASSWORD || '').trim().toLowerCase();
if (!password) {
  console.error('Give the password: node tools/unpack.mjs <password>');
  process.exit(1);
}

const exists = await access(srcDir).then(() => true, () => false);
if (exists && !force) {
  console.error('src/ already exists. Add --force to overwrite it.');
  process.exit(1);
}

const buf = await readFile(path.join(root, 'preview.bin'));
if (buf.subarray(0, 4).toString() !== 'FPL1') {
  console.error('preview.bin is not in the expected format.');
  process.exit(1);
}
const salt = buf.subarray(4, 20);
const iv = buf.subarray(20, 32);
const cipher = buf.subarray(32);
const enc = new TextEncoder();
const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
  baseKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['decrypt']
);
let zipped;
try {
  zipped = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
} catch (e) {
  console.error('That password does not open preview.bin.');
  process.exit(1);
}
const c = gunzipSync(zipped);
if (c.subarray(0, 4).toString() !== 'FPB1') {
  console.error('Unexpected contents.');
  process.exit(1);
}
let o = 4;
const count = c.readUInt32BE(o); o += 4;
for (let i = 0; i < count; i++) {
  const pl = c.readUInt16BE(o); o += 2;
  const rel = c.subarray(o, o + pl).toString('utf8'); o += pl;
  const dl = c.readUInt32BE(o); o += 4;
  const data = c.subarray(o, o + dl); o += dl;
  if (rel.includes('..') || path.isAbsolute(rel)) continue;
  const dest = path.join(srcDir, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, data);
}
console.log(`Wrote ${count} files to src/.`);
