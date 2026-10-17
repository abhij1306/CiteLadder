import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import { resolve } from 'node:path';

export default defineConfig({
  // Library builds leave NODE_ENV to consumers by default. This HTML is the
  // browser runtime itself, so React must not require a Node process global.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [
    react(),
    {
      name: 'mcp-inline-resource',
      enforce: 'post',
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const script = Object.values(bundle).find(
            (entry) => entry.type === 'chunk' && entry.isEntry,
          );
          const styles = Object.values(bundle).flatMap((entry) =>
            entry.type === 'asset' && entry.fileName.endsWith('.css') ? [entry.source] : [],
          );
          if (script?.type !== 'chunk') throw new Error('Missing analytics entry');
          // Tree shaking is complete. Drop purity annotations before embedding:
          // formatting them inside HTML is not idempotent in the current toolchain.
          const code = script.code.replaceAll(/\/\*\s*@__PURE__\s*\*\//gu, '');
          const escapedCode = code.replaceAll('</script', String.raw`<\/script`);
          const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CiteLadder analytics</title><style>${styles.join('\n')}</style></head><body><div id="root"></div><script type="module">${escapedCode}</script></body></html>`;
          for (const key of Object.keys(bundle)) delete bundle[key];
          this.emitFile({ type: 'asset', fileName: 'analytics.html', source: html });
        },
      },
    },
  ],
  resolve: { alias: { '@': resolve(import.meta.dirname, '../..') } },
  css: { postcss: { plugins: [tailwind()] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: { entry: 'src/main.tsx', formats: ['es'], fileName: 'analytics' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
