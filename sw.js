// Minimalny service worker – pozwala zainstalować aplikację na telefonie. Zawsze pobiera świeże pliki.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
