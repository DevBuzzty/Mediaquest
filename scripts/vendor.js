'use strict';

// Erzeugt public/vendor aus den exakt gepinnten devDependencies: npm run vendor
// Der Server braucht diesen Schritt nicht, die Dateien liegen mit im Repository.

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const modules = path.join(root, 'node_modules');
const vendorDir = path.join(root, 'public', 'vendor');
const licenseDir = path.join(vendorDir, 'licenses');

function versionOf(name) {
    return JSON.parse(fs.readFileSync(path.join(modules, name, 'package.json'), 'utf8')).version;
}

fs.mkdirSync(licenseDir, { recursive: true });

// qrcode liefert kein fertiges Browser-Bundle mehr, daher klassisches Skript mit window.QRCode bauen.
esbuild.buildSync({
    entryPoints: [path.join(modules, 'qrcode', 'lib', 'browser.js')],
    outfile: path.join(vendorDir, 'qrcode.min.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'QRCode',
    target: 'es2018',
    legalComments: 'none',
    banner: { js: `/* qrcode ${versionOf('qrcode')} (MIT), siehe licenses/qrcode.txt */` }
});

fs.copyFileSync(path.join(modules, 'html5-qrcode', 'html5-qrcode.min.js'), path.join(vendorDir, 'html5-qrcode.min.js'));

fs.copyFileSync(path.join(modules, 'qrcode', 'license'), path.join(licenseDir, 'qrcode.txt'));
fs.copyFileSync(path.join(modules, 'html5-qrcode', 'LICENSE'), path.join(licenseDir, 'html5-qrcode.txt'));

const versions = { qrcode: versionOf('qrcode'), 'html5-qrcode': versionOf('html5-qrcode') };
fs.writeFileSync(path.join(vendorDir, 'VERSIONS.json'), `${JSON.stringify(versions, null, 2)}\n`);

console.log('public/vendor aktualisiert:', versions);
