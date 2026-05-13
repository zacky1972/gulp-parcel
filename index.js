const parcelBundler = require('parcel-bundler');
const fs = require('fs');
const path = require('path');
const through = require('through2');
const PluginError = require('plugin-error');

function removeDirectory(dir)
{
    try {
        if(fs.statSync(dir).isDirectory()) {
           var files = fs.readdirSync(dir);
            for (var file in files) {
                removeDirectory(dir + '/' + files[file])
            }
            fs.rmdirSync(dir);
        } else {
            fs.unlink(dir, (err) => {});
        }
    } catch (err) {
        if(err.code === 'ENOENT') {
            return false;
        }
    }
}

function collectFiles(dir)
{
    let results = [];

    fs.readdirSync(dir).forEach(file => {
        const filePath = path.join(dir, file);

        if(fs.statSync(filePath).isDirectory()) {
            results = results.concat(collectFiles(filePath));
        } else {
            results.push(filePath);
        }
    });

    return results;
}

function createOutputFile(file, filePath, base)
{
    const outputFile = file.clone ? file.clone({contents: false}) : Object.assign({}, file);
    outputFile.path = filePath;
    outputFile.base = base;
    outputFile.contents = fs.readFileSync(filePath);
    outputFile.stat = fs.lstatSync(filePath);

    return outputFile;
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
    options.publicURL = (typeof(options.publicURL) == "undefined" && typeof(options.publicUrl) == "undefined" && isTmp) ? './' : options.publicURL;

    const source = g_options.source ? g_options.source : '';

    return through.obj(function (file, encoding, cb) {
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

        process.on('SIGINT', () => {
            if(isTmp) {
                removeDirectory(options.outDir);
            }
            process.exit();
        });

        const parcel = new parcelBundler(file.path, options_c);
        parcel.bundle().then(bundle => {
            if(parcel.errored) {
                if(isTmp) {
                    removeDirectory(options.outDir);
                }
                this.emit('error', new PluginError(PLUGIN_NAME, "Build FAIL:" + file.path));
                cb();
                return;
            }

			// In case dealing with Pug files
			// at this stage Pub files should've been transformed to html
			if( out_flname.substr(out_flname.lastIndexOf('.') + 1).trim().toLowerCase() === 'pug' ){
				out_flname = out_flname.substr(0, out_flname.lastIndexOf('.') + 1) + 'html';
			}
            try {
                if(isTmp) {
                    const bundleOutDir = path.resolve(options_c.outDir);
                    collectFiles(bundleOutDir).forEach(filePath => {
                        this.push(createOutputFile(file, filePath, bundleOutDir));
                    });
                    if(options.production) {
                        removeDirectory(options.outDir);
                    }
                    cb();
                    return;
                }

                file.contents = fs.readFileSync(out_flname);
                file.stat = fs.lstatSync(out_flname);
                this.push(file);
                cb();
            } catch (err) {
                if(isTmp) {
                    removeDirectory(options.outDir);
                }
                this.emit('error', new PluginError(PLUGIN_NAME, "Build FAIL:" + file.path));
                cb(null, file);
            }
        });
    });
}
