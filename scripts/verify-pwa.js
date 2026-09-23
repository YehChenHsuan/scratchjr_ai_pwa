#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {isEngineParsedSvg, UNUSED_RUNTIME_FILES, isExcluded} = require('./pwa-optimizer');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'editions', 'free', 'src');
const DEPLOY = path.join(ROOT, 'docs');

function read (root, relative) {
    return fs.readFileSync(path.join(root, relative));
}

function collect (directory, base, result) {
    fs.readdirSync(directory).sort().forEach(name => {
        const fullPath = path.join(directory, name);
        const relative = path.relative(base, fullPath).replace(/\\/g, '/');
        if (fs.statSync(fullPath).isDirectory()) collect(fullPath, base, result);
        else result.push(relative);
    });
}

const manifest = JSON.parse(read(SOURCE, 'manifest.webmanifest').toString('utf8'));
assert.strictEqual(manifest.lang, 'zh-TW');
assert(manifest.description.indexOf('ScratchJr') > -1 && manifest.description.indexOf('AI') > -1);

const context = {self: {}};
vm.runInNewContext(read(DEPLOY, 'precache-manifest.js').toString('utf8'), context);
const core = context.self.__SCRATCHJR_CORE_URLS;
const ai = context.self.__SCRATCHJR_AI_URLS;
assert(Array.isArray(core) && core.length > 0, 'Core precache list is empty');
assert(Array.isArray(ai) && ai.length > 0, 'AI precache list is empty');
['./index.html', './home.html', './editor.html', './app.bundle.js', './settings.json'].forEach(file => {
    assert(core.indexOf(file) > -1, `Missing critical core file: ${file}`);
});
assert(ai.every(file => file.indexOf('./vendor/ai/') === 0), 'Non-AI file found in AI cache list');

const isOptimizable = (relative) => {
    const ext = path.extname(relative).toLowerCase();
    return ext === '.png' || (ext === '.svg' && !isEngineParsedSvg(relative));
};

const sourceFiles = [];
collect(SOURCE, SOURCE, sourceFiles);
const mismatches = sourceFiles
    .filter(relative => !isExcluded(path.basename(relative), relative) && relative !== 'precache-manifest.js')
    .filter(relative => {
        const deployPath = path.join(DEPLOY, relative);
        if (!fs.existsSync(deployPath)) return true;
        if (isOptimizable(relative)) {
            const sSize = fs.statSync(path.join(SOURCE, relative)).size;
            const dSize = fs.statSync(deployPath).size;
            return dSize === 0 || dSize > sSize;
        }
        return !read(SOURCE, relative).equals(read(DEPLOY, relative));
    });
assert.deepStrictEqual(mismatches, [], `Deployment output differs from source:\n${mismatches.join('\n')}`);

const fixedViewport = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'FixedViewport.js'), 'utf8');
assert(fixedViewport.indexOf('DESIGN_WIDTH = 1280') > -1);
assert(fixedViewport.indexOf('DESIGN_HEIGHT = 720') > -1);

console.log(`PWA verification passed: ${core.length} core files, ${ai.length} AI files, source and docs match.`);
