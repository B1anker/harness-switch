import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import ReactRefreshPlugin from '@rspack/plugin-react-refresh';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  entry: {
    main: './src/main.tsx',
  },
  devtool: isDev ? 'cheap-module-source-map' : false,
  output: {
    path: path.resolve(rootDir, '../server/public'),
    filename: 'assets/[name].[contenthash:8].js',
    cssFilename: 'assets/[name].[contenthash:8].css',
    clean: true,
    publicPath: '/',
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: {
              react: {
                runtime: 'automatic',
                refresh: isDev,
              },
            },
          },
        },
        type: 'javascript/auto',
      },
      {
        test: /\.css$/,
        use: ['postcss-loader'],
        type: 'css/auto',
      },
    ],
  },
  experiments: {
    css: true,
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: './index.html',
    }),
    isDev ? new ReactRefreshPlugin() : undefined,
  ].filter(Boolean),
  devServer: {
    port: 5173,
    historyApiFallback: true,
    proxy: [
      {
        context: ['/api', '/healthz'],
        target: 'http://127.0.0.1:8787',
      },
    ],
  },
});
