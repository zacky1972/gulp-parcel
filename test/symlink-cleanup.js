'use strict';

// Focused regression: Parcel's temporary cleanup must never follow symlinks
// into data that is not part of the generated output directory.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const isolated = { exports: {} };
vm.runInNewContext(source + '\nmodule.exports.cleanupForTest = removeDirectory;', {
  module: isolated,
  process,
  console,
  require(name) {
    if (name === 'fs') return fs;
    if (name === 'path') return path;
    return function unusedParcelDependency() {};
  }
}, { filename: 'index.js' });
const cleanup = isolated.exports.cleanupForTest;
assert.strictEqual(typeof cleanup, 'function');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gulp-parcel-cleanup-'));
try {
  const external = path.join(root, 'user-data');
  const output = path.join(root, 'parcel-output');
  fs.mkdirSync(external);
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(external, 'do-not-delete.txt'), 'unchanged');

  const link = path.join(output, 'external-link');
  fs.symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(output, 'generated.js'), 'built');
  cleanup(output);
  assert.strictEqual(fs.existsSync(output), false, 'generated output is removed');
  assert.strictEqual(
    fs.readFileSync(path.join(external, 'do-not-delete.txt'), 'utf8'),
    'unchanged',
    'linked user data must survive cleanup'
  );

  const rootLink = path.join(root, 'linked-output-root');
  fs.symlinkSync(external, rootLink, process.platform === 'win32' ? 'junction' : 'dir');
  cleanup(rootLink);
  assert.strictEqual(fs.existsSync(rootLink), false, 'the symlink itself is removed');
  assert.strictEqual(
    fs.readFileSync(path.join(external, 'do-not-delete.txt'), 'utf8'),
    'unchanged',
    'cleanup of a linked output root cannot follow the link'
  );
  console.log('Parcel symlink cleanup regression passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
