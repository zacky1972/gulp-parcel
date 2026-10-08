const parcelBundler = require('parcel-bundler');
const fs = require('fs');
const path = require('path');
const through = require('through2');
const PluginError = require('plugin-error');

function removeDirectory(dir)
{
    try {
        if(fs.lstatSync(dir).isDirectory()) {
           var files = fs.readdirSync(dir);
            for (var file in files) {
                removeDirectory(path.join(dir, files[file]));
            }
            fs.rmdirSync(dir);
        } else {
            // Parent directories are removed synchronously below, so their children
            // must be removed synchronously too. lstat also keeps cleanup inside the
            // temp tree instead of following directory symlinks.
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

    options.watch = (typeof(options.watch) == "undefined") ? false : options.watch;
    options.production = (typeof(options.production) == "undefined") ? !options.watch : options.production;
    const isTmp = options.outDir ? false : true;
    options.outDir = options.outDir ? options.outDir : ('.tmp-gulp-compile-' + pid);
    if(isTmp && typeof(options.publicURL) == "undefined" && typeof(options.publicUrl) == "undefined") {
        options.publicURL = './';
    }

    const source = g_options.source ? g_options.source : '';

    const stream = through.obj(function (file, encoding, cb) {
        if (!!file.contents) {
            this.emit('error', new PluginError(PLUGIN_NAME, "File has already been processed"));
            cb(null, file);
            return;
        }

        // slashes on unix os
        // backslashes on windows
		let slashes = '/';

		if( file.path.lastIndexOf(slashes) === -1){
			slashes = '\\';
        }

        let out_flname;
        if(g_options.source && !isTmp) {
            out_flname = file.path.replace(source, options.outDir);
        } else {
            out_flname = options.outDir + slashes + file.path.substr(file.path.lastIndexOf(slashes) + 1);
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

        const failBuild = () => {
            if(isTmp) {
                removeDirectory(options.outDir);
            }
            cb(new PluginError(PLUGIN_NAME, "Build FAIL:" + file.path));
        };

        const parcel = new parcelBundler(file.path, options_c);
        parcel.bundle().then(bundle => {
            if(parcel.errored) {
                failBuild();
                return;
            }

			// In case dealing with Pug files
			// at this stage Pub files should've been transformed to html
			if( out_flname.substr(out_flname.lastIndexOf('.') + 1).trim().toLowerCase() === 'pug' ){
				out_flname = out_flname.substr(0, out_flname.lastIndexOf('.') + 1) + 'html';
			}
            try {
                if(isTmp) {
                    const emitBundle = output => {
                        if(output.name && !output.isEmpty) {
                            const outputFile = file.clone({contents: false});
                            // Keep each entry's directory when moving its bundles out of temporary storage.
                            outputFile.path = path.resolve(path.dirname(file.path), path.relative(options_c.outDir, output.name));
                            outputFile.contents = fs.readFileSync(output.name);
                            outputFile.stat = fs.statSync(output.name);
                            this.push(outputFile);
                        }
                        output.childBundles.forEach(emitBundle);
                    };
                    emitBundle(bundle);
                    if(options.production) {
                        removeDirectory(options.outDir);
                    }
                    cb();
                    return;
                }
                fs.readFile(out_flname, (err, data) => {
                    // Explicit output directories settle through this callback only.
                    // Never throw from an async callback or forward the same Vinyl twice.
                    if(err || data === undefined) {
                        cb(new PluginError(PLUGIN_NAME, "Build FAIL:" + file.path));
                        return;
                    }
                    fs.lstat(out_flname, (statErr, stat) => {
                        if(statErr) {
                            cb(new PluginError(PLUGIN_NAME, "Build FAIL:" + file.path));
                            return;
                        }
                        file.contents = data;
                        file.stat = stat;
                        cb(null, file);
                    });
                });
            } catch (err) {
                failBuild();
            }
        }, failBuild);
    });

    const onSigInt = () => {
        if(isTmp) {
            removeDirectory(options.outDir);
        }
        process.exit();
    };
    const detachSigInt = () => {
        process.removeListener('SIGINT', onSigInt);
    };

    process.on('SIGINT', onSigInt);
    stream.once('finish', detachSigInt);
    stream.once('close', detachSigInt);

    return stream;
}


