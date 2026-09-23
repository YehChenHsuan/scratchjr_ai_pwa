/* global self, caches, fetch, Response */
// SW Build Version: 2026-09-23T03:19:06.655Z
importScripts('./precache-manifest.js');

const CACHE_PREFIX = 'scratchjr-';
const CORE_CACHE = CACHE_PREFIX + 'core-' + self.__SCRATCHJR_PRECACHE_VERSION;
// AI 模型檔案獨立版本號，防止核心檔案更新時刪除 24MB 模型快取
const AI_CACHE = CACHE_PREFIX + 'ai-' + (self.__SCRATCHJR_AI_VERSION || self.__SCRATCHJR_PRECACHE_VERSION);
const MEDIA_CACHE = 'scratchjr-media';

const CORE_URLS = self.__SCRATCHJR_CORE_URLS || [];
const AI_URLS = self.__SCRATCHJR_AI_URLS || [];
const CORE_HASHES = self.__SCRATCHJR_CORE_HASHES || {};
const AI_HASHES = self.__SCRATCHJR_AI_HASHES || {};

const CRITICAL_URLS = ['./index.html', './home.html', './editor.html', './app.bundle.js', './settings.json'];

// intro.mp4 背景完整下載去重 Promise
let introDownloadPromise = null;
function ensureIntroCached (url) {
    if (introDownloadPromise) return introDownloadPromise;
    introDownloadPromise = (async () => {
        try {
            const mediaCache = await caches.open(MEDIA_CACHE);
            const cached = await mediaCache.match(url);
            if (cached) return;
            // 發起無 Range 標頭的完整 GET 請求以取得完整 200 回應
            const response = await fetch(url, {credentials: 'same-origin', cache: 'no-store'});
            if (response && response.status === 200) {
                const clean = await cleanResponse(response);
                await mediaCache.put(url, clean);
            }
        } catch (err) {
            // 背景快取失敗時靜默忽略，不中斷當前播放
        } finally {
            introDownloadPromise = null;
        }
    })();
    return introDownloadPromise;
}

/**
 * 淨化 Response 並保留/注入必要的自訂標頭（如 X-SJR-Hash 用於增量快取比對）
 */
function cleanResponse (response, extraHeaders = {}) {
    if (!response || !response.ok) return Promise.resolve(response);
    return response.blob().then(body => {
        const headers = {
            'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
            ...extraHeaders
        };
        // 若原始回應已有 X-SJR-Hash 且未指定新的，則予以保留
        if (!headers['X-SJR-Hash'] && response.headers.get('X-SJR-Hash')) {
            headers['X-SJR-Hash'] = response.headers.get('X-SJR-Hash');
        }
        return new Response(body, {
            status: 200,
            headers
        });
    });
}

/**
 * 增量快取檔案清單：
 * 1. 先檢驗舊快取（scratchjr-core-* / scratchjr-ai-*），若存在同 URL 且 X-SJR-Hash 相同，直接複製，免去網路頻寬
 * 2. 僅對新增或 Hash 異動的檔案發起 fetch
 * 3. 進度通知同時計算複製與下載的項目，保持進度條平滑
 */
function cacheFiles (cacheName, urls, hashes, notify) {
    return caches.open(cacheName).then(async cache => {
        const prefix = cacheName.indexOf(CACHE_PREFIX + 'core-') === 0 ? 'core-' : 'ai-';
        const allKeys = await caches.keys();
        const oldCacheNames = allKeys.filter(k => k.indexOf(CACHE_PREFIX + prefix) === 0 && k !== cacheName);
        const oldCaches = await Promise.all(oldCacheNames.map(k => caches.open(k)));

        let completed = 0;
        let next = 0;
        const results = [];

        const worker = async () => {
            const index = next++;
            if (index >= urls.length) return;
            const url = urls[index];
            const expectedHash = hashes ? hashes[url] : null;

            try {
                let matchedResponse = null;
                // 從舊快取尋找內容一致的項目
                if (expectedHash && oldCaches.length > 0) {
                    for (const oldCache of oldCaches) {
                        const cached = await oldCache.match(url, {ignoreSearch: true, ignoreVary: true});
                        if (cached) {
                            const cachedHash = cached.headers.get('X-SJR-Hash');
                            if (cachedHash && cachedHash === expectedHash) {
                                matchedResponse = cached;
                                break;
                            }
                        }
                    }
                }

                if (matchedResponse) {
                    // 直接重用既有快取
                    await cache.put(url, matchedResponse.clone());
                    results[index] = {url, ok: true, reused: true};
                } else {
                    // 發起網路下載
                    const r = await fetch(url, {credentials: 'same-origin', cache: 'no-store'});
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    const extraHeaders = expectedHash ? {'X-SJR-Hash': expectedHash} : {};
                    const clean = await cleanResponse(r, extraHeaders);
                    await cache.put(url, clean);
                    results[index] = {url, ok: true, reused: false};
                }
            } catch (error) {
                results[index] = {url, ok: false, error};
            }

            completed++;
            if (notify) notify(completed, urls.length);
            return worker();
        };

        const workers = [];
        const concurrency = Math.min(4, urls.length);
        for (let i = 0; i < concurrency; i++) workers.push(worker());
        await Promise.all(workers);
        return results;
    });
}

