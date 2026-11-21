/** Write a generated, formatted public template, or with `--check` fail when the committed one is stale. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { format } from 'vite-plus/fmt';
import { fmtConfig } from '../../../vp-shared-config.ts';

const directory = new URL('../../../public/templates/', import.meta.url);

export async function writeTemplate(name: string, source: string, command: string) {
  const path = new URL(name, directory);
  const { ignorePatterns: _ignored, ...formatOptions } = fmtConfig;
  const formatted = await format(path.pathname, source, formatOptions);
  if (formatted.errors.length) throw new Error(`${name} does not parse`);
  const contents = formatted.code;
  if (process.argv.includes('--check')) {
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current !== contents)
      throw new Error(`${name} is stale; run pnpm --filter @citeladder/api ${command}`);
  } else {
    await mkdir(directory, { recursive: true });
    await writeFile(path, contents);
  }
}
