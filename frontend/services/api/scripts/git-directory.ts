import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function gitDirectory(from: string): string {
  for (let directory = resolve(from); ; directory = dirname(directory)) {
    const marker = join(directory, '.git');
    if (existsSync(marker)) {
      if (statSync(marker).isDirectory()) return marker;
      const pointer = readFileSync(marker, 'utf8')
        .split('\n')
        .find((line) => line.startsWith('gitdir:'));
      if (pointer !== undefined) return resolve(directory, pointer.slice('gitdir:'.length).trim());
    }
    if (dirname(directory) === directory) throw new Error('Run the eval inside the repository');
  }
}
