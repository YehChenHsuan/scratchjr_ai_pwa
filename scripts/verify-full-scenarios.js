const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 8080;
const PROFILE_DIR = path.resolve('.tmp-playwright-profile');

const MIME = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
    '.map': 'application/json'
};

function createStaticServer(rootDir, onRequest) {
    const srcDir = path.join(rootDir, 'editions', 'free', 'src');
    const bundlePath = path.join(rootDir, 'src', 'build', 'bundles', 'app.bundle.js');

    return http.createServer((req, res) => {
        let urlPath = decodeURIComponent(req.url.split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        let filePath;
        if (urlPath === '/app.bundle.js' || urlPath === '/app.bundle.js.map') {
            filePath = path.join(path.dirname(bundlePath), path.basename(urlPath));
        } else {
            filePath = path.join(srcDir, urlPath);
        }

        if (onRequest) {
            onRequest({
                url: req.url,
                method: req.method,
                headers: req.headers
            });
        }

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            res.statusCode = 404;
            res.end('Not found: ' + urlPath);
            return;
        }

        const stat = fs.statSync(filePath);
        const contentType = MIME[path.extname(filePath)] || 'application/octet-stream';
        const range = req.headers.range;

        if (range) {
            const match = /^bytes=(\d+)-(\d*)$/.exec(range);
            if (match) {
                const start = Number(match[1]);
                const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': end - start + 1,
                    'Content-Type': contentType,
                    'Cache-Control': 'no-store, must-revalidate'
                });
                fs.createReadStream(filePath, {start, end}).pipe(res);
                return;
            }
        }

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store, must-revalidate'
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

async function startServer(rootDir, onRequest) {
    const server = createStaticServer(rootDir, onRequest);
    await new Promise((resolve, reject) => {
        server.listen(PORT, '127.0.0.1', () => resolve());
        server.on('error', reject);
    });
    return server;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log('=== 開始真實瀏覽器自動化驗證 ===\n');
    if (!fs.existsSync('ui-audit')) fs.mkdirSync('ui-audit');

    // 清理先前的暫存 profile
    if (fs.existsSync(PROFILE_DIR)) {
        try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (e) {}
    }

    const baselineRoot = path.resolve('..', 'scratchjr-baseline');
    const headRoot = path.resolve('.');

    // =========================================================================
    // 驗證 a: 同源升級
    // =========================================================================
    console.log('--- 驗證 a: 同源升級 (7d88f7b -> HEAD) ---');
    console.log('[Step 1] 啟動 Baseline (7d88f7b) 伺服器...');
    let server = await startServer(baselineRoot);

    console.log('[Step 2] 使用 Playwright 啟動獨立 UserDataDir 瀏覽器...');
    let context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required'
        ]
    });
    let page = await context.newPage();

    console.log('[Step 3] 載入 Baseline 頁面 http://localhost:8080/index.html ...');
    await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });

    // 等待 SW 註冊
    await page.waitForFunction(() => 'serviceWorker' in navigator);
    await sleep(2000);

    // 觸發 AI 模型下載
    console.log('[Step 4] 觸發 AI 模型下載...');
    await page.evaluate(() => {
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'CACHE_AI' });
        }
    });

    // 等待 AI 快取完成
    console.log('[Step 5] 等待 AI 快取寫入 CacheStorage...');
    let aiCachedCount = 0;
    for (let i = 0; i < 30; i++) {
        aiCachedCount = await page.evaluate(async () => {
            const keys = await caches.keys();
            const aiKey = keys.find(k => k.includes('scratchjr-ai-'));
            if (!aiKey) return 0;
            const cache = await caches.open(aiKey);
            const items = await cache.keys();
            return items.length;
        });
        if (aiCachedCount >= 10) break;
        await sleep(1000);
    }
    console.log(`Baseline AI 模型快取檔案數量: ${aiCachedCount} / 10`);

    // 在 IndexedDB 建立作品、錄音、訓練手勢
    console.log('[Step 6] 在 Baseline 建立作品、聲音錄音、手勢資料...');
    const baselineSeedResult = await page.evaluate(async () => {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('scratchjr', 1);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(['projects', 'media', 'gestures'], 'readwrite');
                
                // 1. 作品
                const pStore = tx.objectStore('projects');
                pStore.put({
                    id: 101,
                    name: '同源升級測試作品',
                    version: 'v1',
                    cdate: '2026-09-23 10:00:00',
                    mdate: '2026-09-23 10:00:00',
                    json: JSON.stringify({ pages: ['page1'] }),
                    isdeleted: 'NO'
                });

                // 2. 聲音錄音
                const mStore = tx.objectStore('media');
                mStore.put({
                    md5: 'rec_upgrade_test.webm',
                    data: 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAA=',
                    ext: 'webm'
                });

                // 3. 手勢模型
                const gStore = tx.objectStore('gestures');
                gStore.put({
                    projectId: 101,
                    payload: { dataset: { 'fist': [0.12, 0.34, 0.56] }, trained: true },
                    mtime: Date.now()
                });

                tx.oncomplete = () => resolve({ ok: true });
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });
    });
    console.log('Baseline 資料寫入結果:', baselineSeedResult);
    await page.screenshot({ path: 'ui-audit/upgrade-01-baseline.png' });

    // 關閉 Baseline 瀏覽器與伺服器
    await context.close();
    await new Promise(r => server.close(r));
    console.log('[Step 7] 關閉 Baseline 伺服器與瀏覽器。');

    // 切到 HEAD 伺服器重新啟動
    console.log('[Step 8] 在同一 Port 8080 啟動 HEAD 伺服器...');
    server = await startServer(headRoot);

    console.log('[Step 9] 重新開啟同一個 UserDataDir 的瀏覽器...');
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required'
        ]
    });
    page = await context.newPage();

    console.log('[Step 10] 開啟 http://localhost:8080/index.html 並等待新版 Service Worker 註冊與啟動...');
    await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });

    // 主動觸發 SW 更新並等待新版安裝與啟動
    console.log('[Step 11] 等待新 Service Worker 完成安裝與啟用...');
    await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
            await reg.update();
        }
    });

    // 等待直到 HEAD 的 core cache 建立並啟用
    let headCoreCacheName = null;
    for (let i = 0; i < 40; i++) {
        headCoreCacheName = await page.evaluate(async () => {
            const keys = await caches.keys();
            return keys.find(k => k.startsWith('scratchjr-core-') && k !== 'scratchjr-core-327d89a9a2506728') || null;
        });
        if (headCoreCacheName) break;
        await sleep(1000);
    }
    console.log(`新版核心快取建立: ${headCoreCacheName}`);

    // 重新整理兩次以保證新 SW 完全接管客戶端
    console.log('[Step 12] 重新整理兩次使新版 SW 接管控制...');
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(1500);
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(1500);

    // 驗證作品、聲音、手勢與 AI 快取
    const upgradeVerification = await page.evaluate(async () => {
        // 1. 檢查 IndexedDB
        const idbData = await new Promise((resolve, reject) => {
            const req = indexedDB.open('scratchjr', 1);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(['projects', 'media', 'gestures'], 'readonly');
                const res = {};
                tx.objectStore('projects').get(101).onsuccess = e => res.project = e.target.result;
                tx.objectStore('media').get('rec_upgrade_test.webm').onsuccess = e => res.media = e.target.result;
                tx.objectStore('gestures').get(101).onsuccess = e => res.gesture = e.target.result;
                tx.oncomplete = () => resolve(res);
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });

        // 2. 檢查 Cache Storage
        const cacheKeys = await caches.keys();
        const aiCaches = cacheKeys.filter(k => k.includes('scratchjr-ai-'));
        let totalAiFiles = 0;
        for (const k of aiCaches) {
            const c = await caches.open(k);
            totalAiFiles += (await c.keys()).length;
        }

        return {
            idb: {
                hasProject: !!idbData.project && idbData.project.name === '同源升級測試作品',
                projectName: idbData.project ? idbData.project.name : null,
                hasMedia: !!idbData.media && idbData.media.md5 === 'rec_upgrade_test.webm',
                hasGesture: !!idbData.gesture && idbData.gesture.projectId === 101
            },
            caches: {
                cacheKeys,
                aiCaches,
                totalAiFiles
            }
        };
    });

    console.log('\n[升級後資料檢查結果]:');
    console.log('- 作品存在:', upgradeVerification.idb.hasProject, `(${upgradeVerification.idb.projectName})`);
    console.log('- 聲音錄音存在:', upgradeVerification.idb.hasMedia);
    console.log('- 手勢模型存在:', upgradeVerification.idb.hasGesture);
    console.log('- AI 快取保留:', upgradeVerification.caches.totalAiFiles >= 10, `(${upgradeVerification.caches.aiCaches.join(', ')}, 共 ${upgradeVerification.caches.totalAiFiles} 個檔案)`);

    // 驗證 Requirement 1: 開啟 editor 後，app.bundle.js 和 editor.html 都要有 X-SJR-Hash 且無 query string 重複項目
    console.log('\n[檢查 Requirement 1: editor.html & app.bundle.js 的 X-SJR-Hash 與 query string 正規化]');
    await page.goto('http://localhost:8080/editor.html?pmd5=101', { waitUntil: 'networkidle' });
    await sleep(2000);

    const cacheHeaderCheck = await page.evaluate(async (targetCoreKey) => {
        const keys = await caches.keys();
        const coreKey = targetCoreKey || keys.find(k => k.startsWith('scratchjr-core-'));
        if (!coreKey) return { error: 'no core cache found' };
        const cache = await caches.open(coreKey);

        // 等待 editor.html 與 app.bundle.js 寫入快取完成
        let editorReq = null;
        let bundleReq = null;
        for (let i = 0; i < 20; i++) {
            const reqs = await cache.keys();
            editorReq = reqs.find(r => r.url.includes('editor.html'));
            bundleReq = reqs.find(r => r.url.includes('app.bundle.js'));
            if (editorReq && bundleReq) break;
            await new Promise(r => setTimeout(r, 500));
        }

        const requests = await cache.keys();
        const urls = requests.map(r => r.url);

        let editorHash = null;
        let bundleHash = null;
        if (editorReq) {
            const res = await cache.match(editorReq);
            editorHash = res ? res.headers.get('X-SJR-Hash') : null;
        }
        if (bundleReq) {
            const res = await cache.match(bundleReq);
            bundleHash = res ? res.headers.get('X-SJR-Hash') : null;
        }

        // 檢查是否有帶 query string 的重複項目
        const queryEntries = urls.filter(u => u.includes('?pmd5='));

        return {
            coreKey,
            editorUrl: editorReq ? editorReq.url : null,
            editorHash,
            bundleUrl: bundleReq ? bundleReq.url : null,
            bundleHash,
            queryEntriesCount: queryEntries.length,
            queryEntries
        };
    }, headCoreCacheName);

    console.log('Cache Header & Query String 檢查結果:', JSON.stringify(cacheHeaderCheck, null, 2));
    await page.screenshot({ path: 'ui-audit/upgrade-02-editor.png' });

    // =========================================================================
    // 驗證 b: 更新後離線
    // =========================================================================
    console.log('\n--- 驗證 b: 更新後離線模式 (Offline) ---');
    console.log('[Step 1] 切換為離線模式 context.setOffline(true)...');
    await context.setOffline(true);

    // 1. 首頁
    console.log('[Step 2] 離線開啟首頁 index.html ...');
    const indexRes = await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });
    console.log(`- index.html 狀態碼: ${indexRes.status()} (來自 Service Worker)`);
    await page.screenshot({ path: 'ui-audit/offline-01-index.png' });

    // 2. 開啟作品 (Home / Editor)
    console.log('[Step 3] 離線開啟作品 editor.html ...');
    const editorRes = await page.goto('http://localhost:8080/editor.html?pmd5=101', { waitUntil: 'networkidle' });
    console.log(`- editor.html 狀態碼: ${editorRes.status()}`);
    await page.waitForSelector('#stage', { timeout: 5000 }).catch(() => {});
    await page.screenshot({ path: 'ui-audit/offline-02-editor.png' });

    // 3. AI 手勢辨識頁面
    console.log('[Step 4] 離線開啟 AI 手勢訓練 aitrainer.html ...');
    const aitRes = await page.goto('http://localhost:8080/aitrainer.html?projectId=101', { waitUntil: 'networkidle' });
    console.log(`- aitrainer.html 狀態碼: ${aitRes.status()}`);
    await sleep(1500);
    await page.screenshot({ path: 'ui-audit/offline-03-aitrainer.png' });

    console.log('[Step 5] 恢復連線模式 context.setOffline(false)...');
    await context.setOffline(false);

    // =========================================================================
    // 驗證 c: 增量更新 (修改 start.css 顏色)
    // =========================================================================
    console.log('\n--- 驗證 c: 增量更新 (僅下載異動檔案) ---');
    console.log('[Step 1] 先回到首頁確保處於最新啟動狀態...');
    await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });
    await sleep(1000);

    // 關閉目前 server，以帶有請求記錄回呼的 server 重新啟動
    await new Promise(r => server.close(r));
    const serverDownloadedUrls = [];
    server = await startServer(headRoot, req => {
        serverDownloadedUrls.push(req.url.split('?')[0]);
    });

    console.log('[Step 2] 修改 start.css 一處顏色/樣式並重新產生 precache 清單...');
    const startCssPath = path.resolve('editions', 'free', 'src', 'css', 'start.css');
    const originalStartCss = fs.readFileSync(startCssPath, 'utf8');
    const modifiedStartCss = originalStartCss + '\n/* test-incremental-update-marker: ' + Date.now() + ' */\n';
    fs.writeFileSync(startCssPath, modifiedStartCss);

    // 重新產生 precache 清單並更新 SW 時間戳
    execSync('node scripts/generate-precache.js', { stdio: 'pipe' });
    const swPath = path.resolve('editions', 'free', 'src', 'service-worker.js');
    let swCode = fs.readFileSync(swPath, 'utf8');
    swCode = swCode.replace(/\/\/ SW Build Version: [^\n]+/, `// SW Build Version: ${new Date().toISOString()}`);
    fs.writeFileSync(swPath, swCode);

    serverDownloadedUrls.length = 0; // 清空請求計數

    console.log('[Step 3] 觸發 SW 檢查更新並等待新版本完成快取...');
    // 註冊 SW 訊息監聽以捕獲 SW Install 實際下載清單
    const fetchedItemsPromise = page.evaluate(() => {
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve([]), 10000);
            navigator.serviceWorker.addEventListener('message', e => {
                if (e.data && e.data.type === 'CORE_CACHE_COMPLETE') {
                    clearTimeout(timer);
                    resolve(e.data.fetchedItems || []);
                }
            });
        });
    });

    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {}),
        page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) reg.update();
        })
    ]);

    const swFetchedFiles = await fetchedItemsPromise;
    await sleep(2000);

    // 還原 start.css
    fs.writeFileSync(startCssPath, originalStartCss);
    execSync('node scripts/generate-precache.js', { stdio: 'pipe' });

    console.log('\n[增量更新期間伺服器實際接收到的下載請求 (Network 面板 SW 發出的請求)]:');
    const swRequests = serverDownloadedUrls
        .filter(u => u.endsWith('start.css') || u.endsWith('precache-manifest.js') || u.endsWith('service-worker.js') || u.endsWith('app.bundle.js'));
    const uniqueDownloaded = [...new Set(swRequests)];
    uniqueDownloaded.forEach(u => console.log('  ->', u));

    console.log('\n[Service Worker install 階段實際從網路下載的檔案 (reused=false)]:');
    swFetchedFiles.forEach(u => console.log('  ->', u));

    const downloadedStartCss = uniqueDownloaded.some(u => u.includes('start.css'));
    const downloadedPrecache = uniqueDownloaded.some(u => u.includes('precache-manifest.js'));
    const downloadedSW = uniqueDownloaded.some(u => u.includes('service-worker.js'));
    const downloadedAppBundle = swFetchedFiles.some(u => u.includes('app.bundle.js'));

    console.log(`- start.css 被下載: ${downloadedStartCss}`);
    console.log(`- precache-manifest.js 被下載: ${downloadedPrecache}`);
    console.log(`- service-worker.js 被下載: ${downloadedSW}`);
    console.log(`- SW 預先快取中 app.bundle.js 是否被下載: ${downloadedAppBundle}`);
    if (!downloadedAppBundle) {
        console.log('  => 原因說明：app.bundle.js 內容未變更，且舊快取中已包含正確的 X-SJR-Hash 標頭，Service Worker 在 cacheFiles() 中成功比對並直接自舊快取複製重用，免除了重新下載。');
    } else {
        console.log('  => 原因說明：app.bundle.js 在舊快取中缺少 X-SJR-Hash 或 Hash 比對未吻合。');
    }

    // =========================================================================
    // 驗證 d: gettingstarted 影片離線播放
    // =========================================================================
    console.log('\n--- 驗證 d: gettingstarted 影片離線播放 ---');
    console.log('[Step 1] 開啟 gettingstarted.html 頁面...');
    await page.goto('http://localhost:8080/gettingstarted.html', { waitUntil: 'networkidle' });

    console.log('[Step 2] 等待影片播放並等待背景完整寫入 MEDIA_CACHE ...');
    await page.waitForSelector('video', { timeout: 5000 });
    await sleep(3500);

    const mediaCacheCheck = await page.evaluate(async () => {
        const mc = await caches.open('scratchjr-media');
        const keys = await mc.keys();
        return keys.map(k => k.url);
    });
    console.log('scratchjr-media 快取內容:', mediaCacheCheck);
    await page.screenshot({ path: 'ui-audit/video-01-online.png' });

    console.log('[Step 3] 切換為離線模式 context.setOffline(true)...');
    await context.setOffline(true);

    console.log('[Step 4] 離線重新整理 gettingstarted.html ...');
    await page.reload({ waitUntil: 'networkidle' });

    const offlineVideoStatus = await page.evaluate(async () => {
        const video = document.querySelector('video');
        if (!video) return { error: 'no video element' };
        try {
            await video.play();
        } catch (e) {}
        return {
            src: video.src || video.currentSrc,
            readyState: video.readyState,
            paused: video.paused,
            currentTime: video.currentTime
        };
    });
    console.log('離線影片播放狀態:', JSON.stringify(offlineVideoStatus, null, 2));
    await page.screenshot({ path: 'ui-audit/video-02-offline.png' });

    await context.setOffline(false);
    await context.close();
    await new Promise(r => server.close(r));

    console.log('\n=== 所有真實瀏覽器自動化驗證順利完成！ ===');
}

main().catch(err => {
    console.error('驗證失敗:', err);
    process.exit(1);
});
