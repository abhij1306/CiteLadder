import { FilterBar } from '@/components/ui/filter-bar';
import { SkeletonFrame, TableBlocks } from '@/components/ui/skeleton-block';
import { FRAME_FACE } from '@/components/ui/slip';
import { cn } from '@/lib/utils';

export function ToolbarTableLoading({
  label,
  columns,
  rows,
  view = false,
}: Readonly<{ label: string; columns: number; rows?: number; view?: boolean }>) {
  return (
    <SkeletonFrame label={label} variant="table" className="grid min-w-0">
      <header className="grid min-w-0 pb-3">
        <FilterBar
          view={view ? <span className="block h-[var(--control-md)]" /> : undefined}
          search={<span />}
        />
      </header>
      <div
        data-loading-shape="table"
        className={cn(FRAME_FACE, 'skeleton-sweep grid min-w-0 overflow-hidden')}
      >
        <TableBlocks columns={columns} rows={rows} />
      </div>
    </SkeletonFrame>
  );
}
