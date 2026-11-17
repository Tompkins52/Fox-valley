// Lets the member app and the staff app open with no connection once they have been opened online.
// It keeps the login page, the locked file and the home screen icons. Nothing readable is ever stored here:
// the locked file only opens in the page, with the password.
const CACHE = 'fpl-shell-1';

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('fpl-shell-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate';
  const isLocked = /\/preview\.bin$/.test(url.pathname);
  const isShell = /\.(webmanifest|png)$/.test(url.pathname);
  if (!isPage && !isLocked && !isShell) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // The locked file carries its version in its address, so a copy already held is always the right one.
    if (isLocked) {
      const held = await cache.match(req.url);
      if (held) return held;
      const fresh = await fetch(req);
      if (fresh.ok) {
        await cache.put(req.url, fresh.clone());
        const keys = await cache.keys();
        await Promise.all(keys.filter((k) => /\/preview\.bin$/.test(new URL(k.url).pathname) && k.url !== req.url).map((k) => cache.delete(k)));
      }
      return fresh;
    }
    // Pages and icons: the network first, so an update shows up at once. The held copy is for when there is no connection.
    const key = isPage ? url.origin + url.pathname : req.url;
    try {
      const fresh = await fetch(req);
      if (fresh.ok) await cache.put(key, fresh.clone());
      return fresh;
    } catch (err) {
      const held = await cache.match(key);
      if (held) return held;
      throw err;
    }
  })());
});
