import type { ReactNode } from 'react';

const MAX_TINT = 0.5;

export function HeatValue({ share, children }: Readonly<{ share: number; children: ReactNode }>) {
  return (
    <span className="rounded-mark relative inline-block px-2 py-0.5">
      <span
        aria-hidden
        className="bg-accent rounded-mark absolute inset-0"
        style={{ opacity: Math.min(1, Math.max(0, share)) * MAX_TINT }}
      />
      <span className="relative">{children}</span>
    </span>
  );
}
