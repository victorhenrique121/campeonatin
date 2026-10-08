import { defineConfig, configDefaults } from 'vitest/config';

import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  root: 'src/renderer',

  build: {
    outDir: '../../dist',
    emptyOutDir: true
  },

  server: {
    port: 5173,
    strictPort: true // Força o Vite a rodar na 5173 sem mudar sozinho
  },

  test: {
    exclude: [
      ...configDefaults.exclude,
      'dist-electron/**',
      'dist/**'
    ]
  }
});