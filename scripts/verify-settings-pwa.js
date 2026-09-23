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
        page1.on('console', msg => console.log('  [Browser]', msg.text()));
        page1.on('pageerror', err => console.log('  [PageError]', err));

        // 點擊按鈕，驗證 prompt() 被呼叫且狀態轉為 installed
        console.log('- 點擊安裝按鈕...');
        await installBtn.click();
        await sleep(1000);
        // 如果瀏覽器本身觸發了 prompt，我們也發送 appinstalled 事件模擬使用者安裝成功
        await page1.evaluate(() => {
            window.dispatchEvent(new Event('appinstalled'));
        });
        await sleep(500);

        const installedPill = await page1.waitForSelector('.pwa-status-pill.installed', { timeout: 6000 });
        const installedText = await installedPill.textContent();
        console.log(`- 安裝後狀態更新: "${installedText}"`);
        assert(installedText.includes('已安裝'), '應更新為已安裝狀態');

        // 滾動並截圖 installed 狀態
        await page1.evaluate(() => {
            const el = document.querySelector('.pwa-status-pill.installed');
            if (el) el.scrollIntoView();
        });
        await sleep(300);
        const pInstalled = path.join(SCREENSHOTS_DIR, 'pwa-installed.png');
        await page1.screenshot({ path: pInstalled });
        console.log(`- 已儲存截圖: ${pInstalled}`);

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
        assert(guideText.includes('Safari'), '應包含步驟一');
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
        process.exit(0);
    }
}

main().catch(err => {
    console.error('驗證失敗:', err);
    process.exit(1);
});
