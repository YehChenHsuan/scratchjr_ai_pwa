#!/usr/bin/env node

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT, 'ui-audit', 'screenshots');
const PORT = 8787;
const BASE_URL = `http://localhost:${PORT}`;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 建立假媒體與 SVG 內容
const CUSTOM_CHAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#FF5722"/><rect x="35" y="35" width="30" height="30" fill="#FFF"/></svg>`;
const CUSTOM_BKG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><rect width="480" height="360" fill="#4CAF50"/><circle cx="240" cy="180" r="80" fill="#FFEB3B"/></svg>`;
const DUMMY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DUMMY_WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

async function seedTestEnvironment(page) {
    console.log('Seeding 3 projects with custom characters, backgrounds, recordings, photos...');
    await page.evaluate(async ({ customCharSvg, customBkgSvg, pngBase64, wavBase64 }) => {
        const DB_NAME = 'scratchjr';
        const DB_VERSION = 1;
        const openReq = indexedDB.open(DB_NAME, DB_VERSION);
        const db = await new Promise((resolve, reject) => {
            openReq.onsuccess = () => resolve(openReq.result);
            openReq.onerror = () => reject(openReq.error);
        });

        function put(storeName, val) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const req = tx.objectStore(storeName).put(val);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        function clear(storeName) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const req = tx.objectStore(storeName).clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }

        // 清空
        await clear('projects');
        await clear('usershapes');
        await clear('userbkgs');
        await clear('media');
        await clear('gestures');

        // 存入共用自訂角色與自訂背景
        // 專案 1 素材
        const char1_md5 = 'custom_cat_1.svg';
        const char1_png = 'custom_cat_1.png';
        const bkg1_md5 = 'custom_park_1.svg';
        const bkg1_png = 'custom_park_1.png';
        const sound1_md5 = 'recording_1.wav';
        const photo1_md5 = 'photo_1.png';
        const thumb1_md5 = 'thumb_proj1.png';

        // 專案 2 素材
        const char2_md5 = 'custom_dog_2.svg';
        const char2_png = 'custom_dog_2.png';
        const bkg2_md5 = 'custom_space_2.svg';
        const bkg2_png = 'custom_space_2.png';
        const sound2_md5 = 'recording_2.wav';
        const photo2_md5 = 'photo_2.png';
        const thumb2_md5 = 'thumb_proj2.png';

        // 專案 3 素材
        const char3_md5 = 'custom_robot_3.svg';
        const char3_png = 'custom_robot_3.png';
        const bkg3_md5 = 'custom_city_3.svg';
        const bkg3_png = 'custom_city_3.png';
        const sound3_md5 = 'recording_3.wav';
        const photo3_md5 = 'photo_3.png';
        const thumb3_md5 = 'thumb_proj3.png';

        // 寫入 media
        const allMedia = [
            { md5: char1_md5, data: btoa(customCharSvg), ext: 'svg' },
            { md5: char1_png, data: pngBase64, ext: 'png' },
            { md5: bkg1_md5, data: btoa(customBkgSvg), ext: 'svg' },
            { md5: bkg1_png, data: pngBase64, ext: 'png' },
            { md5: sound1_md5, data: wavBase64, ext: 'wav' },
            { md5: photo1_md5, data: pngBase64, ext: 'png' },
            { md5: thumb1_md5, data: pngBase64, ext: 'png' },

            { md5: char2_md5, data: btoa(customCharSvg), ext: 'svg' },
            { md5: char2_png, data: pngBase64, ext: 'png' },
            { md5: bkg2_md5, data: btoa(customBkgSvg), ext: 'svg' },
            { md5: bkg2_png, data: pngBase64, ext: 'png' },
            { md5: sound2_md5, data: wavBase64, ext: 'wav' },
            { md5: photo2_md5, data: pngBase64, ext: 'png' },
            { md5: thumb2_md5, data: pngBase64, ext: 'png' },

            { md5: char3_md5, data: btoa(customCharSvg), ext: 'svg' },
            { md5: char3_png, data: pngBase64, ext: 'png' },
            { md5: bkg3_md5, data: btoa(customBkgSvg), ext: 'svg' },
            { md5: bkg3_png, data: pngBase64, ext: 'png' },
            { md5: sound3_md5, data: wavBase64, ext: 'wav' },
            { md5: photo3_md5, data: pngBase64, ext: 'png' },
            { md5: thumb3_md5, data: pngBase64, ext: 'png' }
        ];
        for (const m of allMedia) await put('media', m);

        // 寫入 usershapes 與 userbkgs
        await put('usershapes', { md5: char1_md5, altmd5: char1_png, name: 'CustomCat1', scale: '0.5', width: '100', height: '100', ext: 'svg', version: 'v3' });
        await put('usershapes', { md5: char2_md5, altmd5: char2_png, name: 'CustomDog2', scale: '0.5', width: '100', height: '100', ext: 'svg', version: 'v3' });
        await put('usershapes', { md5: char3_md5, altmd5: char3_png, name: 'CustomRobot3', scale: '0.5', width: '100', height: '100', ext: 'svg', version: 'v3' });

        await put('userbkgs', { md5: bkg1_md5, altmd5: bkg1_png, width: '480', height: '360', ext: 'svg', version: 'v3' });
        await put('userbkgs', { md5: bkg2_md5, altmd5: bkg2_png, width: '480', height: '360', ext: 'svg', version: 'v3' });
        await put('userbkgs', { md5: bkg3_md5, altmd5: bkg3_png, width: '480', height: '360', ext: 'svg', version: 'v3' });

        // 建立 3 個專案資料 (Project 1, Project 2, Project 3)
        function makeProject(id, name, charMd5, bkgMd5, soundMd5, photoMd5, thumbMd5) {
            const pageId = 'page1';
            const sprite1Id = 'sprite1';
            const sprite2PhotoId = 'spritePhoto';

            const projectJson = {
                pages: [pageId],
                currentPage: pageId,
                [pageId]: {
                    text: [],
                    textstartat: 36,
                    sprites: [sprite1Id, sprite2PhotoId],
                    layers: [sprite1Id, sprite2PhotoId],
                    md5: bkgMd5,
                    num: 1,
                    lastSprite: sprite1Id,
                    [sprite1Id]: {
                        shown: true,
                        type: 'sprite',
                        name: 'Char1',
                        md5: charMd5,
                        id: sprite1Id,
                        flip: false,
                        angle: 0,
                        scale: 0.5,
                        speed: 2,
                        defaultScale: 0.5,
                        sounds: [soundMd5],
                        xcoor: 150,
                        ycoor: 150,
                        cx: 40,
                        cy: 40,
                        w: 80,
                        h: 80,
                        scripts: []
                    },
                    [sprite2PhotoId]: {
                        shown: true,
                        type: 'sprite',
                        name: 'PhotoChar',
                        md5: photoMd5,
                        id: sprite2PhotoId,
                        flip: false,
                        angle: 0,
                        scale: 0.5,
                        speed: 2,
                        defaultScale: 0.5,
                        sounds: [],
                        xcoor: 300,
                        ycoor: 150,
                        cx: 40,
                        cy: 40,
                        w: 80,
                        h: 80,
                        scripts: []
                    }
                }
            };

            return {
                id,
                name,
                version: 'v3',
                deleted: 'NO',
                isgift: '0',
                mtime: Date.now().toString(),
                ctime: Date.now().toString(),
                thumbnail: JSON.stringify({ pagecount: 1, md5: thumbMd5 }),
                json: JSON.stringify(projectJson)
            };
        }

        await put('projects', makeProject(1, 'Project Alpha', char1_md5, bkg1_md5, sound1_md5, photo1_md5, thumb1_md5));
        await put('projects', makeProject(2, 'Project Beta', char2_md5, bkg2_md5, sound2_md5, photo2_md5, thumb2_md5));
        await put('projects', makeProject(3, 'Project Gamma', char3_md5, bkg3_md5, sound3_md5, photo3_md5, thumb3_md5));

        // 為 Project 1 存入自訂手勢模型
        await put('gestures', {
            projectId: '1',
            payload: {
                dataset: {
                    fist: [[0.1, 0.2, 0.3]],
                    open_palm: [[0.4, 0.5, 0.6]]
                },
                labels: ['fist', 'open_palm'],
                k: 3
            },
            mtime: Date.now()
        });
    }, { customCharSvg: CUSTOM_CHAR_SVG, customBkgSvg: CUSTOM_BKG_SVG, pngBase64: DUMMY_PNG_BASE64, wavBase64: DUMMY_WAV_BASE64 });
}

async function main() {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }

    console.log('=== [作品匯出與匯入 (.sjr) 全自動化端對端驗證] ===\n');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    // 1. 初始化資料環境
    await page.goto(`${BASE_URL}/home`, { waitUntil: 'domcontentloaded' });
    await sleep(500);
    await seedTestEnvironment(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#scrollarea', { timeout: 10000 });
    await sleep(500);

    console.log('\n--- [驗證 a: 比對修改前後 .sjr 檔案大小與檔案清單] ---');
    // 在同環境中產生舊版全部打包的 zip 與新版 metadata 過濾的 zip
    const comparison = await page.evaluate(async () => {
        const Web = window.__Web;
        const projectFromDB = await new Promise(res => {
            const req = indexedDB.open('scratchjr', 1);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction('projects', 'readonly');
                const r = tx.objectStore('projects').get(1);
                r.onsuccess = () => res(r.result);
            };
        });
        const jsonData = projectFromDB;
        const parsed = typeof jsonData.json === 'string' ? JSON.parse(jsonData.json) : jsonData.json;
        const thumb = typeof jsonData.thumbnail === 'string' ? JSON.parse(jsonData.thumbnail) : jsonData.thumbnail;
        const pageId = 'page1';
        const sprite1Id = 'sprite1';
        const spritePhotoId = 'spritePhoto';
        const pageObj = parsed[pageId] || {};
        const spr1 = pageObj[sprite1Id] || {};
        const sprPhoto = pageObj[spritePhotoId] || {};
        const metadata = {
            thumbnails: [thumb.md5],
            characters: [spr1.md5, sprPhoto.md5].filter(Boolean),
            backgrounds: [pageObj.md5].filter(Boolean),
            sounds: (spr1.sounds || []).filter(Boolean)
        };

        // 1. 舊版行為 (無 metadata，全部打包)
        const oldZipResult = await Web.buildProjectZipBlob(JSON.stringify(jsonData), 'ProjectAlpha_Old', null);
        const oldBuf = await oldZipResult.blob.arrayBuffer();

        // 2. 新版行為 (有 metadata，精確過濾)
        const newZipResult = await Web.buildProjectZipBlob(JSON.stringify(jsonData), 'ProjectAlpha_New', metadata);
        const newBuf = await newZipResult.blob.arrayBuffer();

        return {
            oldSize: oldZipResult.blob.size,
            newSize: newZipResult.blob.size,
            oldBase64: btoa(String.fromCharCode(...new Uint8Array(oldBuf))),
            newBase64: btoa(String.fromCharCode(...new Uint8Array(newBuf))),
            metadata
        };
    });

    const oldZip = await JSZip.loadAsync(Buffer.from(comparison.oldBase64, 'base64'));
    const newZip = await JSZip.loadAsync(Buffer.from(comparison.newBase64, 'base64'));

    const oldFiles = Object.keys(oldZip.files).sort();
    const newFiles = Object.keys(newZip.files).sort();

    console.log(`- 舊版 .sjr 大小: ${comparison.oldSize} bytes (${(comparison.oldSize / 1024).toFixed(2)} KB)`);
    console.log(`- 新版 .sjr 大小: ${comparison.newSize} bytes (${(comparison.newSize / 1024).toFixed(2)} KB)`);
    console.log(`- 節省比例: ${(((comparison.oldSize - comparison.newSize) / comparison.oldSize) * 100).toFixed(1)}%`);

    console.log('- 舊版 zip 媒體檔案數:', oldFiles.filter(f => f.startsWith('project/media/')).length);
    console.log('- 新版 zip 媒體檔案數:', newFiles.filter(f => f.startsWith('project/media/')).length);
    console.log('- 新版檔案清單:\n ', newFiles.join('\n  '));

    // 斷言新版 zip 僅包含 Project Alpha 所需媒體，不包含其他專案（如 custom_dog_2, custom_robot_3）
    assert(newFiles.includes('project/media/custom_cat_1.svg'), '應包含自訂角色 SVG');
    assert(newFiles.includes('project/media/custom_cat_1.png'), '應包含自訂角色 altmd5 PNG');
    assert(newFiles.includes('project/media/custom_park_1.svg'), '應包含自訂背景 SVG');
    assert(newFiles.includes('project/media/custom_park_1.png'), '應包含自訂背景 altmd5 PNG');
    assert(newFiles.includes('project/media/recording_1.wav'), '應包含自訂錄音 WAV');
    assert(newFiles.includes('project/media/photo_1.png'), '應包含自訂照片 PNG');
    assert(newFiles.includes('project/gestures/model.json'), '應包含手勢模型');

    assert(!newFiles.includes('project/media/custom_dog_2.svg'), '不可包含專案 2 角色');
    assert(!newFiles.includes('project/media/custom_robot_3.svg'), '不可包含專案 3 角色');

    // 檢查 usershapes.json 和 userbkgs.json
    const newShapes = JSON.parse(await newZip.file('project/library/usershapes.json').async('string'));
    const newBkgs = JSON.parse(await newZip.file('project/library/userbkgs.json').async('string'));
    assert.strictEqual(newShapes.length, 1, '新版 usershapes.json 應只包含該專案用到的 1 個自訂角色');
    assert.strictEqual(newShapes[0].md5, 'custom_cat_1.svg');
    assert.strictEqual(newBkgs.length, 1, '新版 userbkgs.json 應只包含該專案用到的 1 個自訂背景');
    assert.strictEqual(newBkgs[0].md5, 'custom_park_1.svg');
    console.log('驗證 a 通過！');

    // ----------------------------------------------------
    // 驗證 b: 全新 profile 匯入新版 .sjr 並開啟專案驗證
    // ----------------------------------------------------
    console.log('\n--- [驗證 b: 全新 profile 匯入新版 .sjr 並打開作品] ---');
    const freshContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const freshPage = await freshContext.newPage();
    await freshPage.goto(`${BASE_URL}/home`, { waitUntil: 'domcontentloaded' });
    await freshPage.waitForSelector('#scrollarea', { timeout: 10000 });

    // 匯入新版 sjr
    const importRes = await freshPage.evaluate(async (newBase64) => {
        const Web = window.__Web;
        const binary = atob(newBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/zip' });
        const file = new File([blob], 'ProjectAlpha_New.sjr');

        return await new Promise(res => {
            Web.importProjectArchive(file, id => res(id));
        });
    }, comparison.newBase64);

    console.log(`- 成功匯入專案，新 ID: ${importRes}`);
    assert(importRes, '匯入應成功取得 newProjectId');

    // 開啟編輯器
    await freshPage.goto(`${BASE_URL}/editor.html?pmd5=${importRes}`, { waitUntil: 'domcontentloaded' });
    await freshPage.waitForSelector('#stage', { timeout: 15000 });
    await sleep(1500);

    // 檢查角色、背景、手勢積木是否存在
    const editorAudit = await freshPage.evaluate(async () => {
        const stage = document.querySelector('#stage');
        const stagePage = document.querySelector('.stagepage');
        const sprites = stagePage ? Array.from(stagePage.childNodes).filter(n => n.owner && n.owner.type === 'sprite') : [];
        const blocks = document.querySelectorAll('.block');
        const bkgDiv = stagePage ? Array.from(stagePage.childNodes).find(n => n.type === 'background') : null;
        return {
            hasStage: !!stage,
            spriteCount: sprites.length,
            pageBackground: bkgDiv ? bkgDiv.style.backgroundImage : '',
            blockCount: blocks.length
        };
    });
    console.log('- 編輯器載入狀態:', editorAudit);
    assert(editorAudit.hasStage, '編輯器 stage 應正常載入');
    assert.strictEqual(editorAudit.spriteCount, 2, '應成功還原 2 個角色');

    const pB = path.join(SCREENSHOTS_DIR, 'sjr-b-fresh-import-editor.png');
    await freshPage.screenshot({ path: pB });
    console.log(`- 已儲存全新 profile 專案開啟截圖: ${pB}`);
    console.log('驗證 b 通過！');

    // ----------------------------------------------------
    // 驗證 c: 同一個檔案匯入兩次，角色庫與背景庫不重複增加
    // ----------------------------------------------------
    console.log('\n--- [驗證 c: 同檔案匯入兩次，角色庫不重複] ---');
    const countsAfter1 = await freshPage.evaluate(async () => {
        const openReq = indexedDB.open('scratchjr', 1);
        const db = await new Promise(res => openReq.onsuccess = () => res(openReq.result));
        const count = storeName => new Promise(res => {
            const req = db.transaction(storeName).objectStore(storeName).count();
            req.onsuccess = () => res(req.result);
        });
        return {
            projects: await count('projects'),
            usershapes: await count('usershapes'),
            userbkgs: await count('userbkgs')
        };
    });
    console.log('- 第一次匯入後的資料庫計數:', countsAfter1);

    // 再次匯入同一個檔案
    const importRes2 = await freshPage.evaluate(async (newBase64) => {
        const Web = window.__Web;
        const binary = atob(newBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/zip' });
        const file = new File([blob], 'ProjectAlpha_New.sjr');

        return await new Promise(res => {
            Web.importProjectArchive(file, id => res(id));
        });
    }, comparison.newBase64);
    console.log(`- 第二次匯入完成，新 ID: ${importRes2}`);

    const countsAfter2 = await freshPage.evaluate(async () => {
        const openReq = indexedDB.open('scratchjr', 1);
        const db = await new Promise(res => openReq.onsuccess = () => res(openReq.result));
        const count = storeName => new Promise(res => {
            const req = db.transaction(storeName).objectStore(storeName).count();
            req.onsuccess = () => res(req.result);
        });
        return {
            projects: await count('projects'),
            usershapes: await count('usershapes'),
            userbkgs: await count('userbkgs')
        };
    });
    console.log('- 第二次匯入後的資料庫計數:', countsAfter2);

    assert.strictEqual(countsAfter2.projects, countsAfter1.projects + 1, '專案數量應增加 1 (預期出現兩份作品)');
    assert.strictEqual(countsAfter2.usershapes, countsAfter1.usershapes, '自訂角色庫 (usershapes) 數量絕不能增加');
    assert.strictEqual(countsAfter2.userbkgs, countsAfter1.userbkgs, '自訂背景庫 (userbkgs) 數量絕不能增加');
    console.log('驗證 c 通過！');

    // ----------------------------------------------------
    // 驗證 d: 用舊版 .sjr (包含全部媒體和全部角色庫) 匯入，不會造成角色庫重複
    // ----------------------------------------------------
    console.log('\n--- [驗證 d: 舊版全量 .sjr 匯入，角色庫去重] ---');
    const importOldRes1 = await freshPage.evaluate(async (oldBase64) => {
        const Web = window.__Web;
        const binary = atob(oldBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/zip' });
        const file = new File([blob], 'ProjectAlpha_Old.sjr');

        return await new Promise(res => {
            Web.importProjectArchive(file, id => res(id));
        });
    }, comparison.oldBase64);
    console.log(`- 第一次匯入舊版 .sjr，新 ID: ${importOldRes1}`);

    const countsOld1 = await freshPage.evaluate(async () => {
        const openReq = indexedDB.open('scratchjr', 1);
        const db = await new Promise(res => openReq.onsuccess = () => res(openReq.result));
        const count = storeName => new Promise(res => {
            const req = db.transaction(storeName).objectStore(storeName).count();
            req.onsuccess = () => res(req.result);
        });
        return {
            usershapes: await count('usershapes'),
            userbkgs: await count('userbkgs')
        };
    });
    console.log('- 匯入舊版後的角色庫與背景庫數量:', countsOld1);

    // 再次匯入舊版 .sjr
    const importOldRes2 = await freshPage.evaluate(async (oldBase64) => {
        const Web = window.__Web;
        const binary = atob(oldBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/zip' });
        const file = new File([blob], 'ProjectAlpha_Old.sjr');

        return await new Promise(res => {
            Web.importProjectArchive(file, id => res(id));
        });
    }, comparison.oldBase64);
    console.log(`- 第二次匯入舊版 .sjr，新 ID: ${importOldRes2}`);

    const countsOld2 = await freshPage.evaluate(async () => {
        const openReq = indexedDB.open('scratchjr', 1);
        const db = await new Promise(res => openReq.onsuccess = () => res(openReq.result));
        const count = storeName => new Promise(res => {
            const req = db.transaction(storeName).objectStore(storeName).count();
            req.onsuccess = () => res(req.result);
        });
        return {
            usershapes: await count('usershapes'),
            userbkgs: await count('userbkgs')
        };
    });
    console.log('- 第二次匯入舊版後的數量:', countsOld2);
    assert.strictEqual(countsOld2.usershapes, countsOld1.usershapes, '舊版重複匯入，角色庫不應重複增加');
    assert.strictEqual(countsOld2.userbkgs, countsOld1.userbkgs, '舊版重複匯入，背景庫不應重複增加');
    console.log('驗證 d 通過！');

    // ----------------------------------------------------
    // 驗證 e: 匯入改名成 .sjr 的文字檔，顯示錯誤提示且格子恢復可點擊
    // ----------------------------------------------------
    console.log('\n--- [驗證 e: 匯入損壞/文字檔，顯示錯誤提示與狀態恢復] ---');
    await freshPage.goto(`${BASE_URL}/home`, { waitUntil: 'domcontentloaded' });
    await freshPage.waitForSelector('#importproject', { timeout: 10000 });

    // 監聽 file chooser 並提供一般文字檔假扮的 .sjr
    const dummyTxtPath = path.join(ROOT, 'ui-audit', 'corrupt_test.sjr');
    fs.writeFileSync(dummyTxtPath, 'This is definitely not a zip file or a valid ScratchJr project.');

    // 點擊 importproject
    console.log('- 點擊匯入按鈕並上傳偽裝的 .sjr 文字檔...');
    const [fileChooser] = await Promise.all([
        freshPage.waitForEvent('filechooser'),
        freshPage.click('#importproject')
    ]);
    await fileChooser.setFiles(dummyTxtPath);

    // 等待 toast 出現
    const toast = await freshPage.waitForSelector('.import-toast', { state: 'visible', timeout: 5000 });
    const toastText = await toast.textContent();
    console.log(`- 錯誤提示文字: "${toastText}"`);
    assert(toastText.includes('這個檔案不是 ScratchJr 作品') || toastText.includes('This file is not a ScratchJr project'),
        '應顯示兒童友善錯誤提示');

    // 截圖 toast
    const pE = path.join(SCREENSHOTS_DIR, 'sjr-e-import-failed-toast.png');
    await freshPage.screenshot({ path: pE });
    console.log(`- 已儲存錯誤提示截圖: ${pE}`);

    // 檢查匯入格子是否恢復正常 (無 importing class)
    const isImportingClass = await freshPage.evaluate(() => {
        const el = document.querySelector('.aproject.importproject');
        return el ? el.classList.contains('importing') : true;
    });
    assert.strictEqual(isImportingClass, false, '匯入失敗後，匯入按鈕應解除 importing 狀態恢復可點擊');
    console.log('- 匯入格子狀態驗證成功: 已恢復正常可點擊');

    // 清理測試檔案
    try { fs.unlinkSync(dummyTxtPath); } catch (e) {}
    await freshContext.close();
    await context.close();
    await browser.close();

    console.log('\n=== 所有 .sjr 匯出/匯入驗證項目全數通過！ ===\n');
}

main().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('驗證失敗:', err);
    process.exit(1);
});
