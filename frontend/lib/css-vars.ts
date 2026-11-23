import type { CSSProperties } from 'react';

declare module 'react' {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}

export function cssVars(vars: Readonly<Record<`--${string}`, string | number>>): CSSProperties {
  return vars;
}