self.addEventListener('install', event => {
    event.waitUntil(cacheFiles(CORE_CACHE, CORE_URLS, CORE_HASHES, (completed, total) => {
        if (completed === total || completed % 5 === 0) {
            notifyClients({type: 'CORE_CACHE_PROGRESS', completed, total});
        }
    }).then(results => {
        const failed = results.filter(item => !item.ok).length;
        return notifyClients({type: 'CORE_CACHE_COMPLETE', total: results.length, failed}).then(() => results);
    }).then(results => {
        const failedCritical = results.filter(item => !item.ok && CRITICAL_URLS.indexOf(item.url) > -1);
        if (failedCritical.length) throw new Error('Critical PWA files failed to cache');
        return self.skipWaiting();
    }));
});

self.addEventListener('activate', event => {
    // 保留當前 CORE_CACHE、AI_CACHE 與固定名稱 MEDIA_CACHE
    // 另外：如果新的 AI_CACHE 尚未填滿（未包含全部 AI 資源），保留舊的 AI 快取避免離線失效
    event.waitUntil((async () => {
        const keys = await caches.keys();
        const currentAiCache = await caches.open(AI_CACHE);
        const currentAiCount = (await currentAiCache.keys()).length;

        await Promise.all(keys
            .filter(key => {
                if (key.indexOf(CACHE_PREFIX) !== 0) return false;
                if (key === CORE_CACHE || key === AI_CACHE || key === MEDIA_CACHE) return false;
                // 若新 AI 快取未完成下載，暫不清除舊 AI 模型快取
                if (key.indexOf(CACHE_PREFIX + 'ai-') === 0 && currentAiCount < AI_URLS.length) return false;
                return true;
            })
            .map(key => caches.delete(key))
        );
        return self.clients.claim();
    })());
});

function isAppCode (url) {
    return url.pathname.endsWith('.html') || url.pathname.endsWith('.css') ||
        url.pathname.endsWith('/app.bundle.js') || url.pathname.endsWith('/') ||
        url.pathname.endsWith('/media.json') || url.pathname.endsWith('/settings.json');
}

function notifyClients (message) {
    return self.clients.matchAll({includeUncontrolled: true}).then(clients => {
        clients.forEach(client => client.postMessage(message));
    });
}

function cacheAI () {
    return caches.open(AI_CACHE).then(cache => cache.keys().then(keys => {
        if (keys.length >= AI_URLS.length) return null;
        return cacheFiles(AI_CACHE, AI_URLS, AI_HASHES, (completed, total) => {
            if (completed === total || completed % 5 === 0) {
                notifyClients({type: 'AI_CACHE_PROGRESS', completed, total});
            }
        }).then(results => {
            const failed = results.filter(item => !item.ok).length;
            return notifyClients({type: 'AI_CACHE_COMPLETE', total: results.length, failed});
        });
    }));
}

self.addEventListener('message', event => {
    if (!event.data) return;
    if (event.data.type === 'CACHE_AI') {
        event.waitUntil(cacheAI());
    } else if (event.data.type === 'GET_CACHE_STATUS') {
        event.waitUntil(Promise.all([
            caches.open(CORE_CACHE).then(cache => cache.keys()).then(keys => keys.length),
            caches.open(AI_CACHE).then(cache => cache.keys()).then(keys => keys.length)
        ]).then(([coreCached, aiCached]) => {
            const message = {
                type: 'CACHE_STATUS',
                coreCached,
                coreTotal: CORE_URLS.length,
                aiCached,
                aiTotal: AI_URLS.length
            };
            if (event.source) event.source.postMessage(message);
            else return notifyClients(message);
        }));
    }
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    const range = request.headers.get('range');
    if (range) {
        event.respondWith(caches.match(request.url, {ignoreSearch: true, ignoreVary: true}).then(cached => {
            if (!cached) {
                // 若為 intro.mp4 影片且尚未快取，在背景發起無 Range 完整快取（去重），同時本次請求放行即時播放
                if (url.pathname.indexOf('intro.mp4') > -1) {
                    event.waitUntil(ensureIntroCached(request.url));
                }
                return fetch(request);
            }
            const match = /^bytes=(\d+)-(\d*)$/.exec(range);
            if (!match) return cached;
            return cached.blob().then(blob => {
                const total = blob.size;
                const start = Number(match[1]);
                const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
                if (start >= total || start > end) {
                    return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + total}});
                }
                const chunk = blob.slice(start, end + 1);
                return new Response(chunk, {
                    status: 206,
                    headers: {
                        'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
                        'Content-Length': String(end - start + 1),
                        'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
                        'Accept-Ranges': 'bytes'
                    }
                });
            });
        }));
        return;
    }

    if (isAppCode(url) || request.mode === 'navigate') {
        event.respondWith(fetch(request).then(response => {
            if (!response || response.status !== 200) return response;
            const copy = response.clone();
            cleanResponse(copy).then(clean => caches.open(CORE_CACHE).then(cache => cache.put(request, clean)));
            return response;
        }).catch(() => caches.match(request, {ignoreSearch: true, ignoreVary: true})
            .then(cached => cached || caches.match('./index.html', {ignoreVary: true}))));
        return;
    }

    const targetCache = url.pathname.indexOf('/vendor/ai/') > -1 ? AI_CACHE : CORE_CACHE;
    event.respondWith(caches.match(request, {ignoreVary: true})
        .then(cached => cached || caches.match(request, {ignoreSearch: true, ignoreVary: true}))
        .then(cached => cached || fetch(request).then(response => {
            if (!response || response.status !== 200) return response;
            const copy = response.clone();
            cleanResponse(copy).then(clean => caches.open(targetCache).then(cache => cache.put(request, clean)));
            return response;
        }).catch(() => new Response('', {status: 503, statusText: 'Offline'}))));
});
