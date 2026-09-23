#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS = path.join(ROOT, 'ui-audit', 'screenshots');
const REQUIRED = [
    '11-fixed-1280x720.png',
    '12-fixed-960x600.png',
    '13-fixed-1600x900.png',
    '14-trainer-fixed-960x600.png',
    '15-portrait-rotate-prompt.png',
    '16-settings-1280x720.png',
    '17-settings-960x600.png',
    '18-settings-1024x768.png'
];

function scaleFor (width, height) {
    return Math.min(width / 1280, height / 720);
}

assert.strictEqual(scaleFor(1280, 720), 1);
assert.strictEqual(scaleFor(960, 600), 0.75);
assert.strictEqual(scaleFor(1600, 900), 1.25);

Promise.all(REQUIRED.map(async name => {
    const file = path.join(SCREENSHOTS, name);
    assert(fs.existsSync(file), `Missing UI regression screenshot: ${name}`);
    const metadata = await sharp(file).metadata();
    const stats = await sharp(file).stats();
    assert(metadata.width > 0 && metadata.height > 0, `Invalid screenshot: ${name}`);
    assert(stats.entropy > 0.5, `Screenshot appears blank: ${name}`);
    return `${name} ${metadata.width}x${metadata.height}`;
})).then(results => {
    console.log('UI layout verification passed:\n' + results.join('\n'));
}).catch(error => {
    console.error(error);
    process.exit(1);
});

