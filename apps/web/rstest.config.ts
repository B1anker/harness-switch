import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [pluginReact()],
  testEnvironment: 'happy-dom',
  setupFiles: ['./rstest.setup.ts'],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@pierre/diffs/react': path.resolve(rootDir, 'tests/stubs/pierre-diffs-react.tsx'),
    },
  },
});
