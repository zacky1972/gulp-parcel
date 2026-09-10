const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {pipeline} = require('stream');
const vfs = require('vinyl-fs');
const parcel = require('../');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gulp-parcel-test-'));
const originalDirectory = process.cwd();
const source = path.join(root, 'build');
const destination = path.join(root, 'dist');
const pages = ['one/index.html', 'two/index.html'];
const emitted = [];

process.chdir(root);
pages.forEach((page, index) => {
    const directory = path.dirname(path.join(source, page));
    fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(path.join(directory, 'app.css'), `body { color: ${index ? 'blue' : 'red'}; }`);
    fs.writeFileSync(path.join(directory, 'shared.css'), '.shared { padding: 4px; }');
    fs.writeFileSync(path.join(directory, 'first.js'), "import './shared.css'; export default 'first';");
    fs.writeFileSync(path.join(directory, 'second.js'), "import './shared.css'; export default 'second';");
    fs.writeFileSync(path.join(directory, 'app.js'),
        `Promise.all([import('./first.js'), import('./second.js')]).then(() => console.log(${JSON.stringify(page)}));`);
    fs.writeFileSync(path.join(source, page),
        `<html><head><link rel="stylesheet" href="app.css"></head><body data-page="${page}"><script src="app.js"></script></body></html>`);
});

const compiled = parcel({
    watch: false,
    cache: false,
    minify: false,
    sourceMaps: false,
    logLevel: 0
});
compiled.on('data', file => emitted.push(file.relative.replace(/\\/g, '/')));

pipeline(vfs.src(path.join(source, '**/*.html'), {read: false}), compiled, vfs.dest(destination), error => {
    try {
        if(error) throw error;
        assert.deepStrictEqual(emitted.filter(file => file.endsWith('.html')).sort(), pages);
        assert.strictEqual(new Set(emitted).size, emitted.length, 'each output is emitted once');
        pages.forEach(page => {
            const output = path.join(destination, page);
            const html = fs.readFileSync(output, 'utf8');
            assert(html.includes(`data-page="${page}"`), 'the page contents are preserved');
            const links = Array.from(html.matchAll(/(?:href|src)="([^"]+)"/g), match => match[1]);
            assert.strictEqual(links.filter(link => link.endsWith('.js')).length, 1);
            const styles = [];
            links.forEach(link => {
                assert(!path.isAbsolute(link), 'assets use relative URLs by default');
                const asset = path.resolve(path.dirname(output), link);
                assert(fs.existsSync(asset), `the generated asset exists: ${link}`);
                const text = fs.readFileSync(asset, 'utf8');
                if(link.endsWith('.js')) assert(text.includes(page), 'the script belongs to this page');
                if(link.endsWith('.css')) styles.push(text);
            });
            assert(styles.some(text => text.includes(page.startsWith('one/') ? 'red' : 'blue')),
                'the styles belong to this page');
        });
        console.log('Nested HTML pages and their CSS/JS assets are preserved.');
    } catch (failure) {
        console.error(failure);
        process.exitCode = 1;
    } finally {
        process.chdir(originalDirectory);
        fs.rmSync(root, {recursive: true, force: true});
    }
});
