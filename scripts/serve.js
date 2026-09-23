#!/usr/bin/env node
// Minimal zero-dep static server for local development.
// Serves the editions/free/src directory plus the webpack bundle.
// Usage: npm run serve  (then open http://localhost:8080/index.html)

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'editions', 'free', 'src');
const BUNDLE = path.join(ROOT, 'src', 'build', 'bundles', 'app.bundle.js');
const PORT = process.env.PORT || 8080;

const MIME = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
    '.map': 'application/json'
};

http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    let filePath;
    if (urlPath === '/app.bundle.js' || urlPath === '/app.bundle.js.map') {
        filePath = path.join(path.dirname(BUNDLE), path.basename(urlPath));
    } else {
        filePath = path.join(SRC, urlPath);
    }
    fs.readFile(filePath, (err, data) => {
        if (err) { res.statusCode = 404; res.end('Not found: ' + urlPath); return; }
        res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.end(data);
    });
}).listen(PORT, () => {
    console.log(`ScratchJr web serving at http://localhost:${PORT}/index.html`);
    console.log('Make sure you have run `npm run dev` (or `watch`) to build the bundle.');
});
