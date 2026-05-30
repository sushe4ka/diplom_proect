// ==============================================
// SERVICE WORKER для кэширования статических файлов
// ==============================================

const CACHE_NAME = 'beautybooking-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff2'
];

// Установка Service Worker – кэшируем файлы
self.addEventListener('install', event => {
    console.log('[SW] Установка');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Кэширование файлов');
                return cache.addAll(urlsToCache);
            })
            .catch(err => console.error('[SW] Ошибка кэширования:', err))
    );
    // Принудительно активируем новый SW сразу
    self.skipWaiting();
});

// Активация – удаляем старые кэши
self.addEventListener('activate', event => {
    console.log('[SW] Активация');
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => {
                    console.log('[SW] Удаление старого кэша:', key);
                    return caches.delete(key);
                })
            );
        })
    );
    // Захватываем контроль над всеми клиентами
    self.clients.claim();
});

// Перехват запросов – сначала ищем в кэше, затем в сети
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Если есть в кэше – возвращаем из кэша
                if (response) {
                    return response;
                }
                // Иначе делаем запрос в сеть
                return fetch(event.request)
                    .then(networkResponse => {
                        // Не кэшируем ответы с ошибками и неподходящие
                        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                            return networkResponse;
                        }
                        // Кэшируем успешный ответ для будущих запросов
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });
                        return networkResponse;
                    })
                    .catch(() => {
                        // Офлайн: можно вернуть заглушку, если нужно
                        console.log('[SW] Нет сети, запрос не в кэше:', event.request.url);
                        // Для HTML-страниц можно вернуть fallback (опционально)
                        if (event.request.headers.get('accept').includes('text/html')) {
                            return caches.match('/index.html');
                        }
                        return new Response('Нет подключения к интернету', { status: 503 });
                    });
            })
    );
});