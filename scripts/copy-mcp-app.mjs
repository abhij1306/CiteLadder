#!/usr/bin/env node
// Places the built MCP Apps view where the API serves it from.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'frontend');
const target = join(frontend, 'services/api/assets/mcp-app/v1');
mkdirSync(target, { recursive: true });
copyFileSync(
  join(frontend, 'packages/mcp-app/dist/analytics.html'),
  join(target, 'analytics.html'),
);
