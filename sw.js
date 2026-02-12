// sw.js
"use strict";

const CACHE_NAME = "whitemuse-cache-v2";

// まず最初に「必ず動く最低限」だけを保存する
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key)))
      ))
      .then(() => self.clients.claim())
  );
});

// 基本方針：
// - HTMLは「新しいの優先」(更新がすぐ反映される)
// - CSS/JS/manifest/iconは「キャッシュ優先」(安定)
// - それ以外(外部CDN/画像など)は「そのままネット優先」
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GET以外は触らない
  if (req.method !== "GET") return;

  // 他ドメイン（CDNなど）はそのまま（壊れにくい）
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(req));
    return;
  }

  const path = url.pathname;

  // HTMLだけは「ネット優先」→ 最新がすぐ出る
  const isHTML =
    req.mode === "navigate" ||
    path.endsWith("/") ||
    path.endsWith(".html");

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // それ以外は「キャッシュ優先」
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      });
    })
  );
});
