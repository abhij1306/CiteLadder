import { useLayoutEffect, type ReactNode, type RefObject } from 'react';
import { cssVars } from '@/lib/css-vars';

import { LiveVerb, SkeletonBlock } from '@/components/ui/skeleton-block';
import { StateBlock, type StateBlockProps } from '@/components/ui/state-block';
import { TableBody, TableCell } from '@/components/ui/table';

export type DataTableState = Exclude<StateBlockProps, { inline: true }>;

export type DataTableInlineEmpty = Extract<StateBlockProps, { inline: true }>;

export function DataTableBody({
  cells,
  colSpan,
  state,
  pageSize,
  rowCount,
  reserve,
  children,
}: Readonly<{
  cells: number;
  colSpan: number;
  state?: DataTableState | DataTableInlineEmpty;
  pageSize?: number;
  rowCount?: number;
  reserve: boolean;
  children?: ReactNode;
}>) {
  if (state?.kind === 'loading') {
    return (
      <LoadingBody
        columns={cells}
        label={state.label ?? 'Loading…'}
        rows={pageSize ?? LOADING_ROWS}
      />
    );
  }
  if (state) {
    return (
      <TableBody>
        <tr data-table-state="">
          <TableCell
            colSpan={colSpan}
            className="h-[calc(var(--data-table-rows)*var(--table-row-height))] align-top"
            style={footprint(pageSize ?? 0)}
          >
            <InFrame>
              <StateBlock {...state} />
            </InFrame>
          </TableCell>
        </tr>
      </TableBody>
    );
  }
  const rest =
    reserve && pageSize !== undefined && rowCount !== undefined ? pageSize - rowCount : 0;
  return (
    <>
      <TableBody>{children}</TableBody>
      {rest > 0 ? (
        <TableBody>
          <tr // NOSONAR
            aria-hidden="true"
            data-table-spacer=""
            style={footprint(rest)}
          >
            <TableCell
              colSpan={colSpan}
              className="h-[calc(var(--data-table-rows)*var(--table-row-height))]"
            />
          </tr>
        </TableBody>
      ) : null}
    </>
  );
}

function LoadingBody({
  columns,
  label,
  rows,
}: Readonly<{ columns: number; label: string; rows: number }>) {
  const cells = Array.from({ length: columns }, (_, index) => index);
  return (
    <TableBody aria-busy="true">
      {Array.from({ length: rows }, (_, row) => (
        <tr
          key={row}
          aria-hidden={row === 0 ? undefined : true}
          data-table-loading=""
          className="h-[var(--table-row-height)]"
        >
          {cells.map((cell) => (
            <td key={cell} className="px-[var(--table-cell-padding-x)]">
              {row === 0 && cell === 0 ? <LiveVerb label={label} /> : null}
              <SkeletonBlock className="h-3 w-3/4" />
            </td>
          ))}
        </tr>
      ))}
    </TableBody>
  );
}

function InFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="sticky start-[var(--table-cell-padding-x)] w-[calc(100cqi-2*var(--table-cell-padding-x))]">
      {children}
    </div>
  );
}

const footprint = (rows: number) => cssVars({ '--data-table-rows': rows });

const LOADING_ROWS = 5;

export function usePinnedPadding(ref: RefObject<HTMLElement | null>, pinned: number) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || pinned === 0 || typeof ResizeObserver === 'undefined') return;
    const heads = [...node.querySelectorAll(':scope > table > thead > tr > *')].slice(0, pinned);
    const update = () => {
      const width = heads.reduce((sum, head) => sum + head.getBoundingClientRect().width, 0);
      node.style.scrollPaddingInlineStart = `${width}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    for (const head of heads) observer.observe(head);
    return () => observer.disconnect();
  }, [ref, pinned]);
}
