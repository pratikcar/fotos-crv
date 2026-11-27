// Service worker: deixa o app abrir sem internet e envia fotos em segundo plano.
const CACHE = 'fotos-patio-v1.0.8';
const ARQUIVOS = [
  './', './index.html', './campo.js', './style.css', './config.js', './sync-core.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png'
];

importScripts('./config.js', './sync-core.js');

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API não passa pelo cache
  if (url.pathname.endsWith('/gestor.html') || url.pathname.endsWith('/gestor.js')) return; // página de gestão é só online
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cache) {
      const rede = fetch(req).then(function (resp) {
        if (resp && resp.ok) { const copia = resp.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); }); }
        return resp;
      }).catch(function () { return cache; });
      return cache || rede;
    })
  );
});

self.addEventListener('sync', function (e) {
  if (e.tag !== 'enviar-fotos') return;
  e.waitUntil(Nucleo.sincronizarFila().then(function (r) {
    avisarPaginas(r);
    if (r.motivo === 'rede') throw new Error('sem rede — o navegador tenta de novo');
  }));
});

function avisarPaginas(r) {
  self.clients.matchAll().then(function (cs) { cs.forEach(function (c) { c.postMessage({ tipo: 'sync', resultado: r }); }); });
}
