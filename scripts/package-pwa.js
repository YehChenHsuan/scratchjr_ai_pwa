#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {copyAndOptimize} = require('./pwa-optimizer');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'editions', 'free', 'src');
const OUTPUT = path.join(ROOT, 'dist', 'pwa');

(async () => {
    fs.rmSync(OUTPUT, {recursive: true, force: true});
    console.log(`==> packaging PWA to ${OUTPUT}`);
    const {files, stats} = await copyAndOptimize(SOURCE, OUTPUT);

    const aiFiles = files.filter(file => file.indexOf('vendor/ai/') === 0);
    const coreFiles = files.filter(file => file.indexOf('vendor/ai/') !== 0);
    const hash = crypto.createHash('sha256');
    files.forEach(file => {
        hash.update(file);
        hash.update(fs.readFileSync(path.join(OUTPUT, file)));
    });
    const version = hash.digest('hex').slice(0, 16);
    const manifest = `self.__SCRATCHJR_PRECACHE_VERSION=${JSON.stringify(version)};\n` +
        `self.__SCRATCHJR_CORE_URLS=${JSON.stringify(coreFiles.map(file => './' + file), null, 2)};\n` +
        `self.__SCRATCHJR_AI_URLS=${JSON.stringify(aiFiles.map(file => './' + file), null, 2)};\n`;
    fs.writeFileSync(path.join(OUTPUT, 'precache-manifest.js'), manifest);

    const sourceBytes = files.reduce((sum, file) => sum + fs.statSync(path.join(SOURCE, file)).size, 0);
    const outputFiles = files.concat('precache-manifest.js');
    const outputBytes = outputFiles.reduce((sum, file) => sum + fs.statSync(path.join(OUTPUT, file)).size, 0);
    const report = {
        generatedAt: new Date().toISOString(),
        version,
        files: outputFiles.length,
        coreFiles: coreFiles.length,
        aiFiles: aiFiles.length,
        sourceBytes,
        outputBytes,
        savedBytes: sourceBytes - outputBytes,
        pngSavedBytes: stats.pngSavedBytes,
        svgSavedBytes: stats.svgSavedBytes
    };
    fs.writeFileSync(path.join(OUTPUT, 'deployment-report.json'), JSON.stringify(report, null, 2));

    // Netlify headers: keep the service worker fresh, fix webmanifest MIME.
    fs.writeFileSync(path.join(OUTPUT, '_headers'),
        '/service-worker.js\n  Cache-Control: no-cache\n' +
        '/precache-manifest.js\n  Cache-Control: no-cache\n' +
        '/*.webmanifest\n  Content-Type: application/manifest+json\n');
    console.log(`PWA deployment package: ${OUTPUT}`);
    console.log(JSON.stringify(report, null, 2));
})();
