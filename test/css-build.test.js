'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT_DIR } = require('../src/config');

const normalize = (css) => css.replace(/\r\n/g, '\n').trim();

test('public/css/app.css entspricht dem aktuellen Stand von HTML und JS', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weltenretter-css-'));
    const output = path.join(dir, 'app.css');
    try {
        const cli = path.join(ROOT_DIR, 'node_modules', 'tailwindcss', 'lib', 'cli.js');
        const build = spawnSync(process.execPath, [cli, '-c', 'tailwind.config.js', '-i', 'styles/tailwind.css', '-o', output, '--minify'], {
            cwd: ROOT_DIR,
            encoding: 'utf8',
            timeout: 60000
        });
        assert.equal(build.status, 0, build.stderr);
        const fresh = normalize(fs.readFileSync(output, 'utf8'));
        const checkedIn = normalize(fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'app.css'), 'utf8'));
        assert.ok(fresh === checkedIn, 'public/css/app.css ist veraltet. Bitte "npm run build:css" ausführen.');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
