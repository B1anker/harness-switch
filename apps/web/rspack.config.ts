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
  // Off explicitly: `rspack dev` enables lazy compilation by default for web-only
  // apps, which makes lazily imported modules fetch themselves from the dev
  // server at runtime (`POST /lazy-compilation-*`). Those endpoints die behind
  // the :8787 server/reverse proxies, so static files must always be complete
  // enough to serve on their own.
  lazyCompilation: false,
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
      // `@pierre/diffs` reaches for Shiki's full language bundle and Pierre's full theme
      // catalogue, both of which register a dynamic import per entry. That made the built
      // output 326 chunks / 13MB, almost all of it grammars and themes for languages this
      // app never renders. These two stand-ins narrow the sets to what the config diff
      // viewer actually asks for; see the files themselves for the contract they keep.
      shiki$: path.resolve(rootDir, 'src/shiki/bundle.ts'),
      '@pierre/theming/themes$': path.resolve(rootDir, 'src/shiki/themes.ts'),
      // Same idea for the 608KB inlined Oniguruma binary, which only the
      // `preferredHighlighter: 'shiki-wasm'` branch loads.
      'shiki/wasm': path.resolve(rootDir, 'src/shiki/wasm-stub.ts'),
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
    // Static assets (favicon etc.) land next to the built bundle.
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: path.resolve(rootDir, 'public'),
          to: path.resolve(rootDir, '../server/public'),
        },
      ],
    }),
    isDev ? new ReactRefreshPlugin() : undefined,
  ].filter(Boolean),
  devServer: {
    port: 5173,
    historyApiFallback: true,
    // `bun run dev` serves the UI from :8787 (the port people actually open / tunnel).
    // Write compiled assets to apps/server/public so that process sees each rebuild.
    devMiddleware: {
      writeToDisk: true,
    },
    proxy: [
      {
        context: ['/api', '/healthz'],
        target: 'http://127.0.0.1:8787',
      },
    ],
  },
});
