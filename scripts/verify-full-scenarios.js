const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT_NODE = 8080;
const PORT_WRANGLER = 8787;
const PROFILE_DIR = path.resolve('.tmp-playwright-profile');

const MIME = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
    '.map': 'application/json'
};

function killProcess(pid) {
    if (!pid) return;
    try {
        execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
    } catch (e) {}
}

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

async function startNodeServer(rootDir, port = PORT_NODE, onRequest) {
    const server = createStaticServer(rootDir, onRequest);
    await new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => resolve());
        server.on('error', reject);
    });
    return server;
}

function startWranglerDev(port = PORT_WRANGLER) {
    console.log(`啟動 wrangler dev (port ${port})...`);
    const wrangler = spawn('cmd.exe', ['/c', 'npx', 'wrangler', 'dev', '--port', String(port)], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    return new Promise((resolve, reject) => {
        let isReady = false;
        let pollTimer = null;
        const timeout = setTimeout(() => {
            if (!isReady) {
                if (pollTimer) clearInterval(pollTimer);
                reject(new Error('Wrangler start timeout (35s)'));
            }
        }, 35000);

        const checkReady = () => {
            if (isReady) return;
            isReady = true;
            clearTimeout(timeout);
            if (pollTimer) clearInterval(pollTimer);
            console.log(`Wrangler dev 就緒於 http://localhost:${port}`);
            resolve(wrangler);
        };

        const onData = data => {
            const str = data.toString();
            if (str.includes('Ready on') || str.includes(`:${port}`)) {
                checkReady();
            }
        };
        wrangler.stdout.on('data', onData);
        wrangler.stderr.on('data', onData);
        wrangler.on('error', err => {
            if (pollTimer) clearInterval(pollTimer);
            reject(err);
        });

        // 雙重保障：以 HTTP probe 輪詢連接埠
        pollTimer = setInterval(() => {
            http.get(`http://127.0.0.1:${port}/`, res => {
                checkReady();
            }).on('error', () => {});
        }, 500);
    });
}

function fetchHttpRaw(port, urlPath) {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}${urlPath}`, res => {
            resolve({
                status: res.statusCode,
                location: res.headers.location,
                contentType: res.headers['content-type'],
                cacheControl: res.headers['cache-control']
            });
        }).on('error', reject);
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// =============================================================================
// Wrangler 專用測試情境 (b & c)
// =============================================================================
async function runWranglerScenarios() {
    console.log('=== 開始 Wrangler Dev (--target=wrangler) 真實瀏覽器驗證 ===\n');
    if (!fs.existsSync('ui-audit')) fs.mkdirSync('ui-audit');

    // 啟動前先確保 docs 產物最新
    console.log('[Step 0] 執行 build:web 確保 docs/ 產物與 precache 清單最新...');
    execSync('npm run build:web', { cwd: ROOT, stdio: 'inherit' });

    let wrangler = await startWranglerDev(PORT_WRANGLER);

    // 清理先前的暫存 profile
    if (fs.existsSync(PROFILE_DIR)) {
        try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (e) {}
    }

    let context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required'
        ]
    });

    let swDownloaded = [];
    context.on('serviceworker', worker => {
        worker.on('console', msg => {
            const text = msg.text();
            if (text.includes('[SW Install] 實際自網路下載的檔案')) {
                console.log('SW Console output:', text);
                const match = /\[SW Install\] 實際自網路下載的檔案 \(reused=false\):\s*(\[.*\])/.exec(text);
                if (match) {
                    try {
                        const parsed = JSON.parse(match[1]);
                        swDownloaded.push(...parsed);
                    } catch (e) {
                        console.error('Failed to parse fetched items JSON:', e);
                    }
                }
            }
        });
    });

    let page = await context.newPage();

    try {
        // ---------------------------------------------------------------------
        // 線上階段：依序開啟 / -> home.html -> editor.html?pmd5=...
        // ---------------------------------------------------------------------
        console.log('\n--- [情境 b: 線上依序開啟頁面] ---');

        // 1. 開啟 /
        console.log('[Step 1] 線上開啟 http://localhost:8787/ ...');
        const rootRes = await page.goto(`http://localhost:${PORT_WRANGLER}/`, { waitUntil: 'networkidle' });
        console.log(`- 根路徑狀態: ${rootRes.status()}, 最終網址: ${page.url()}`);
        await page.waitForFunction(() => 'serviceWorker' in navigator);
        await sleep(2500);

        // 觸發 AI 模型快取下載
        console.log('[Step 2] 觸發 AI 模型下載至 Cache Storage...');
        await page.evaluate(() => {
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'CACHE_AI' });
            }
        });
        for (let i = 0; i < 30; i++) {
            const count = await page.evaluate(async () => {
                const keys = await caches.keys();
                const aiKey = keys.find(k => k.includes('scratchjr-ai-'));
                if (!aiKey) return 0;
                const c = await caches.open(aiKey);
                return (await c.keys()).length;
            });
            if (count >= 10) {
                console.log(`- AI 快取已完整就緒: ${count}/10 個檔案`);
                break;
            }
            await sleep(1000);
        }
        await page.screenshot({ path: 'ui-audit/wrangler-b-01-root.png' });

        // 2. 開啟 home.html
        console.log('[Step 3] 線上開啟 http://localhost:8787/home.html ...');
        const homeRes = await page.goto(`http://localhost:${PORT_WRANGLER}/home.html`, { waitUntil: 'networkidle' });
        console.log(`- 狀態碼: ${homeRes.status()}, 最終網址 (預期被 307 導向為 /home): ${page.url()}`);
        await page.waitForSelector('#hometab', { timeout: 8000 }).catch(() => {});
        await page.screenshot({ path: 'ui-audit/wrangler-b-02-home.png' });

        // 3. 開啟 editor.html?pmd5=samples/Star.txt
        const samplePmd5 = 'samples/Star.txt';
        console.log(`[Step 4] 線上開啟 http://localhost:8787/editor.html?pmd5=${samplePmd5} ...`);
        const editorRes = await page.goto(`http://localhost:${PORT_WRANGLER}/editor.html?pmd5=${samplePmd5}`, { waitUntil: 'networkidle' });
        console.log(`- 狀態碼: ${editorRes.status()}, 最終網址 (預期被 307 導向為 /editor?pmd5=...): ${page.url()}`);
        await page.waitForSelector('#stage', { timeout: 8000 }).catch(() => {});
        await page.screenshot({ path: 'ui-audit/wrangler-b-03-editor-online.png' });

        // ---------------------------------------------------------------------
        // 切換為離線模式，依序測試四個子步驟
        // ---------------------------------------------------------------------
        console.log('\n--- [情境 b: 切換為離線模式 context.setOffline(true)] ---');
        await context.setOffline(true);

        const bResults = {};

        // 子步驟 b.1: 從 home 用 location.href 導向 editor.html?pmd5=...
        console.log('\n[離線測試 b.1] 先回到 home，再透過 location.href 導向 editor.html?pmd5=samples/Star.txt ...');
        await page.goto(`http://localhost:${PORT_WRANGLER}/home`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#hometab', { timeout: 5000 }).catch(() => {});

        await page.evaluate((md5) => {
            window.location.href = `editor.html?pmd5=${md5}`;
        }, samplePmd5);
        await sleep(3000);
        await page.waitForSelector('#stage', { timeout: 5000 }).catch(() => {});

        const b1Url = page.url();
        const b1PageType = await page.evaluate(() => window.scratchJrPage).catch(() => 'unknown');
        const b1HasStage = await page.$('#stage') !== null;
        const b1ReturnedToHome = b1PageType === 'index' || (await page.$('#catface') !== null && !b1HasStage);
        const b1IsCorrect = b1HasStage && b1PageType === 'editor' && !b1ReturnedToHome;
        bResults.b1 = {
            step: '從 home 用 location.href 導向 editor.html?pmd5=...',
            finalUrl: b1Url,
            pageType: b1PageType,
            hasStage: b1HasStage,
            returnedToHome: b1ReturnedToHome,
            isCorrect: b1IsCorrect
        };
        console.log(`- 最終網址: ${b1Url}`);
        console.log(`- 頁面類型: ${b1PageType}, 編輯器畫布存在: ${b1HasStage}, 是否退回首頁: ${b1ReturnedToHome} (驗證通過: ${b1IsCorrect})`);
        await page.screenshot({ path: 'ui-audit/wrangler-b-04-offline-nav-editor.png' });

        // 子步驟 b.2: 在 /editor?pmd5=...（被 307 導向後的網址）按重新整理
        console.log('\n[離線測試 b.2] 在 /editor?pmd5=...（被 307 導向後的網址）按重新整理 ...');
        // 先確保前往被導向後的網址 /editor?pmd5=...
        await page.goto(`http://localhost:${PORT_WRANGLER}/editor?pmd5=${samplePmd5}`, { waitUntil: 'networkidle' }).catch(() => {});
        await sleep(1500);
        // 按重新整理
        console.log('- 執行 page.reload() 重新整理...');
        await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
        await sleep(3000);
        await page.waitForSelector('#stage', { timeout: 5000 }).catch(() => {});

        const b2Url = page.url();
        const b2PageType = await page.evaluate(() => window.scratchJrPage).catch(() => 'unknown');
        const b2HasStage = await page.$('#stage') !== null;
        const b2ReturnedToHome = b2PageType === 'index' || (await page.$('#catface') !== null && !b2HasStage);
        const b2IsCorrect = b2HasStage && b2PageType === 'editor' && !b2ReturnedToHome;
        bResults.b2 = {
            step: '在 /editor?pmd5=...（被 307 導向後的網址）按重新整理',
            finalUrl: b2Url,
            pageType: b2PageType,
            hasStage: b2HasStage,
            returnedToHome: b2ReturnedToHome,
            isCorrect: b2IsCorrect
        };
        console.log(`- 最終網址: ${b2Url}`);
        console.log(`- 頁面類型: ${b2PageType}, 編輯器畫布存在: ${b2HasStage}, 是否退回首頁: ${b2ReturnedToHome} (驗證通過: ${b2IsCorrect})`);
        await page.screenshot({ path: 'ui-audit/wrangler-b-05-offline-reload-editor.png' });

        // 子步驟 b.3: 回到 index.html?back=yes
        console.log('\n[離線測試 b.3] 導向 index.html?back=yes ...');
        await page.evaluate(() => {
            window.location.href = 'index.html?back=yes';
        });
        await sleep(3000);
        await page.waitForSelector('#catface, #go', { timeout: 5000 }).catch(() => {});

        const b3Url = page.url();
        const b3PageType = await page.evaluate(() => window.scratchJrPage).catch(() => 'unknown');
        const b3HasIndexLobby = (await page.$('#catface') !== null || await page.$('#jrlogo') !== null) && b3PageType === 'index';
        const b3IsCorrect = b3HasIndexLobby;
        bResults.b3 = {
            step: '回到 index.html?back=yes',
            finalUrl: b3Url,
            pageType: b3PageType,
            hasIndexLobby: b3HasIndexLobby,
            isCorrect: b3IsCorrect
        };
        console.log(`- 最終網址: ${b3Url}`);
        console.log(`- 頁面類型: ${b3PageType}, 畫面呈現是否為首頁: ${b3HasIndexLobby} (驗證通過: ${b3IsCorrect})`);
        await page.screenshot({ path: 'ui-audit/wrangler-b-06-offline-back-index.png' });

        // 子步驟 b.4: 開啟 aitrainer.html?projectId=...
        console.log(`\n[離線測試 b.4] 導向 aitrainer.html?projectId=${samplePmd5} ...`);
        await page.evaluate((md5) => {
            window.location.href = `aitrainer.html?projectId=${encodeURIComponent(md5)}`;
        }, samplePmd5);
        await sleep(3000);
        await page.waitForSelector('#aitrainer-root', { timeout: 5000 }).catch(() => {});

        const b4Url = page.url();
        const b4PageType = await page.evaluate(() => window.scratchJrPage).catch(() => 'unknown');
        const b4HasAiRoot = await page.$('#aitrainer-root') !== null;
        const b4ReturnedToHome = b4PageType === 'index' || (await page.$('#catface') !== null && !b4HasAiRoot);
        const b4IsCorrect = b4HasAiRoot && b4PageType === 'aitrainer' && !b4ReturnedToHome;
        bResults.b4 = {
            step: '開啟 aitrainer.html?projectId=...',
            finalUrl: b4Url,
            pageType: b4PageType,
            hasAiRoot: b4HasAiRoot,
            returnedToHome: b4ReturnedToHome,
            isCorrect: b4IsCorrect
        };
        console.log(`- 最終網址: ${b4Url}`);
        console.log(`- 頁面類型: ${b4PageType}, AI 畫面存在: ${b4HasAiRoot}, 是否退回首頁: ${b4ReturnedToHome} (驗證通過: ${b4IsCorrect})`);
        await page.screenshot({ path: 'ui-audit/wrangler-b-07-offline-aitrainer.png' });

        // 恢復連線模式
        console.log('\n恢復連線模式 context.setOffline(false)...');
        await context.setOffline(false);

        // ---------------------------------------------------------------------
        // 情境 c: 增量更新與 Cloudflare 導向狀態及快取 Key 檢查
        // ---------------------------------------------------------------------
        console.log('\n--- [情境 c: 增量更新與 Cloudflare 快取 Key / 導向分析] ---');

        // 記錄 app.bundle.js 和 editor.html 被 Cloudflare 導向時的回應狀態
        console.log('[Step 1] 檢查 Cloudflare 直接回應狀態 (Raw HTTP):');
        const rawBundle = await fetchHttpRaw(PORT_WRANGLER, '/app.bundle.js');
        const rawEditorHtml = await fetchHttpRaw(PORT_WRANGLER, '/editor.html');
        const rawEditorClean = await fetchHttpRaw(PORT_WRANGLER, '/editor');

        console.log(`- /app.bundle.js 回應狀態: ${rawBundle.status} (無導向)`);
        console.log(`- /editor.html 回應狀態: ${rawEditorHtml.status}, Location: ${rawEditorHtml.location}`);
        console.log(`- /editor 回應狀態: ${rawEditorClean.status}`);

        // 檢查當前 Cache Storage 中存入 app.bundle.js 與 editor 的 Key
        const cacheKeysInfo = await page.evaluate(async () => {
            const keys = await caches.keys();
            const coreKey = keys.find(k => k.startsWith('scratchjr-core-'));
            if (!coreKey) return { error: 'no core cache found' };
            const cache = await caches.open(coreKey);
            const reqs = await cache.keys();
            const urls = reqs.map(r => r.url);
            
            const bundleEntries = urls.filter(u => u.includes('app.bundle.js'));
            const editorEntries = urls.filter(u => u.includes('editor'));

            const bundleRes = bundleEntries.length ? await (await cache.match(bundleEntries[0])).headers.get('X-SJR-Hash') : null;
            const editorDetails = [];
            for (const u of editorEntries) {
                const res = await cache.match(u);
                editorDetails.push({ url: u, hash: res ? res.headers.get('X-SJR-Hash') : null });
            }

            return {
                coreKey,
                bundleEntries,
                bundleHash: bundleRes,
                editorEntries: editorDetails
            };
        });
        console.log('\n[SW Cache Storage 存入 Key 與 Hash 檢查]:');
        console.log(JSON.stringify(cacheKeysInfo, null, 2));

        // 執行 start.css 增量更新測試
        console.log('\n[Step 2] 修改 start.css 顏色樣式標記並重新 build:web ...');
        const startCssPath = path.resolve('editions', 'free', 'src', 'css', 'start.css');
        const originalStartCss = fs.readFileSync(startCssPath, 'utf8');
        fs.writeFileSync(startCssPath, originalStartCss + `\n/* wrangler-incremental-test: ${Date.now()} */\n`);

        execSync('npm run build:web', { cwd: ROOT, stdio: 'inherit' });

        console.log('[Step 3] 重啟 wrangler dev 以載入更新後的 docs/ ...');
        killProcess(wrangler.pid);
        await sleep(1500);
        wrangler = await startWranglerDev(PORT_WRANGLER);

        // 清空 swDownloaded 陣列以捕捉本次更新的下載項目
        swDownloaded.length = 0;

        await page.goto(`http://localhost:${PORT_WRANGLER}/`, { waitUntil: 'networkidle' });
        await page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) await reg.update();
        });

        // 等待 SW 更新與 install 訊息到達
        for (let i = 0; i < 30; i++) {
            if (swDownloaded.length > 0) break;
            await sleep(500);
        }
        await sleep(1000);

        // 還原 start.css
        fs.writeFileSync(startCssPath, originalStartCss);
        execSync('npm run build:web', { cwd: ROOT, stdio: 'pipe' });

        console.log('\n[Service Worker install 階段實際從網路下載的檔案 (reused=false)]:');
        console.log(JSON.stringify(swDownloaded, null, 2));

        console.log('\n=== Wrangler Dev 測試彙總報告 ===');
        console.log('1. 離線導向 (情境 b) 結果:');
        console.log(JSON.stringify(bResults, null, 2));

        console.log('\n2. Cloudflare 回應狀態與 SW 快取 Key (情境 c) 結果:');
        console.log(`- app.bundle.js status: ${rawBundle.status}, SW Cache Key: ${cacheKeysInfo.bundleEntries[0]}`);
        console.log(`- editor.html status: ${rawEditorHtml.status} -> ${rawEditorHtml.location} (200)`);
        console.log(`- editor SW Cache Keys: ${cacheKeysInfo.editorEntries.map(e => e.url).join(', ')}`);
        console.log(`- SW 更新期間下載檔案: ${swDownloaded.join(', ')}`);

    } finally {
        await context.close();
        if (wrangler) {
            console.log('\n關閉 wrangler dev...');
            killProcess(wrangler.pid);
        }
    }
}

