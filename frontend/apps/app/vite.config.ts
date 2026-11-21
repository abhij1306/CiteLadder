import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type ViteUserConfig, loadEnv } from 'vite-plus';

import { RELEASE_META_NAME } from '../../lib/config/operational.ts';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const frontendRoot = fileURLToPath(new URL('../..', import.meta.url));

/** The build's commit, when CI names one; the reporter treats absence as `development`. */
function releaseId(): string {
  const value = process.env.PUBLIC_APP_RELEASE || process.env.GITHUB_SHA || '';
  return /^[\w.-]{1,64}$/u.test(value) ? value : '';
}

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
      {
        // The commit error reports name (lib/client-errors.ts), written into the
        // unhashed index.html rather than a script chunk: a value in a chunk would
        // change that chunk's hash, and the boot cache with it, on every deploy.
        name: 'citeladder:release-meta',
        transformIndexHtml() {
          const release = releaseId();
          return release
            ? [
                {
                  tag: 'meta',
                  attrs: { name: RELEASE_META_NAME, content: release },
                  injectTo: 'head',
                },
              ]
            : [];
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
      manifest: true,
      target: ['chrome123', 'edge123', 'firefox132', 'safari17.5'],
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'vendor-react',
                test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 30,
              },
              { name: 'vendor-router', test: /node_modules[\\/]react-router/, priority: 30 },
              { name: 'vendor-zod', test: /node_modules[\\/]zod[\\/]/, priority: 30 },
              { name: 'app-boot', tags: ['$initial'], priority: 20 },
              {
                name: 'ui',
                test: /\/components\/ui\//,
                minShareCount: 2,
                priority: 10,
                entriesAware: true,
                entriesAwareMergeThreshold: 2 * 1024,
              },
            ],
          },
        },
      },
    },
  };
});
