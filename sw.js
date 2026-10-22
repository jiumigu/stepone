// ============================================================
// sw.js — 离线外壳（PWA）
//
// 策略：network-first。联网时永远拿最新代码（改一行立即生效），
// 断网时回落到缓存里的外壳。比 cache-first 更适合还在迭代的阶段，
// 也避免「改了 JS 但页面没变」这类最难查的困惑。
// ============================================================

const VERSION = 'stepone-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/style.css',
  './src/app.js',
  './src/core/util.js',
  './src/core/store.js',
  './src/core/points.js',
  './src/core/goals.js',
  './src/core/todos.js',
  './src/core/routines.js',
  './src/core/joy.js',
  './src/core/gifts.js',
  './src/core/selectors.js',
  './src/ui/components.js',
  './src/ui/pickers.js',
  './src/ui/today.js',
  './src/ui/goals.js',
  './src/ui/calendar.js',
  './src/ui/bank.js',
  './src/ui/data.js',
  './src/ui/routines.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // 只缓存成功的基本响应，避免把 404 存下来
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('离线，且这条资源没有缓存', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }),
  );
});
