const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {optimize} = require('svgo');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'scratchjr-png-cache');

// 已廢棄或未在執行期使用的靜態檔案
const UNUSED_RUNTIME_FILES = new Set([
    'assets/aitrainer/gesture-trainer-scene.png',
    'assets/aitrainer/gesture-trainer-scene-v2.png'
]);

// 判斷檔案是否應被排除
const isExcluded = (name, relative) =>
    name.endsWith('.map') ||
    name === 'Thumbs.db' ||
    name === '.DS_Store' ||
    UNUSED_RUNTIME_FILES.has(relative);

// Loaded as text and patched with string replace (Sprite.drawBalloon, Paint.setSplashColor).
const TEXT_PATCHED_SVGS = new Set([
    'assets/balloon.svg',
    'assets/paint/splash.svg',
    'assets/paint/splashshade.svg'
]);

// 判斷是否為 ScratchJr 核心解析之向量圖（絕對不可由 SVGO 改寫）
function isEngineParsedSvg (relative) {
    return relative.indexOf('svglibrary/') === 0 || relative.indexOf('samples/') === 0 ||
        TEXT_PATCHED_SVGS.has(relative);
}

/**
 * 遞迴複製並優化靜態資源
 * - PNG：以檔案 hash 快取，使用高壓縮比無損壓縮（避免調色盤量化產生色帶）
 * - 非圖庫 SVG：使用 svgo 移除冗餘中繼資料
 * - 排除暫存檔與未引用檔案
 */
async function copyAndOptimize (sourceDir, outputDir, baseDir = sourceDir) {
    fs.mkdirSync(outputDir, {recursive: true});
    fs.mkdirSync(CACHE_DIR, {recursive: true});

    let files = [];
    let stats = {
        pngSavedBytes: 0,
        svgSavedBytes: 0,
        processedCount: 0
    };

    for (const name of fs.readdirSync(sourceDir).sort()) {
        const sourcePath = path.join(sourceDir, name);
        const outputPath = path.join(outputDir, name);
        const relative = path.relative(baseDir, sourcePath).replace(/\\/g, '/');

        if (isExcluded(name, relative) || name === 'precache-manifest.js') {
            continue;
        }

        if (fs.statSync(sourcePath).isDirectory()) {
            const sub = await copyAndOptimize(sourcePath, outputPath, baseDir);
            files = files.concat(sub.files);
            stats.pngSavedBytes += sub.stats.pngSavedBytes;
            stats.svgSavedBytes += sub.stats.svgSavedBytes;
            stats.processedCount += sub.stats.processedCount;
            continue;
        }

        let data = fs.readFileSync(sourcePath);
        const ext = path.extname(name).toLowerCase();

        // 規則 2：不可對 svglibrary/ 與 samples/ 底下的 SVG 做 SVGO 或任何改寫
        if (ext === '.svg' && !isEngineParsedSvg(relative)) {
            try {
                const result = optimize(data.toString('utf8'), {
                    path: sourcePath,
                    multipass: true,
                    plugins: [{
                        name: 'preset-default',
                        params: {overrides: {removeViewBox: false}}
                    }]
                });
                const optBuffer = Buffer.from(result.data);
                if (optBuffer.length < data.length) {
                    stats.svgSavedBytes += data.length - optBuffer.length;
                    data = optBuffer;
                }
            } catch (error) {
                // SVGO 失敗時保留原始內容
            }
        } else if (ext === '.png') {
            try {
                // 使用 SHA-256 建立 PNG 建置快取，避免每次全量耗時重壓
                const hash = crypto.createHash('sha256').update(data).digest('hex');
                const cacheFile = path.join(CACHE_DIR, hash + '.png');

                if (fs.existsSync(cacheFile)) {
                    const cached = fs.readFileSync(cacheFile);
                    if (cached.length < data.length) {
                        stats.pngSavedBytes += data.length - cached.length;
                        data = cached;
                    }
                } else {
                    // 使用無損高效壓縮（不開啟 palette: true 避免圖示色帶）
                    const optimized = await sharp(data).png({
                        compressionLevel: 9,
                        effort: 7
                    }).toBuffer();

                    if (optimized.length < data.length) {
                        stats.pngSavedBytes += data.length - optimized.length;
                        data = optimized;
                        fs.writeFileSync(cacheFile, optimized);
                    } else {
                        // 若無法更小則快取原始檔
                        fs.writeFileSync(cacheFile, data);
                    }
                }
            } catch (error) {
                // Sharp 處理失敗時保留原始檔案
            }
        }

        fs.writeFileSync(outputPath, data);
        files.push(relative);
        stats.processedCount++;
    }

    return {files, stats};
}

module.exports = {
    copyAndOptimize,
    UNUSED_RUNTIME_FILES,
    isExcluded,
    isEngineParsedSvg
};
