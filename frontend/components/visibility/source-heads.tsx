'use client';

import { Pressable } from '@/components/ui/pressable';
import { TableHead } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The unsortable column header the source tables share; sortable columns use
 * `SortableTableHead`, whose `hint` carries the same kind of caveat.
 *
 * Beside the tables rather than inside them: both tables use it, and a header
 * is where a column's shared caveat is said -- once, instead of once per cell
 * that lacks a value.
 */

/**
 * A plain column label, with the column's own caveat behind a tooltip.
 *
 * The place a shared reason belongs. "Not every page has been read" is one
 * fact about the column, and printing it into every cell that lacks a value
 * says it twenty times to make the point once.
 */
export function HintedHead({
  label,
  hint,
  className,
}: Readonly<{ label: string; hint: string; className?: string }>) {
  return (
    <TableHead className={className}>
      <Tooltip content={hint}>
        <Pressable className="w-auto cursor-default">{label}</Pressable>
      </Tooltip>
    </TableHead>
  );
}
