#!/usr/bin/env node
// Build script that runs webpack and then copies optimized static assets into ./docs/
// for Cloudflare Workers deployment.

const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {copyAndOptimize} = require('./pwa-optimizer');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const FREE_SRC = path.join(ROOT, 'editions', 'free', 'src');
const BUNDLE = path.join(ROOT, 'src', 'build', 'bundles', 'app.bundle.js');

function rimraf (p) {
    if (!fs.existsSync(p)) return;
    for (const f of fs.readdirSync(p)) {
        const fp = path.join(p, f);
        if (fs.statSync(fp).isDirectory()) { rimraf(fp); fs.rmdirSync(fp); }
        else fs.unlinkSync(fp);
    }
}

(async () => {
    console.log('==> webpack production build');
    execSync('npx webpack --mode=production', {
        cwd: ROOT,
        stdio: 'inherit',
        env: Object.assign({}, process.env, {NODE_OPTIONS: '--openssl-legacy-provider'})
    });

    console.log('==> sync bundle to source');
    if (fs.existsSync(BUNDLE)) {
        fs.copyFileSync(BUNDLE, path.join(FREE_SRC, 'app.bundle.js'));
    }

    console.log('==> reset', OUT);
    rimraf(OUT);
    fs.mkdirSync(OUT, {recursive: true});

    console.log('==> optimize and copy editions/free/src -> docs/');
    const {stats} = await copyAndOptimize(FREE_SRC, OUT);
    console.log(`==> optimization stats: saved ${(stats.pngSavedBytes / 1024).toFixed(1)} KB (PNG), ${(stats.svgSavedBytes / 1024).toFixed(1)} KB (SVG)`);

    console.log('==> copy bundle -> docs/app.bundle.js');
    if (fs.existsSync(BUNDLE)) {
        fs.copyFileSync(BUNDLE, path.join(OUT, 'app.bundle.js'));
    }

    // 依據 docs/ 最終產物生成 precache-manifest.js
    console.log('==> generate precache manifest for deployment');
    execSync(`node scripts/generate-precache.js "${OUT}"`, {cwd: ROOT, stdio: 'inherit'});

    // 注入 SW Build 版本標籤，確保 service-worker.js 本身發生位元組改變以觸發所有瀏覽器（特別是 Safari）的 SW 更新流程
    const swPath = path.join(OUT, 'service-worker.js');
    if (fs.existsSync(swPath)) {
        let swContent = fs.readFileSync(swPath, 'utf8');
        const stamp = new Date().toISOString();
        if (swContent.indexOf('// SW Build Version:') > -1) {
            swContent = swContent.replace(/\/\/ SW Build Version: [^\n]+/, `// SW Build Version: ${stamp}`);
        } else {
            swContent = `// SW Build Version: ${stamp}\n` + swContent;
        }
        fs.writeFileSync(swPath, swContent);
        fs.writeFileSync(path.join(FREE_SRC, 'service-worker.js'), swContent);
    }

    // 支援非 Jekyll 靜態託管（維持原功能）
    fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

    console.log('==> done. Ready for Cloudflare deployment (wrangler deploy).');
})();
