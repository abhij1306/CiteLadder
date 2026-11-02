'use client';

import type { ReactElement } from 'react';
import { ResponsiveContainer } from 'recharts';

/**
 * The Recharts side of `ChartContainer`: one chart element sized to the box
 * the container already holds. Only lazy plot modules import this, so Recharts
 * stays out of every screen's own download.
 */
export function ChartPlot({ children }: Readonly<{ children: ReactElement }>) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {children}
    </ResponsiveContainer>
  );
}
