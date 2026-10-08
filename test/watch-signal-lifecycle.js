'use strict';

// Isolated watch-mode regression: no network, Parcel installation or broad suites.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const signals = new EventEmitter();
signals.pid = process.pid;
let exitCalls = 0;
signals.exit = () => { exitCalls++; };
let stoppedParcels = 0;
class FakeParcel {
  constructor(entry) { this.entry = entry; }
  bundle() {
    if (this.entry.endsWith('/broken.js')) {
      return Promise.reject(new Error('watch build failed'));
    }
    return Promise.resolve({ name: '/fixtures/output.js' });
  }
  stop() { stoppedParcels++; return Promise.resolve(); }
}
class FakePluginError extends Error {
  constructor(name, problem) { super(String(problem)); this.plugin = name; }
}
const removedDirectories = [];
const fakeFs = {
  readFile(_name, cb) { cb(null, Buffer.from('built')); },
  stat(_name, cb) { cb(null, { size: 5 }); },
  lstatSync(name) {
    if (name.startsWith('.tmp-gulp-compile-')) {
      return { isDirectory: () => true };
    }
    const error = new Error('missing fake path');
    error.code = 'ENOENT';
    throw error;
  },
  readdirSync() { return []; },
  rmdirSync(name) { removedDirectories.push(name); },
  unlinkSync() { throw new Error('unexpected fake unlink'); },
};
const context = { module: {exports: {}}, process: signals, Buffer };
context.require = name => {
  if (name === 'parcel-bundler') return FakeParcel;
  if (name === 'plugin-error') return FakePluginError;
  if (name === 'fs') return fakeFs;
  if (name === 'path') return path;
  if (name === 'through2') return {
    obj(transform) {
      const stream = new EventEmitter();
      stream.transform = transform;
      return stream;
    }
  };
  throw new Error('Unexpected dependency ' + name);
};
vm.runInNewContext(source, context, {filename: 'index.js'});
const plugin = context.module.exports;
const runFile = (stream, pathname) => new Promise((resolve, reject) => {
  stream.transform.call(stream, {path: pathname, contents: null}, 'utf8',
    (err, file) => err ? reject(err) : resolve(file));
});
(async () => {
  const watcher = plugin({watch: true, production: false});
  assert.strictEqual(signals.listenerCount('SIGINT'), 0);
  await runFile(watcher, '/fixtures/a.js');
  assert.strictEqual(signals.listenerCount('SIGINT'), 1);
  await runFile(watcher, '/fixtures/b.js');
  await runFile(watcher, '/fixtures/c.js');
  assert.strictEqual(signals.listenerCount('SIGINT'), 1,
    'three files in a watcher must share one handler');
  assert.strictEqual(removedDirectories.length, 0,
    'watch output must remain while the stream is active');
  watcher.emit('end');
  watcher.emit('close');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(stoppedParcels, 3,
    'finished watcher stream must stop every Parcel watcher');
  assert.strictEqual(signals.listenerCount('SIGINT'), 0,
    'finished watchers must release their process handler');
  assert.strictEqual(removedDirectories.length, 1,
    'end+close must clean the generated watch root exactly once');

  const destroyed = plugin({watch: true, production: false});
  await runFile(destroyed, '/fixtures/d.js');
  destroyed.emit('close');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(stoppedParcels, 4,
    'destroyed watcher stream must stop its Parcel watcher');
  assert.strictEqual(signals.listenerCount('SIGINT'), 0,
    'destroyed watchers must release the handler');
  assert.strictEqual(removedDirectories.length, 2,
    'destroyed watcher must clean its generated watch root');
  assert.notStrictEqual(removedDirectories[0], removedDirectories[1],
    'independent watchers must clean distinct generated roots');

  const interrupted = plugin({watch: true, production: false});
  await runFile(interrupted, '/fixtures/signal.js');
  signals.emit('SIGINT');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(stoppedParcels, 5,
    'SIGINT must stop the active Parcel watcher before process exit');
  assert.strictEqual(signals.listenerCount('SIGINT'), 0,
    'SIGINT teardown must immediately release its handler');
  assert.strictEqual(removedDirectories.length, 3,
    'SIGINT teardown must clean the generated root after watcher shutdown');
  assert.strictEqual(exitCalls, 1,
    'SIGINT teardown must exit exactly once after watcher shutdown');

  const normal = plugin({watch: false, production: false, outDir: '/build'});
  await runFile(normal, '/fixtures/e.js');
  assert.strictEqual(signals.listenerCount('SIGINT'), 0,
    'nonwatch builds still release after each completion');
  const failedWatch = plugin({watch: true, production: false});
  let watchError = null;
  try {
    await runFile(failedWatch, '/fixtures/broken.js');
  } catch (error) {
    watchError = error;
  }
  assert(watchError, 'failed watch transform must report its Parcel error');
  assert(String(watchError).includes('watch build failed'));
  assert.strictEqual(removedDirectories.length, 3,
    'one failed watch build must not delete the shared generated root');
  assert.strictEqual(signals.listenerCount('SIGINT'), 1,
    'failed watch stream retains teardown ownership until close');
  failedWatch.emit('close');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(stoppedParcels, 6,
    'closing the failed watch stream stops its Parcel watcher');
  assert.strictEqual(signals.listenerCount('SIGINT'), 0,
    'closing the failed watch stream releases its signal handler');
  assert.strictEqual(removedDirectories.length, 4,
    'failed watch output is cleaned once at stream teardown');
  console.log('Focused watcher signal lifecycle regression passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
