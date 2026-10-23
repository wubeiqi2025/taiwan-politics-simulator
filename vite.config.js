import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 构建为单一 HTML 文件：双击即可离线打开
export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  build: { target: 'es2020', chunkSizeWarningLimit: 20000, assetsInlineLimit: 100000000 },
  server: { port: 5178 },
});
