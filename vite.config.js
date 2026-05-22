import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    // web/dist/ に出力する
    outDir: 'web/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'web/src/main.js',
      external: ['three'],
      output: {
        // 固定のファイル名にする（ハッシュをつけるとキャッシュ更新で index.html も更新する必要が出るため）
        entryFileNames: 'main.js',
        assetFileNames: 'main.css',
      }
    }
  }
});
