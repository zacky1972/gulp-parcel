const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const parcel = require('../');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gulp-parcel-test-'));
const buildDir = path.join(root, 'build');

fs.mkdirSync(path.join(buildDir, 'css'), {recursive: true});
fs.mkdirSync(path.join(buildDir, 'js'), {recursive: true});
fs.writeFileSync(
    path.join(buildDir, 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="css/app.css"></head><body><script src="js/app.js"></script></body></html>'
);
fs.writeFileSync(path.join(buildDir, 'css', 'app.css'), 'body { color: red; }');
fs.writeFileSync(path.join(buildDir, 'js', 'app.js'), 'console.log("ok");');

const stream = parcel({
    watch: false,
    production: true,
    cache: false,
    minify: false,
    hmr: false,
    sourceMaps: false,
    logLevel: 0
});
const files = [];

stream.on('data', file => {
    files.push({
        path: path.relative(file.base, file.path),
        contents: String(file.contents)
    });
});

stream.on('error', error => {
    throw error;
});

stream.on('finish', () => {
    const outputPaths = files.map(file => file.path);
    const htmlFiles = files.filter(file => path.extname(file.path) === '.html');
    const cssFiles = files.filter(file => path.extname(file.path) === '.css');
    const jsFiles = files.filter(file => path.extname(file.path) === '.js');

    assert.strictEqual(htmlFiles.length, 1, 'emits the HTML entry once');
    assert.strictEqual(cssFiles.length, 1, 'emits the generated CSS asset');
    assert.strictEqual(jsFiles.length, 1, 'emits the generated JS asset');
    assert(!htmlFiles[0].contents.includes('.tmp-gulp-compile'), 'HTML does not reference the temporary output directory');
    assert(htmlFiles[0].contents.includes(cssFiles[0].path), 'HTML references emitted CSS with a relative path');
    assert(htmlFiles[0].contents.includes(jsFiles[0].path), 'HTML references emitted JS with a relative path');
    assert.deepStrictEqual(outputPaths.sort(), [cssFiles[0].path, htmlFiles[0].path, jsFiles[0].path].sort());
});

stream.write({path: path.join(buildDir, 'index.html'), contents: null, base: buildDir});
stream.end();
