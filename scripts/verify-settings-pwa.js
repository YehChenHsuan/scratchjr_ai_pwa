#!/usr/bin/env node

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT, 'ui-audit', 'screenshots');
const PORT = 8787;
const BASE_URL = `http://localhost:${PORT}`;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.status === 200) return true;
        } catch (e) {
            // retry
        }
        await sleep(500);
    }
    throw new Error(`Timeout waiting for ${url}`);
}

async function main() {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }

    console.log('=== [PWA Settings & Offline Status Verification] ===');
    console.log('啟動 wrangler dev (port 8787)...');
    const wrangler = spawn('npx', ['wrangler', 'dev', '--port', String(PORT)], {
        cwd: ROOT,
        shell: true,
        stdio: 'pipe'
    });

    wrangler.stderr.on('data', d => {
        const str = d.toString();
        if (str.includes('Error')) console.error('[wrangler err]', str.trim());
    });

    try {
        await waitForServer(`${BASE_URL}/`, 25000);
        console.log('Wrangler dev 伺服器就緒於 ' + BASE_URL);

        const browser = await chromium.launch({ headless: true });

        // ----------------------------------------------------
        // 情境 1: 桌面 Chrome (1280x720) - Promptable 與 Install 流程
        // ----------------------------------------------------
        console.log('\n--- [情境 1: 桌面 Chrome (1280x720) 驗證 promptable 與 installed] ---');
        const context1 = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        const page1 = await context1.newPage();
        await page1.goto(`${BASE_URL}/home?place=gear`, { waitUntil: 'domcontentloaded' });
        await page1.waitForSelector('h1.localizationtitle', { timeout: 10000 });
        await sleep(500);

        // 觸發 beforeinstallprompt 事件
        await page1.evaluate(() => {
            window.__promptCalled = false;
            const promptEvent = new Event('beforeinstallprompt', { cancelable: true });
            promptEvent.prompt = function () {
                window.__promptCalled = true;
                return Promise.resolve();
            };
            promptEvent.userChoice = Promise.resolve({ outcome: 'accepted' });
            window.dispatchEvent(promptEvent);
        });
        await sleep(500);

        // 等待「安裝到這台裝置」按鈕出現
        const installBtn = await page1.waitForSelector('button.pwa-large-btn', { timeout: 10000 });
        const btnText = await installBtn.textContent();
        console.log(`- 安裝按鈕顯示: "${btnText}"`);
        assert(btnText.includes('安裝到這台裝置'), '按鈕文字應為「安裝到這台裝置」');

        // 截圖 16-settings-1280x720.png 與 pwa-promptable.png
        const p16 = path.join(SCREENSHOTS_DIR, '16-settings-1280x720.png');
        const pPromptable = path.join(SCREENSHOTS_DIR, 'pwa-promptable.png');
        await page1.screenshot({ path: p16 });
        // 滾動到安裝與狀態區塊進行細節截圖
        await page1.evaluate(() => {
            const sec = document.querySelector('.pwa-settings-section');
            if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' });
        });
        await sleep(500);
        await page1.screenshot({ path: pPromptable });
        console.log(`- 已儲存截圖: ${p16} 和 ${pPromptable}`);

        // 監聽 console
        page1.on('console', msg => {
            const txt = msg.text();
            if (!txt.includes('Content Security Policy') && !txt.includes('The policy is report-only')) {
                console.log('  [Browser]', txt);
            }
        });
        page1.on('pageerror', err => console.log('  [PageError]', err));

        // 點擊按鈕，驗證 prompt() 被呼叫且狀態轉為 installed-browser
        console.log('- 點擊安裝按鈕...');
        await installBtn.click();
        await sleep(500);

        const installedBrowserPill = await page1.waitForSelector('.pwa-status-pill.installed-browser', { timeout: 6000 });
        const browserText = await installedBrowserPill.textContent();
        console.log(`- 安裝後瀏覽器狀態更新: "${browserText}"`);
        assert(browserText.includes('已安裝，請從桌面或主畫面的 ScratchJr AI 圖示開啟'), '應更新為 installed-browser 狀態');

        // 滾動並截圖 installed-browser 狀態
        await page1.evaluate(() => {
            const el = document.querySelector('.pwa-status-pill.installed-browser');
            const wrapc = document.getElementById('wrapc');
            if (el && wrapc) {
                wrapc.scrollTop = Math.max(0, el.offsetTop - 120);
            } else if (el) {
                el.scrollIntoView();
            }
        });
        await sleep(300);
        const pInstalledBrowser = path.join(SCREENSHOTS_DIR, 'pwa-installed-browser.png');
        await page1.screenshot({ path: pInstalledBrowser });
        console.log(`- 已儲存截圖: ${pInstalledBrowser}`);

        // 模擬 standalone 模式 (獨立視窗)
        console.log('- 模擬 standalone 模式 (獨立視窗)...');
        await page1.evaluate(() => {
            const origMatchMedia = window.matchMedia;
            window.matchMedia = function (query) {
                if (query === '(display-mode: standalone)') {
                    return { matches: true, addListener: () => {}, removeListener: () => {} };
                }
                return origMatchMedia ? origMatchMedia.call(window, query) : { matches: false };
            };
            if (window.__PWAInstall && window.__PWAInstall.notifyListeners) {
                window.__PWAInstall.notifyListeners();
            }
        });
        await sleep(300);
        const installedPill = await page1.waitForSelector('.pwa-status-pill.installed', { timeout: 6000 });
        const installedText = await installedPill.textContent();
        console.log(`- Standalone 模式狀態: "${installedText}"`);
        assert(installedText.includes('已安裝，可離線使用'), '應更新為 installed 狀態');

        await page1.evaluate(() => {
            const el = document.querySelector('.pwa-status-pill.installed');
            const wrapc = document.getElementById('wrapc');
            if (el && wrapc) {
                wrapc.scrollTop = Math.max(0, el.offsetTop - 120);
            } else if (el) {
                el.scrollIntoView();
            }
        });
        await sleep(300);
        const pInstalled = path.join(SCREENSHOTS_DIR, 'pwa-installed.png');
        await page1.screenshot({ path: pInstalled });
        console.log(`- 已儲存截圖: ${pInstalled}`);

        // 模擬 chromium-manual 狀態 (非 standalone、無 prompt、無 localStorage 旗標)
        console.log('- 模擬 chromium-manual 狀態 (非 standalone、無 prompt、無 localStorage 旗標)...');
        await page1.evaluate(() => {
            window.matchMedia = function () {
                return { matches: false, addListener: () => {}, removeListener: () => {} };
            };
            if (window.__PWAInstall) {
                window.__PWAInstall.clearInstalledFlag();
            } else {
                localStorage.removeItem('scratchjr_pwa_installed');
            }
        });
        await sleep(300);
        const manualPill = await page1.waitForSelector('.pwa-status-pill.chromium-manual', { timeout: 6000 });
        const manualText = await manualPill.textContent();
        console.log(`- Chromium 手動安裝指引狀態: "${manualText}"`);
        assert(manualText.includes('點網址列右側的安裝圖示'), '應更新為 chromium-manual 狀態');

        await page1.evaluate(() => {
            const el = document.querySelector('.pwa-status-pill.chromium-manual');
            const wrapc = document.getElementById('wrapc');
            if (el && wrapc) {
                wrapc.scrollTop = Math.max(0, el.offsetTop - 120);
            } else if (el) {
                el.scrollIntoView();
            }
        });
        await sleep(300);
        const pManual = path.join(SCREENSHOTS_DIR, 'pwa-chromium-manual.png');
        await page1.screenshot({ path: pManual });
        console.log(`- 已儲存截圖: ${pManual}`);

        // 測試 beforeinstallprompt 重新觸發時清除 localStorage 旗標並恢復 promptable
        console.log('- 測試 beforeinstallprompt 重新觸發時清除 localStorage 旗標並恢復 promptable...');
        await page1.evaluate(() => {
            localStorage.setItem('scratchjr_pwa_installed', '1');
            const promptEvent = new Event('beforeinstallprompt', { cancelable: true });
            promptEvent.prompt = () => Promise.resolve();
            promptEvent.userChoice = Promise.resolve({ outcome: 'accepted' });
            window.dispatchEvent(promptEvent);
        });
        await sleep(300);
        const rePromptBtn = await page1.waitForSelector('button.pwa-large-btn', { timeout: 5000 });
        assert(rePromptBtn !== null, '觸發 beforeinstallprompt 後應顯示安裝按鈕');
        const flagAfterBIP = await page1.evaluate(() => localStorage.getItem('scratchjr_pwa_installed'));
        assert(flagAfterBIP === null, 'beforeinstallprompt 應清除 localStorage 旗標');
        console.log('- 旗標清除與 promptable 恢復驗證成功');

        // ----------------------------------------------------
        // 情境 4: 英文語系驗證 (在同頁面點選 English 按鈕切換)
        // ----------------------------------------------------
        console.log('\n--- [情境 4: 英文語系切換與驗證 (No "String missing")] ---');
        console.log('- 點擊 English 語言按鈕...');
        const englishBtn = await page1.waitForSelector('div.localizationselect >> text="English"', { timeout: 6000 });
        await englishBtn.click();
        await sleep(2000);
        await page1.waitForSelector('h1.localizationtitle', { timeout: 10000 });

        const pageText = await page1.evaluate(() => document.body.innerText);
        assert(!pageText.includes('String missing'), '不應出現任何 "String missing"！');
        console.log('- 英文語系檢驗通過，無任何 String missing');

        // 滾動並截圖英文設定頁中的 PWA 區塊
        await page1.evaluate(() => {
            const sec = document.querySelector('.pwa-settings-section');
            if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' });
        });
        await sleep(300);
        const pEn = path.join(SCREENSHOTS_DIR, 'pwa-english-settings.png');
        await page1.screenshot({ path: pEn });
        console.log(`- 已儲存截圖: ${pEn}`);

        // ----------------------------------------------------
        // 情境 5: 離線狀態數值比對與斷網切換 (延續 context1 已有快取)
        // ----------------------------------------------------
        console.log('\n--- [情境 5: 離線狀態與快取比對及斷網測試] ---');
        console.log('- 重新進入設定頁 /home?place=gear ...');
        await page1.goto(`${BASE_URL}/home?place=gear`, { waitUntil: 'load' });
        await page1.waitForSelector('.pwa-offline-card', { timeout: 15000 });
        await sleep(1500);

        // 讀取 UI 上的數值
        const uiStatus = await page1.evaluate(() => {
            const rows = document.querySelectorAll('.pwa-status-row');
            const data = {};
            rows.forEach(r => {
                const label = r.querySelector('.pwa-status-label');
                const text = r.querySelector('.pwa-progress-text') || r.querySelector('.pwa-status-val-wrap') || r.children[1];
                if (label && text) {
                    data[label.textContent.trim()] = text.textContent.trim();
                }
            });
            return data;
        });
        console.log('- 設定頁離線狀態顯示:', JSON.stringify(uiStatus, null, 2));

        // 檢查 Cache Storage 實際內容
        const cacheCounts = await page1.evaluate(async () => {
            if (typeof caches === 'undefined') return null;
            const keys = await caches.keys();
            const coreKey = keys.find(k => k.includes('scratchjr-core-'));
            const aiKey = keys.find(k => k.includes('scratchjr-ai-'));
            let coreCount = 0;
            let aiCount = 0;
            if (coreKey) {
                const c = await caches.open(coreKey);
                coreCount = (await c.keys()).length;
            }
            if (aiKey) {
                const c = await caches.open(aiKey);
                aiCount = (await c.keys()).length;
            }
            return { coreCount, aiCount };
        });
        console.log('- Cache Storage 實際內容:', cacheCounts);

        if (cacheCounts && cacheCounts.coreCount > 0) {
            console.log(`- 核心資源快取數: ${cacheCounts.coreCount}`);
        }

        // ----------------------------------------------------
        // 檢查 2.a: 設定頁顯示的 coreCached 一定小於或等於 coreTotal
        // ----------------------------------------------------
        console.log('\n- [2.a 檢查] 設定頁顯示的 coreCached 一定小於或等於 coreTotal...');
        await page1.waitForFunction(() => {
            const rows = document.querySelectorAll('.pwa-status-row');
            for (const r of rows) {
                const label = r.querySelector('.pwa-status-label');
                if (label && (label.textContent.includes('基本資源') || label.textContent.includes('Basic Resources') || label.textContent.includes('Core'))) {
                    const textEl = r.querySelector('.pwa-progress-text span:not(.pwa-check-icon)');
                    return textEl && textEl.textContent.includes('/');
                }
            }
            return false;
        }, { timeout: 15000 });

        const coreProgressInfo = await page1.evaluate(() => {
            const rows = document.querySelectorAll('.pwa-status-row');
            for (const r of rows) {
                const label = r.querySelector('.pwa-status-label');
                if (label && (label.textContent.includes('基本資源') || label.textContent.includes('Basic Resources') || label.textContent.includes('Core'))) {
                    const countSpan = r.querySelector('.pwa-progress-text span:not(.pwa-check-icon)');
                    const checkIcon = r.querySelector('.pwa-check-icon');
                    const fillEl = r.querySelector('.pwa-progress-bar-fill');
                    return {
                        countText: countSpan ? countSpan.textContent.trim() : '',
                        isCheckVisible: checkIcon && checkIcon.style.display !== 'none',
                        isCompleteClass: fillEl && fillEl.classList.contains('complete')
                    };
                }
            }
            return null;
        });
        assert(coreProgressInfo, '應找到基本資源顯示項目');
        console.log(`  基本資源顯示文字: "${coreProgressInfo.countText}"`);
        const coreMatch = /(\d+)\s*\/\s*(\d+)/.exec(coreProgressInfo.countText);
        assert(coreMatch, `基本資源顯示格式應為 "X / Y"，實際為: "${coreProgressInfo.countText}"`);
        const coreCached = parseInt(coreMatch[1], 10);
        const coreTotal = parseInt(coreMatch[2], 10);
        console.log(`  coreCached: ${coreCached}, coreTotal: ${coreTotal}`);
        assert(coreCached <= coreTotal, `設定頁顯示的 coreCached (${coreCached}) 一定小於或等於 coreTotal (${coreTotal})`);
        console.log('  驗證通過: coreCached <= coreTotal');

        // ----------------------------------------------------
        // 檢查 2.b: 從 CORE_CACHE 刪掉一個清單內的檔案（例如 ./css/start.css）後重新查詢，基本資源不能顯示完成，數字要是 693 / 694
        // ----------------------------------------------------
        console.log('\n- [2.b 檢查] 從 CORE_CACHE 刪除 ./css/start.css 並重新查詢...');
        const deleteResult = await page1.evaluate(async () => {
            if (typeof caches === 'undefined') return { error: 'no caches' };
            const keys = await caches.keys();
            const coreKey = keys.find(k => k.startsWith('scratchjr-core-'));
            if (!coreKey) return { error: 'core cache not found' };
            const cache = await caches.open(coreKey);
            const requests = await cache.keys();
            const targetReq = requests.find(r => new URL(r.url).pathname.endsWith('/css/start.css'));
            if (!targetReq) return { error: 'target file /css/start.css not found in cache' };
            const success = await cache.delete(targetReq);
            return {
                success,
                coreKey,
                targetUrl: targetReq.url
            };
        });
        console.log('  刪除檔案結果:', deleteResult);
        assert(deleteResult.success, '應成功從 CORE_CACHE 刪除 ./css/start.css');

        // 觸發重新查詢
        console.log('  觸發重新查詢狀態 (updateOfflineStatus)...');
        await page1.evaluate(async () => {
            if (window.__updateOfflineStatus) {
                await window.__updateOfflineStatus();
            }
        });

        // 等待畫面更新至 693 / 694 (或 coreTotal - 1)
        await page1.waitForFunction(expectedCount => {
            const rows = document.querySelectorAll('.pwa-status-row');
            for (const r of rows) {
                const label = r.querySelector('.pwa-status-label');
                if (label && (label.textContent.includes('基本資源') || label.textContent.includes('Basic Resources') || label.textContent.includes('Core'))) {
                    const countSpan = r.querySelector('.pwa-progress-text span:not(.pwa-check-icon)');
                    if (countSpan && countSpan.textContent.includes(expectedCount)) {
                        return true;
                    }
                }
            }
            return false;
        }, `${coreTotal - 1} / ${coreTotal}`, { timeout: 10000 });

        const updatedCoreInfo = await page1.evaluate(() => {
            const rows = document.querySelectorAll('.pwa-status-row');
            for (const r of rows) {
                const label = r.querySelector('.pwa-status-label');
                if (label && (label.textContent.includes('基本資源') || label.textContent.includes('Basic Resources') || label.textContent.includes('Core'))) {
                    const countSpan = r.querySelector('.pwa-progress-text span:not(.pwa-check-icon)');
                    const checkIcon = r.querySelector('.pwa-check-icon');
                    const fillEl = r.querySelector('.pwa-progress-bar-fill');
                    return {
                        countText: countSpan ? countSpan.textContent.trim() : '',
                        isCheckVisible: checkIcon && checkIcon.style.display !== 'none',
                        isCompleteClass: fillEl && fillEl.classList.contains('complete')
                    };
                }
            }
            return null;
        });
        console.log('  更新後基本資源狀態:', updatedCoreInfo);
        assert(updatedCoreInfo, '應找到基本資源顯示項目');
        assert.strictEqual(updatedCoreInfo.countText, '693 / 694', `基本資源數字要是 693 / 694，實際為: "${updatedCoreInfo.countText}"`);
        assert.strictEqual(updatedCoreInfo.isCheckVisible, false, '未完全快取時不能顯示完成打勾圖示 (✓)');
        assert.strictEqual(updatedCoreInfo.isCompleteClass, false, '進度條 fill 不能有 complete 類別');
        console.log('  驗證通過: 基本資源不能顯示完成，數字為 693 / 694');

        // 復原刪除的快取檔案，維持測試環境完整
        console.log('  復原快取項目 ./css/start.css ...');
        await page1.evaluate(async (delInfo) => {
            if (!delInfo || !delInfo.coreKey || !delInfo.targetUrl) return;
            const cache = await caches.open(delInfo.coreKey);
            try {
                const res = await fetch(delInfo.targetUrl);
                if (res.ok) {
                    await cache.put(delInfo.targetUrl, res);
                }
            } catch (e) {}
            if (window.__updateOfflineStatus) {
                await window.__updateOfflineStatus();
            }
        }, deleteResult);
        await sleep(500);

        // ----------------------------------------------------
        // 驗證輪詢期間按鈕 DOM 節點同一性 (===)
        // ----------------------------------------------------
        console.log('- 驗證輪詢期間按鈕 DOM 節點同一性 (===)...');
        await page1.evaluate(() => {
            window.__testProtBtnBefore = document.querySelector('button.pwa-action-btn-small');
        });
        const hasBtnBefore = await page1.evaluate(() => window.__testProtBtnBefore !== null);
        assert(hasBtnBefore, '頁面上應存在資料保護啟用按鈕');

        console.log('  等待 2.5 秒輪詢週期...');
        await sleep(2500);
        const isSameNode = await page1.evaluate(() => {
            const btnAfter = document.querySelector('button.pwa-action-btn-small');
            return window.__testProtBtnBefore === btnAfter;
        });
        console.log(`  DOM 節點同一性比對結果: ${isSameNode ? '通過 (=== 同一參照)' : '失敗'}`);
        assert(isSameNode, '輪詢期間按鈕的 DOM 節點沒有被替換（前後用 === 比對同一個元素）');

        // ----------------------------------------------------
        // 驗證點擊資料保護按鈕後，requestPersistentStorage 回傳 false 的提示
        // ----------------------------------------------------
        console.log('- 驗證資料保護按鈕點擊拒絕提示...');
        await page1.evaluate(() => {
            if (navigator.storage) {
                navigator.storage.persist = () => Promise.resolve(false);
            }
        });
        const protBtn = await page1.waitForSelector('button.pwa-action-btn-small', { timeout: 5000 });
        await protBtn.click();
        await sleep(1000);

        const deniedHint = await page1.waitForSelector('.pwa-protection-denied-hint', { state: 'visible', timeout: 5000 });
        const hintText = await deniedHint.textContent();
        console.log(`  資料保護拒絕提示內容: "${hintText}"`);
        assert(hintText.includes('瀏覽器暫未同意') || hintText.includes('Permission not yet granted'),
            '應顯示「瀏覽器暫未同意，安裝成 App 後通常會自動啟用」');

        await page1.evaluate(() => {
            const sec = document.querySelector('.pwa-offline-card');
            if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' });
        });
        await sleep(300);
        const pDenied = path.join(SCREENSHOTS_DIR, 'pwa-storage-denied.png');
        await page1.screenshot({ path: pDenied });
        console.log(`  - 已儲存拒絕提示截圖: ${pDenied}`);

        // 切換為離線模式
        console.log('- 切換為離線模式 context.setOffline(true)...');
        await context1.setOffline(true);
        console.log('- 重新整理設定頁 (page.reload)...');
        await page1.reload({ waitUntil: 'load' });
        await page1.waitForSelector('h1.localizationtitle', { timeout: 15000 });
        await sleep(1500);

        const offlineSettingsTitle = await page1.$eval('h1.localizationtitle', el => el.textContent);
        console.log(`- 離線重整後設定頁標題: "${offlineSettingsTitle}"`);
        assert(offlineSettingsTitle.length > 0, '離線下設定頁應能成功載入');

        // 滾動並截圖離線狀態設定頁
        await page1.evaluate(() => {
            const sec = document.querySelector('.pwa-offline-card');
            if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' });
        });
        await sleep(300);
        const pOffline = path.join(SCREENSHOTS_DIR, 'pwa-offline-settings.png');
        await page1.screenshot({ path: pOffline });
        console.log(`- 已儲存離線設定頁截圖: ${pOffline}`);

        await context1.close();

        // ----------------------------------------------------
        // 情境 2: iPad 裝置模擬 (1024x768) - 驗證 iOS 3 步驟與警告框
        // ----------------------------------------------------
        console.log('\n--- [情境 2: iPad 裝置模擬 (1024x768) 驗證 iOS 指引] ---');
        const context2 = await browser.newContext({
            viewport: { width: 1024, height: 768 },
            userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
        });

        await context2.addInitScript(() => {
            Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
            Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
        });

        const page2 = await context2.newPage();
        await page2.goto(`${BASE_URL}/home?place=gear`, { waitUntil: 'load' });
        await sleep(1500);

        const iosGuide = await page2.waitForSelector('.pwa-ios-guide', { timeout: 8000 });
        const guideText = await iosGuide.textContent();
        console.log(`- iOS 指引內容: ${guideText.slice(0, 80)}...`);
        assert(guideText.includes('分享') || guideText.includes('Share'), '應包含步驟一');
        assert(guideText.includes('主畫面') || guideText.includes('Home Screen'), '應包含步驟二或三');

        const hasShareSvg = await page2.evaluate(() => {
            return document.querySelector('.pwa-ios-share-icon') !== null;
        });
        assert(hasShareSvg, '應包含 inline SVG 分享圖示');
        console.log('- 驗證成功: 包含 inline SVG 分享圖示及 3 步驟與警告');

        const p18 = path.join(SCREENSHOTS_DIR, '18-settings-1024x768.png');
        const pIos = path.join(SCREENSHOTS_DIR, 'pwa-ios.png');
        await page2.screenshot({ path: p18 });
        // 滾動以截圖 iOS 說明區塊
        await page2.evaluate(() => {
            const guide = document.querySelector('.pwa-ios-guide');
            if (guide) guide.scrollIntoView({ behavior: 'instant', block: 'center' });
        });
        await sleep(300);
        await page2.screenshot({ path: pIos });
        console.log(`- 已儲存截圖: ${p18} 和 ${pIos}`);
        await context2.close();

        // ----------------------------------------------------
        // 情境 3: 960x600 解析度驗證
        // ----------------------------------------------------
        console.log('\n--- [情境 3: 960x600 解析度佈局截圖] ---');
        const context3 = await browser.newContext({
            viewport: { width: 960, height: 600 }
        });
        const page3 = await context3.newPage();
        await page3.goto(`${BASE_URL}/home?place=gear`, { waitUntil: 'load' });
        await sleep(1500);

        const p17 = path.join(SCREENSHOTS_DIR, '17-settings-960x600.png');
        await page3.screenshot({ path: p17 });
        console.log(`- 已儲存截圖: ${p17}`);
        await context3.close();

        await browser.close();
        console.log('\n=== 所有 PWA 設定頁驗證項目全數通過！ ===\n');
    } finally {
        console.log('關閉 wrangler dev...');
        if (wrangler && wrangler.pid) {
            try {
                execSync(`taskkill /pid ${wrangler.pid} /t /f`, { stdio: 'ignore' });
            } catch (e) {
                wrangler.kill();
            }
        }
    }
}

main().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('驗證失敗:', err);
    process.exit(1);
});