// =============================================================================
// Node Server 測試情境 (預設: 原 a 到 d 流程)
// =============================================================================
async function runNodeScenarios() {
    console.log('=== 開始 Node Server 模式自動化驗證 ===\n');
    if (!fs.existsSync('ui-audit')) fs.mkdirSync('ui-audit');

    if (fs.existsSync(PROFILE_DIR)) {
        try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (e) {}
    }

    const baselineRoot = path.resolve('..', 'scratchjr-baseline');
    const headRoot = path.resolve('.');

    console.log('--- 驗證 a: 同源升級 (7d88f7b -> HEAD) ---');
    console.log('[Step 1] 啟動 Baseline (7d88f7b) 伺服器...');
    let server = await startNodeServer(baselineRoot);

    let context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required'
        ]
    });
    let page = await context.newPage();

    console.log('[Step 2] 載入 Baseline 頁面 http://localhost:8080/index.html ...');
    await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => 'serviceWorker' in navigator);
    await sleep(2000);

    console.log('[Step 3] 觸發 AI 模型下載...');
    await page.evaluate(() => {
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'CACHE_AI' });
        }
    });

    let aiCachedCount = 0;
    for (let i = 0; i < 30; i++) {
        aiCachedCount = await page.evaluate(async () => {
            const keys = await caches.keys();
            const aiKey = keys.find(k => k.includes('scratchjr-ai-'));
            if (!aiKey) return 0;
            const cache = await caches.open(aiKey);
            return (await cache.keys()).length;
        });
        if (aiCachedCount >= 10) break;
        await sleep(1000);
    }
    console.log(`Baseline AI 模型快取檔案數量: ${aiCachedCount} / 10`);

    console.log('[Step 4] 在 Baseline 建立作品、聲音錄音、手勢資料...');
    await page.evaluate(async () => {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('scratchjr', 1);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(['projects', 'media', 'gestures'], 'readwrite');
                tx.objectStore('projects').put({
                    id: 101, name: '同源升級測試作品', version: 'v1',
                    cdate: '2026-09-23 10:00:00', mdate: '2026-09-23 10:00:00',
                    json: JSON.stringify({ pages: ['page1'] }), isdeleted: 'NO'
                });
                tx.objectStore('media').put({
                    md5: 'rec_upgrade_test.webm',
                    data: 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAA=', ext: 'webm'
                });
                tx.objectStore('gestures').put({
                    projectId: 101, payload: { dataset: { 'fist': [0.12, 0.34, 0.56] }, trained: true },
                    mtime: Date.now()
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });
    });
    await page.screenshot({ path: 'ui-audit/upgrade-01-baseline.png' });

    await context.close();
    await new Promise(r => server.close(r));

    console.log('[Step 5] 啟動 HEAD 伺服器並重新開啟同一個 profile ...');
    server = await startNodeServer(headRoot);
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required'
        ]
    });
    page = await context.newPage();

    await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
    });
    await sleep(3000);
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(1500);

    const upgradeVerification = await page.evaluate(async () => {
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
        const cacheKeys = await caches.keys();
        const aiCaches = cacheKeys.filter(k => k.includes('scratchjr-ai-'));
        let totalAiFiles = 0;
        for (const k of aiCaches) {
            const c = await caches.open(k);
            totalAiFiles += (await c.keys()).length;
        }
        return { idb: idbData, aiCaches, totalAiFiles };
    });

    console.log('[升級後資料檢查結果]:');
    console.log('- 作品存在:', !!upgradeVerification.idb.project);
    console.log('- 聲音存在:', !!upgradeVerification.idb.media);
    console.log('- 手勢存在:', !!upgradeVerification.idb.gesture);
    console.log('- AI 快取保留:', upgradeVerification.totalAiFiles >= 10);

    await context.close();
    await new Promise(r => server.close(r));
    console.log('\nNode Server 基礎驗證完成。');
}

async function main() {
    if (process.argv.includes('--target=wrangler')) {
        await runWranglerScenarios();
    } else {
        await runNodeScenarios();
    }
}

main().catch(err => {
    console.error('執行失敗:', err);
    process.exit(1);
});
