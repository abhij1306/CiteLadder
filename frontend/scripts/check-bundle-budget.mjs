import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const FRONTEND = path.resolve(import.meta.dirname, '..');
const POLICY_PATH = path.join(FRONTEND, 'scripts', 'bundle-budget.json');
const POLICY_REPOSITORY_PATH = 'frontend/scripts/bundle-budget.json';

const TARGETS = {
  'apps/app': {
    dist: path.join(FRONTEND, 'apps', 'app', 'dist'),
    manifest: path.join(FRONTEND, 'apps', 'app', 'dist', '.vite', 'manifest.json'),
    buildCommand: 'pnpm build',
  },
};

function gzipSize(file) {
  return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
}

function eagerChunks(manifest) {
  const entries = Object.values(manifest).filter((chunk) => chunk.isEntry);
  if (entries.length === 0) throw new Error('manifest declares no entry chunk');
  const byFile = new Map(Object.values(manifest).map((chunk) => [chunk.file, chunk]));
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const chunk = queue.pop();
    if (!chunk || seen.has(chunk.file)) continue;
    seen.add(chunk.file);
    for (const key of chunk.imports ?? []) {
      const next = manifest[key] ?? byFile.get(key);
      if (next) queue.push(next);
    }
  }
  const css = new Set();
  for (const file of seen) {
    for (const sheet of byFile.get(file)?.css ?? []) css.add(sheet);
  }
  return { js: [...seen], css: [...css] };
}

function measure(dist, files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const absolute = path.join(dist, file);
    if (!fs.existsSync(absolute)) throw new Error(`manifest names a missing file: ${file}`);
    raw += fs.statSync(absolute).size;
    gzip += gzipSize(absolute);
  }
  return { raw, gzip };
}

function report(name, actual, limit) {
  const delta = actual - limit;
  const sign = delta > 0 ? '+' : '';
  return `${name.padEnd(16)} ${String(actual).padStart(9)}  limit ${String(limit).padStart(9)}  ${sign}${delta}`;
}

function main() {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  const failures = [];
  const lines = [];

  for (const [target, budget] of Object.entries(policy.budgets)) {
    const config = TARGETS[target];
    if (!config) {
      failures.push(`${POLICY_REPOSITORY_PATH} budgets an unknown target: ${target}`);
      continue;
    }
    if (!fs.existsSync(config.manifest)) {
      failures.push(`${target}: no build manifest. Run \`${config.buildCommand}\` first.`);
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(config.manifest, 'utf8'));
    const { js, css } = eagerChunks(manifest);
    const jsBytes = measure(config.dist, js);
    const cssBytes = measure(config.dist, css);

    lines.push(`${target}  (${js.length} eager js, ${css.length} eager css)`);
    const measured = {
      eager_js_raw: jsBytes.raw,
      eager_js_gzip: jsBytes.gzip,
      eager_css_raw: cssBytes.raw,
      eager_css_gzip: cssBytes.gzip,
    };
    for (const [key, value] of Object.entries(measured)) {
      const limit = budget[key];
      if (typeof limit !== 'number') {
        failures.push(
          `${target}: no numeric \`${key}\` budget in ${POLICY_REPOSITORY_PATH} (measured ${value} B).`,
        );
        continue;
      }
      lines.push(`  ${report(key, value, limit)}`);
      if (value > limit) {
        failures.push(
          `${target}: ${key} is ${value} B, over the ${limit} B budget by ${value - limit} B.`,
        );
      }
    }
  }

  console.log(lines.join('\n'));
  if (failures.length > 0) {
    const failureList = failures.map((line) => `  - ${line}`).join('\n');
    console.error(`\nBundle budget exceeded:\n${failureList}`);
    console.error(
      `\nShed the bytes, or raise the limit in ${POLICY_REPOSITORY_PATH} with a measurement in the PR saying what they buy.`,
    );
    process.exit(1);
  }
  console.log('\nBundle budget ok.');
}

main();
