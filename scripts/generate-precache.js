#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {UNUSED_RUNTIME_FILES} = require('./pwa-optimizer');

const ROOT = path.resolve(__dirname, '..');
const FREE_SRC = path.join(ROOT, 'editions', 'free', 'src');
// 優先使用命令列指定的目標，若無則依序檢查 docs/ 或 editions/free/src
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
const hash = crypto.createHash('sha256');
files.forEach(file => {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(TARGET_DIR, file)));
});
const version = hash.digest('hex').slice(0, 16);
const aiFiles = files.filter(file => file.indexOf('vendor/ai/') === 0);
const coreFiles = files.filter(file => file.indexOf('vendor/ai/') !== 0);
const coreUrls = coreFiles.map(file => './' + file);
const aiUrls = aiFiles.map(file => './' + file);
const output = `self.__SCRATCHJR_PRECACHE_VERSION=${JSON.stringify(version)};\n` +
    `self.__SCRATCHJR_CORE_URLS=${JSON.stringify(coreUrls, null, 2)};\n` +
    `self.__SCRATCHJR_AI_URLS=${JSON.stringify(aiUrls, null, 2)};\n`;
fs.writeFileSync(OUTPUT, output);

// 若在 docs 產生，同步一份至 editions/free/src 以確保本地伺服器與驗證一致
if (TARGET_DIR !== FREE_SRC) {
    fs.writeFileSync(path.join(FREE_SRC, 'precache-manifest.js'), output);
}

console.log(`Generated precache manifest ${version} from ${path.relative(ROOT, TARGET_DIR)}: ${coreUrls.length} core, ${aiUrls.length} AI files`);
