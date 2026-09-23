#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {UNUSED_RUNTIME_FILES} = require('./pwa-optimizer');

const ROOT = path.resolve(__dirname, '..');
const FREE_SRC = path.join(ROOT, 'editions', 'free', 'src');
const targetArg = process.argv[2] ? path.resolve(process.argv[2]) : null;
const TARGET_DIR = targetArg || (fs.existsSync(path.join(ROOT, 'docs')) ? path.join(ROOT, 'docs') : FREE_SRC);
const OUTPUT = path.join(TARGET_DIR, 'precache-manifest.js');
const EXCLUDED = new Set(['precache-manifest.js', 'app.bundle.js.map', '_headers', '.nojekyll']);

function collect (directory, base, result) {
    fs.readdirSync(directory).sort().forEach(name => {
        const fullPath = path.join(directory, name);
        const relative = path.relative(base, fullPath).replace(/\\/g, '/');
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            collect(fullPath, base, result);
        } else if (!EXCLUDED.has(relative) && !relative.endsWith('.map') && !UNUSED_RUNTIME_FILES.has(relative)) {
            result.push(relative);
        }
    });
}

const files = [];
collect(TARGET_DIR, TARGET_DIR, files);

const coreHashes = {};
const aiHashes = {};
const coreHash = crypto.createHash('sha256');
const aiHash = crypto.createHash('sha256');

const aiFiles = [];
const coreFiles = [];

files.forEach(file => {
    const fileBuf = fs.readFileSync(path.join(TARGET_DIR, file));
    // 取內容 SHA-256 前 12 碼作為逐檔版本標識
    const fileHash = crypto.createHash('sha256').update(fileBuf).digest('hex').slice(0, 12);
    const url = './' + file;

    if (file.indexOf('vendor/ai/') === 0) {
        aiFiles.push(url);
        aiHashes[url] = fileHash;
        aiHash.update(file);
        aiHash.update(fileBuf);
    } else {
        coreFiles.push(url);
        coreHashes[url] = fileHash;
        coreHash.update(file);
        coreHash.update(fileBuf);
    }
});

const coreVersion = coreHash.digest('hex').slice(0, 16);
// AI 模型檔案獨立版本 Hash，核心檔案改動絕不影響此版本號
const aiVersion = aiHash.digest('hex').slice(0, 16);

const output = `self.__SCRATCHJR_PRECACHE_VERSION=${JSON.stringify(coreVersion)};\n` +
    `self.__SCRATCHJR_AI_VERSION=${JSON.stringify(aiVersion)};\n` +
    `self.__SCRATCHJR_CORE_URLS=${JSON.stringify(coreFiles, null, 2)};\n` +
    `self.__SCRATCHJR_CORE_HASHES=${JSON.stringify(coreHashes, null, 2)};\n` +
    `self.__SCRATCHJR_AI_URLS=${JSON.stringify(aiFiles, null, 2)};\n` +
    `self.__SCRATCHJR_AI_HASHES=${JSON.stringify(aiHashes, null, 2)};\n`;

fs.writeFileSync(OUTPUT, output);

if (TARGET_DIR !== FREE_SRC) {
    fs.writeFileSync(path.join(FREE_SRC, 'precache-manifest.js'), output);
}

console.log(`Generated precache manifest (Core: ${coreVersion}, AI: ${aiVersion}) from ${path.relative(ROOT, TARGET_DIR)}: ${coreFiles.length} core, ${aiFiles.length} AI files`);
