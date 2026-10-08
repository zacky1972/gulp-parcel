const parcelBundler = require('parcel-bundler');
const fs = require('fs');
const path = require('path');
const through = require('through2');
const PluginError = require('plugin-error');

// Different GulpParcel() instances in one build must not share a build root.
let nextTemporaryOutputId = 0;

function removeDirectory(dir)
{
    try {
        // Do not follow links into other user directories during cleanup.
        if(fs.lstatSync(dir).isDirectory()) {
           var files = fs.readdirSync(dir);
            for (var file in files) {
                removeDirectory(dir + '/' + files[file])
            }
            fs.rmdirSync(dir);
        } else {
            fs.unlinkSync(dir);
        }
    } catch (err) {
        if(err.code === 'ENOENT') {
            return false;
        }
    }
}

module.exports = function GulpParcel(...options)
{
    const PLUGIN_NAME = 'gulp-parcel';
    const pid = process.pid.toString();

    let g_options = {};
    if(options.length > 0) {
        if(options.length > 1) {
            g_options = options[1];
        }
        options = options[0];
    }

    // The caller may reuse this options object for multiple plugin streams.
    // Never mark a generated temporary outDir as if they supplied it.
    options = Object.assign({}, options);
    options.watch = (typeof(options.watch) == "undefined") ? false : options.watch;
    options.production = (typeof(options.production) == "undefined") ? !options.watch : options.production;
    const isTmp = options.outDir ? false : true;
    options.outDir = options.outDir
        ? options.outDir
        : ('.tmp-gulp-compile-' + pid + '-' + (++nextTemporaryOutputId));

    const source = g_options.source ? g_options.source : '';

    // Parcel 1.10 creates a filesystem watcher and worker farm for every
    // watch-mode Bundler. Keep those instances so stream teardown can call
    // Bundler.stop() instead of leaking watchers after the Gulp stream closes.
    const activeParcels = new Set();

    // A watch stream may process thousands of files; it must not register
    // a separate process signal handler per incoming file.
    let onSigint = null;
    const releaseSigint = () => {
        if(onSigint) {
            process.removeListener('SIGINT', onSigint);
            onSigint = null;
        }
    };
    const stream = through.obj(function (file, encoding, cb) {
        if (!!file.contents) {
            return cb(new PluginError(PLUGIN_NAME, "File has already been processed"));
        }

        // slashes on unix os
        // backslashes on windows
		let slashes = '/';

		if( file.path.lastIndexOf(slashes) === -1){
			slashes = '\\';
        }

        let options_c = {}, outDir;
        Object.assign(options_c, options);
        outDir = file.path.substr(file.path.lastIndexOf(source));
        let position = outDir.lastIndexOf(slashes) - 1;
        position = outDir.lastIndexOf(slashes, position);
        if(position < 0) {
            outDir = options.outDir;
        } else {
            outDir = outDir.substr(position + 1);
            outDir = outDir.substr(0, outDir.lastIndexOf(slashes));
            outDir = options.outDir + slashes + outDir;
        }
        options_c.outDir = outDir;

        if(!onSigint) {
            onSigint = () => {
                // Stop Parcel's watch resources before removing their output
                // tree or terminating the process. Removing the tree first can
                // race active watchers and the shared WorkerFarm.
                releaseSigint();
                stopActiveParcels().then(() => {
                    if(isTmp) {
                        removeDirectory(options.outDir);
                    }
                    process.exit();
                });
            };
            process.on('SIGINT', onSigint);
        }

        let finished = false;
        const finish = err => {
            if(finished) {
                return;
            }
            finished = true;
            if(!options.watch) {
                releaseSigint();
            }
            // Watch Bundlers share this generated root until stream teardown.
            if(isTmp && !options.watch && (err || options.production)) {
                removeDirectory(options.outDir);
            }
            if(err) {
                cb(new PluginError(PLUGIN_NAME, err));
            } else {
                cb(null, file);
            }
        };

        let parcel;
        Promise.resolve().then(() => {
            parcel = new parcelBundler(file.path, options_c);
            if(options.watch) {
                activeParcels.add(parcel);
            }
            return parcel.bundle();
        }).then(bundle => {
            if(parcel.error || parcel.errored) {
                throw parcel.error || new Error("Build FAIL:" + file.path);
            }
            if(!bundle || typeof bundle.name !== 'string' || !bundle.name) {
                throw new Error("Parcel did not return an output file for " + file.path);
            }

            // Parcel determines the final extension and honors outFile itself.
            // Read that output instead of guessing a path from the input name.
            fs.readFile(bundle.name, (err, data) => {
                if(err) {
                    return finish(err);
                }
                fs.stat(bundle.name, (err, stat) => {
                    if(err) {
                        return finish(err);
                    }
                    try {
                        file.path = path.join(path.dirname(file.path), path.basename(bundle.name));
                        file.contents = data;
                        file.stat = stat;
                    } catch(err) {
                        return finish(err);
                    }
                    finish();
                });
            });
        }).catch(finish);
    });
    // Keep the watcher handler across file completions, not beyond the stream.
    // Parcel 1.10's Bundler.stop() owns watcher/HMR/worker-farm shutdown, so
    // stop every watch Bundler before deleting its generated output root.
    let streamFinalized = false;
    let stoppingParcels = null;
    const stopActiveParcels = () => {
        // SIGINT and stream end/close can race. Share the same stop promise so
        // cleanup never runs ahead of an already-started watcher shutdown.
        if(stoppingParcels) {
            return stoppingParcels;
        }
        const parcels = Array.from(activeParcels);
        activeParcels.clear();
        // Parcel Bundlers in one process can share a WorkerFarm. Stop them
        // serially so concurrent Bundler.stop() calls cannot race while ending
        // that shared farm.
        stoppingParcels = parcels.reduce((chain, parcel) =>
            chain.then(() =>
                Promise.resolve()
                    .then(() => (parcel && typeof parcel.stop === 'function') ? parcel.stop() : undefined)
                    .catch(() => undefined)
            ),
        Promise.resolve());
        return stoppingParcels;
    };
    const finalizeStream = () => {
        if(streamFinalized) {
            return;
        }
        streamFinalized = true;
        releaseSigint();
        const cleanupOutput = () => {
            if(isTmp) {
                removeDirectory(options.outDir);
            }
        };
        // Always join an in-flight SIGINT stop before cleanup; an empty set can
        // mean another teardown path already owns the active watcher snapshot.
        stopActiveParcels().then(cleanupOutput);
    };
    stream.once('finish', finalizeStream);
    stream.once('end', finalizeStream);
    stream.once('close', finalizeStream);
    return stream;
}


