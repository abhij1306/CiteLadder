import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type ViteUserConfig, loadEnv } from 'vite-plus';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const frontendRoot = fileURLToPath(new URL('../..', import.meta.url));

// Explicit return type: without it, tsc compares the inferred literal against
// every defineConfig overload and dies with TS2321 "Excessive stack depth".
export default defineConfig(({ command, mode }): ViteUserConfig => {
  const environment = loadEnv(mode, frontendRoot, '');
  // Every public value is BAKED into the bundle here, so an empty one is a
  // permanent property of the image -- and it fails silently. A missing
  // Logo.dev token simply made `logoDevUrl` answer null, and every brand mark
  // in the deployed app quietly degraded to initials with nothing in the
  // console to say why. The names are collected and reported once, so the
  // build log shows what this image will be missing.
  const emptyPublicValues: string[] = [];
  const publicValue = (name: string) => {
    const value = process.env[name] ?? environment[name] ?? '';
    if (!value) emptyPublicValues.push(name);
    return JSON.stringify(value);
  };
  // In production the API serves this bundle from its own origin, so `/api`,
  // the public `/v1` API and `/mcp` are same-origin. The dev server forwards
  // them to the API process instead.
  const apiOrigin =
    process.env.API_SERVICE_ORIGIN ?? environment.API_SERVICE_ORIGIN ?? 'http://127.0.0.1:8100';
  const proxy = Object.fromEntries(
    ['/api', '/v1', '/mcp', '/health', '/ready'].map((prefix) => [
      prefix,
      { target: apiOrigin, changeOrigin: false },
    ]),
  );

  return {
    root: appRoot,
    publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
    plugins: [
      react(),
      {
        name: 'citeladder:report-empty-public-values',
        // `configResolved` rather than the factory body: `define` above has
        // run by then, so the list is complete.
        configResolved() {
          if (command !== 'build' || !emptyPublicValues.length) return;
          console.warn(
            `[citeladder] Building with empty public values: ${emptyPublicValues.join(', ')}. ` +
              'They are baked in at build time, so this image will behave as if they are unset.',
          );
        },
      },
    ],
    define: {
      'process.env.NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS': publicValue(
        'NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS',
      ),
      'process.env.NEXT_PUBLIC_BOOTSTRAP_READ_TIMEOUT_MS': publicValue(
        'NEXT_PUBLIC_BOOTSTRAP_READ_TIMEOUT_MS',
      ),
      'process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE': publicValue(
        'NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE',
      ),
    },
    resolve: {
      alias: {
        '@': frontendRoot,
      },
    },
    css: {
      postcss: frontendRoot,
    },
    server: {
      host: '127.0.0.1',
      port: 3001,
      strictPort: true,
      fs: {
        strict: true,
        allow: [frontendRoot],
      },
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 3001,
      strictPort: true,
      proxy,
    },
    build: {
      assetsDir: 'app-assets',
      outDir: fileURLToPath(new URL('./dist', import.meta.url)),
      emptyOutDir: true,
      // `scripts/check-bundle-budget.mjs` reads this to compute the EAGER set:
      // the entry plus its transitive static imports. That is the number a cold
      // load actually pays, and the one that regresses silently.
      manifest: true,
      // The support matrix `package.json` already declares. Without this the
      // build used Vite's own default and the browserslist was decorative —
      // the two could disagree and nothing would say so.
      target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
      rolldownOptions: {
        output: {
          // Cache stability, not size. These three change on their own release
          // schedule and nothing here changes them, but they were sharing a
          // chunk with application code — so editing anything under `lib/api`
          // invalidated React Router for every returning reader.
          //
          // Deliberately only three. More chunks means more requests on a cold
          // SPA boot, which is the thing this is trying to protect.
          advancedChunks: {
            groups: [
              { name: 'vendor-react', test: /node_modules\/(react|react-dom|scheduler)\// },
              { name: 'vendor-router', test: /node_modules\/react-router/ },
              { name: 'vendor-zod', test: /node_modules\/zod\// },
            ],
          },
        },
      },
    },
  };
});
