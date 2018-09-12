var path = require('path');

module.exports = {
    entry: './src/index',
    output: {
        path: path.resolve(__dirname, 'lib'),
        filename: 'index.js'
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.json']
    },
    module: {
        rules: [{
            test: /\.(tsx?)|(ts)|(js)$/,
            exclude: /node_modules/,
            loader: 'babel-loader'
        }]
    }
};
