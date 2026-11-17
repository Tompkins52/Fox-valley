#!/usr/bin/env node
// Packs src/ into one locked file, preview.bin, that only opens with the password.
//
//   node tools/pack.mjs <password>          (or set FPL_PASSWORD)
//   node tools/pack.mjs <password> --new-salt     asks every device for the password again
//
// Nothing in src/ is committed. preview.bin holds all of it, encrypted.
// It also rewrites website/index.html, member/index.html and staff/index.html from the login page, so the three
// links always carry the same lock and the same version.
// Format: "FPL1" | salt (16) | iv (12) | AES-256-GCM( gzip( container ) )
// Container: "FPB1" | u32 count | [ u16 pathLen | path | u32 dataLen | data ] ...
// Key: PBKDF2-HMAC-SHA256, 600,000 rounds, from the trimmed, lowercased password.

import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const outFile = path.join(root, 'preview.bin');
const ROUNDS = 600000;

const args = process.argv.slice(2);
const password = (args.find((a) => !a.startsWith('--')) || process.env.FPL_PASSWORD || '').trim().toLowerCase();
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

// The salt stays the same from one build to the next. The key a device keeps ("Keep me logged in") comes from the
// password and the salt, so a new salt on every build would ask every phone for the password after every update.
// A new password changes the key anyway. --new-salt changes it on purpose.
let salt = crypto.getRandomValues(new Uint8Array(16));
if (!args.includes('--new-salt')) {
  try {
    const old = await readFile(outFile);
    if (old.length > 32 && old.subarray(0, 4).toString() === 'FPL1') salt = new Uint8Array(old.subarray(4, 20));
  } catch (e) { /* no earlier file: start with a fresh salt */ }
}
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

// The website, the member app and the staff app each get a page of their own, which opens that part by itself.
// The two apps can also be put on a home screen. Each page is the login page with a few lines changed. Names here
// are plain on purpose: these files sit outside the lock, so they must not say whose website or apps they are.
const APPS = [
  { dir: 'website', only: 'site', name: 'Website', colour: '#000000', install: false },
  { dir: 'member', only: 'app', name: 'Member app', long: 'Fitness member app', colour: '#000000', install: true },
  { dir: 'staff', only: 'staff', name: 'Staff app', long: 'Fitness staff app', colour: '#ffffff', install: true },
];
const swap = (text, from, to, what) => {
  if (!text.includes(from)) { console.error('The login page is missing the part that marks ' + what + '. Not written.'); process.exit(1); }
  return text.replace(from, () => to);
};
const page = stamped;
for (const app of APPS) {
  // The same tags go on the login page and, once it is unlocked, on the app that replaces it.
  // Only the bar colour differs: the login page is dark, the staff app is light.
  const tagsFor = (colour) => !app.install ? '<meta name="theme-color" content="' + colour + '">' : [
    '<link rel="manifest" href="app.webmanifest">',
    '<meta name="theme-color" content="' + colour + '">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
    '<meta name="apple-mobile-web-app-title" content="' + app.name + '">',
    '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
    '<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">',
  ].join('');
  const tags = tagsFor(app.colour);
  let html = page;
  html = swap(html, '<title>Fitness Product Login</title>', '<title>' + app.name + '</title>', 'the title');
  html = swap(html, '<!--shell-->', tagsFor('#0c0c0d').replace(/></g, '>\n<'), 'the head');
  html = swap(html, "var BIN = 'preview.bin?v=", "var BIN = '../preview.bin?v=", 'the locked file');
  html = swap(html, 'var APP = null;', 'var APP = ' + JSON.stringify({ only: app.only, name: app.name, install: app.install, tags }).replace(/</g, '\\u003c') + ';', 'the app');
  const manifest = {
    id: '/' + app.dir + '/', name: app.long, short_name: app.name, description: 'A private preview. It opens with a password.',
    start_url: '/' + app.dir + '/', scope: '/' + app.dir + '/', display: 'standalone', background_color: app.colour, theme_color: app.colour,
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  await mkdir(path.join(root, app.dir), { recursive: true });
  await writeFile(path.join(root, app.dir, 'index.html'), html);
  if (app.install) await writeFile(path.join(root, app.dir, 'app.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
}

const kb = (n) => Math.round(n / 1024) + ' KB';
console.log(`Packed ${files.length} files (${kb(rawBytes)}) into preview.bin (${kb(cipher.length + 32)}). Wrote the website, member and staff pages.`);
