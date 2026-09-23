#!/usr/bin/env node
// Minimal zero-dep static server for local development.
// Serves the editions/free/src directory plus the webpack bundle.
// Usage: npm run serve  (then open http://localhost:8080/index.html)

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.SERVE_ROOT || path.resolve(__dirname, '..');
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
}).listen(PORT, () => {
    console.log(`ScratchJr web serving at http://localhost:${PORT}/index.html`);
    console.log('Make sure you have run `npm run dev` (or `watch`) to build the bundle.');
});
