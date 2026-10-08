'use strict';

// Real Parcel integration acceptance for the production source in this PR.
// No Bundler, filesystem, stream or Vinyl mocks are installed.
if (!process.env.PARCEL_WORKERS) process.env.PARCEL_WORKERS = '1';
if (!process.env.PARCEL_MAX_CONCURRENT_CALLS) process.env.PARCEL_MAX_CONCURRENT_CALLS = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const Vinyl = require('vinyl');
const plugin = require(process.env.GULP_PARCEL_SOURCE || '../index');

const originalCwd = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gulp-parcel12-'));
const receipts = [];
const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(String(error)));

async function runCase(name, entry, source, outFile, expectError, explicitOutput) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, entry), source);
  fs.writeFileSync(path.join(directory, 'package.json'), '{"name":"parcel-dummy-fixture","version":"1.0.0"}\n');
  const oldCwd = process.cwd();
  process.chdir(directory);
  const temporaryPrefix = '.tmp-gulp-compile-' + process.pid + '-';
  const temporaryExists = () => fs.readdirSync(directory).some(name => name.startsWith(temporaryPrefix));
  const output = explicitOutput ? path.join(directory, 'keep-output') : undefined;
  const beforeListeners = process.listenerCount('SIGINT');
  const pluginOptions = {
    watch: false, production: true, cache: false, sourceMaps: false,
    minify: false, logLevel: 0, throwErrors: true, autoInstall: false,
    outFile, ...(explicitOutput ? { outDir: output } : {}),
  };
  const originalPluginOptions = JSON.stringify(pluginOptions);
  const stream = plugin(pluginOptions);
  // Constructing a second stream with these same options must not inherit a
  // generated outDir from the first, or lose failure-path cleanup ownership.
  assert.strictEqual(JSON.stringify(pluginOptions), originalPluginOptions,
    name + ': caller plugin options were modified');
  const files = [], errors = [];
  let callbacks = 0;
  stream.on('data', file => files.push(file));
  stream.on('error', error => errors.push(error));
  const callbackError = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(name + ': unresolved transform callback')), 45000);
    stream.write(new Vinyl({ cwd: directory, base: directory, path: path.join(directory, entry), contents: null }), error => {
      callbacks++;
      clearTimeout(timeout);
      // Allow the stream's corresponding error event to be delivered as well.
      setImmediate(() => resolve(error));
    });
  });
  if (expectError) {
    assert(callbackError, name + ': expected callback error');
    assert.strictEqual(callbackError.plugin, 'gulp-parcel');
    assert.strictEqual(errors.length, 1, name + ': exactly one error event');
    assert.strictEqual(files.length, 0, name + ': no failed output');
    stream.destroy();
  } else {
    assert.ifError(callbackError);
    await new Promise((resolve, reject) => {
      stream.once('end', resolve);
      stream.once('error', reject);
      stream.end();
    });
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(files.length, 1, name + ': exactly one Vinyl emission');
    assert(Vinyl.isVinyl(files[0]));
    assert.strictEqual(path.basename(files[0].path), outFile);
    assert.strictEqual(path.dirname(files[0].path), directory);
    assert(Buffer.isBuffer(files[0].contents));
    if (entry.endsWith('.html')) {
      assert(files[0].contents.toString().includes('Parcel runtime smoke'));
    } else {
      const logs = [];
      vm.runInNewContext(files[0].contents.toString(), { console: { log: value => logs.push(value) } });
      assert.deepStrictEqual(logs, ['parcel compatibility']);
      assert(files[0].contents.toString().includes('parcelRequire'));
    }
  }
  assert.strictEqual(callbacks, 1, name + ': callback completes exactly once');
  assert.strictEqual(process.listenerCount('SIGINT'), beforeListeners, name + ': signal listener released');
  assert.strictEqual(Boolean(output && fs.existsSync(output)), Boolean(explicitOutput),
    name + ': output retention/cleanup');
  assert.strictEqual(temporaryExists(), false, name + ': temporary build root not cleaned');
  receipts.push({ name, entry, outFile, emitted: files.length, errorEvents: errors.length, callbacks,
    listenerDelta: process.listenerCount('SIGINT') - beforeListeners, temporaryRemoved: !temporaryExists(),
    explicitOutputRetained: Boolean(output && fs.existsSync(output)) });
  process.chdir(oldCwd);
}

(async () => {
  if (process.env.GULP_PARCEL_BASELINE_ONLY) {
    await runCase('baseline-single-html', 'index.html', '<!doctype html><html><body><h1>Parcel runtime smoke</h1></body></html>', 'index.html', false, false);
    return;
  }
  await runCase('html-temporary', 'index.html', '<!doctype html><html><body><h1>Parcel runtime smoke</h1></body></html>', 'built-page.html', false, false);
  await runCase('renamed-javascript-temporary', 'input.js', 'const message = () => "parcel compatibility"; console.log(message());', 'renamed.bundle.js', false, false);
  await runCase('broken-project-temporary', 'broken.js', 'const = ;', 'broken.bundle.js', true, false);
  await runCase('renamed-javascript-explicit-output', 'input.js', 'const message = () => "parcel compatibility"; console.log(message());', 'retained.bundle.js', false, true);
  assert.deepStrictEqual(unhandled, [], 'no unhandled Parcel rejection');
  const receipt = {
    evidenceOnly: true,
    upstream: '6e811cd565456017c69f3fe796562c520180eea6',
    sourceSHA256: require('crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../index.js'))).digest('hex'),
    node: process.version,
    dependencies: Object.fromEntries(['parcel-bundler', 'through2', 'plugin-error', 'vinyl', '@babel/preset-env'].map(name => [name, require(name + '/package.json').version])),
    environment: { PARCEL_WORKERS: process.env.PARCEL_WORKERS, PARCEL_MAX_CONCURRENT_CALLS: process.env.PARCEL_MAX_CONCURRENT_CALLS, NODE_OPTIONS: process.env.NODE_OPTIONS },
    cases: receipts, unhandledRejections: unhandled,
  };
  if (process.env.GULP_PARCEL_RECEIPT) fs.writeFileSync(process.env.GULP_PARCEL_RECEIPT, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
});
