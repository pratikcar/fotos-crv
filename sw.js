// Service worker: deixa o app abrir sem internet e envia fotos em segundo plano.
const CACHE = 'fotos-patio-v1.1.8';
const ARQUIVOS = [
  './', './index.html', './campo.js', './style.css', './config.js', './sync-core.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './icones.js',
  './favicon.png', './apple-touch-icon.png', './logo-simbolo.png', './logo.png'
];

importScripts('./config.js', './sync-core.js');

// Todos os arquivos de uma versão entram juntos num cache próprio (nunca mistura versões).
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ARQUIVOS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
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
  // só do cache desta versão; o que não estiver nele vem da rede (sem gravar por cima)
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (r) { return r || fetch(req); });
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
