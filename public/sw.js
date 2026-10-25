// NU Safety Inspection — Service Worker (ขอบเขตจำกัด)
// - แคชเฉพาะไฟล์คงที่ (JS/CSS/ฟอนต์/ไอคอน) เพื่อให้เปิดแอปได้เร็วขึ้น
// - ไม่แคชข้อมูลจากฐานข้อมูล และ "ไม่รองรับการส่งผลตรวจแบบออฟไลน์"
// - เมื่อออฟไลน์และเปิดหน้าใหม่ จะแสดง /offline.html (ฉบับร่างที่กรอกค้างยังอยู่ใน localStorage ของหน้าตรวจ)
const CACHE = "nu-safety-static-v2";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline.html", "/icons/favicon.png", "/nu-logo.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
  }
});
