const path = require('path')

module.exports = {
    entry: {
        bundle: path.join(__dirname, './index.js'),
    },

    output: {
        filename: 'worker.js',
        path: path.join(__dirname, 'worker'),
    },

    watchOptions: {
        ignored: /node_modules|dist|\.js/g,
    },

    resolve: {
        extensions: ['.js', '.json'],
        plugins: [],
    },
    mode: 'production',
    target: "webworker",
    module: {
        rules: [
            { test: /\.handlebars$/, loader: "handlebars-loader" }
        ]
    }
}
