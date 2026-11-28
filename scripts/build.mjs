import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const webpack = require('webpack');
const root = fileURLToPath(new URL('../', import.meta.url));
const common = {
    mode: 'production',
    context: root,
    target: ['web', 'es2022'],
    devtool: false,
    experiments: { outputModule: true },
    module: { parser: { javascript: { url: false, importMeta: false } } },
    externalsType: 'import',
    externals: [({ request }, callback) => {
        if (request === '/script.js' || request?.startsWith('/scripts/')) callback(null, request);
        else if (request === '@sillytavern/script') callback(null, '/script.js');
        else if (request?.startsWith('@sillytavern/scripts/')) callback(null, request.replace('@sillytavern', '') + '.js');
        else callback();
    }],
    optimization: { splitChunks: false, runtimeChunk: false },
    performance: { hints: false },
};
const moduleOutput = filename => ({
    path: path.join(root, 'src'),
    filename,
    library: { type: 'module' },
});
const vendor = name => path.join(root, 'src', 'baibai-preset', 'vendor', name);
const compiler = webpack([
    {
        ...common,
        entry: './index.js',
        output: moduleOutput('runtime.bundle.js'),
    },
    {
        ...common,
        entry: './src/baibai-preset/index.js',
        output: moduleOutput('baibai-preset.bundle.js'),
        module: {
            parser: { javascript: { ...common.module.parser.javascript, dynamicImportMode: 'eager' } },
        },
        resolve: {
            alias: {
                'vue$': vendor('vue.esm-browser.prod.js'),
                'vue-draggable-next$': vendor('vue-draggable-next.esm-browser.prod.js'),
            },
        },
    },
]);

try {
    const stats = await new Promise((resolve, reject) => {
        compiler.run((error, result) => error ? reject(error) : resolve(result));
    });
    const report = stats.toString({ all: false, assets: true, errors: true, warnings: true });
    if (report) console.log(report);
    if (stats.hasErrors()) process.exitCode = 1;
} finally {
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
}
