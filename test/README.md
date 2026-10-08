# Parcel 1.10.3 completion regression checks

Run from the repository root in a private validation checkout:

```sh
npm install --no-save --package-lock=false --ignore-scripts \
  parcel-bundler@1.10.3 through2@2.0.5 plugin-error@0.1.2 vinyl@2.2.1 \
  @babel/preset-env@7.1.6
PARCEL_WORKERS=1 PARCEL_MAX_CONCURRENT_CALLS=1 \
  NODE_OPTIONS=--openssl-legacy-provider node test/parcel-1.10.3.js
```

The recorded run uses Node 24.19.0. The historical Babel preset is pinned because
Parcel 1.10.3 invokes it without a Babel API version; the current preset rejects
that invocation with `Invalid Version: undefined`. The OpenSSL legacy provider
allows the old bundler's hashing on this Node runtime. These choices are confined
to the validation environment and do not change the plugin's production
dependencies. Install scripts are disabled; these HTML/JS cases do not exercise
optional Sass/native transformer installation. The harness defaults to one Parcel
worker and one concurrent call to avoid expanding work to the host CPU count.

The harness uses the actual Bundler, filesystem, through2 stream and Vinyl class,
with no runtime mocks. It verifies:

- Valid HTML emits exactly one Vinyl object with Parcel's renamed output path.
- Compiled, renamed JavaScript emits once and executes its expected output.
- A real JavaScript syntax error reaches one PluginError and one completed
  transform callback, with no successful output or unhandled rejection.
- An explicit output directory remains available after a successful build.
- Every completed non-watching transform releases its SIGINT listener, removes
  temporary output, and preserves the emitted entry's original directory.

Generated fixtures are created under the OS temporary directory and removed
after the run. A JSON receipt is printed; set `GULP_PARCEL_RECEIPT` to an output
filename to save it. `parcel-1.10.3-receipt.json` contains the observed four-case
result for the unchanged implementation SHA256
`3ea8e1ce32d0bdcc5f1abd6ff0b290d3283cbd0ed7e72cc6a7cca9b388789b3c`.

To reproduce the negative control against the pinned upstream preimage:

```sh
git show 6e811cd565456017c69f3fe796562c520180eea6:index.js > test/upstream-index.js
GULP_PARCEL_SOURCE=./upstream-index GULP_PARCEL_BASELINE_ONLY=1 \
  PARCEL_WORKERS=1 PARCEL_MAX_CONCURRENT_CALLS=1 \
  NODE_OPTIONS=--openssl-legacy-provider node test/parcel-1.10.3.js
```

That real baseline exits 1: valid HTML emits two Vinyl objects instead of one.
The correction targets entry completion/output handling for issue #12. It does
not implement issue #2 multi-asset delivery, certify newer default dependency
combinations, or claim continuous-watch rebuild support.

This harness supplies execution evidence for the production source in this PR.
Upstream license and copyright remain unchanged.
