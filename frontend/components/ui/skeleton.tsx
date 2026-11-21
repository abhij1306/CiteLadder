import {
  FigureBlocks,
  ShapeBlocks,
  SkeletonBlock,
  SkeletonFrame,
  TableBlocks,
  TEXT_WIDTHS,
} from '@/components/ui/skeleton-block';
import type { ChartHeight } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

type SkeletonProps = Readonly<{
  label?: string;
  className?: string;
}> &
  (
    | Readonly<{ variant?: 'text'; lines?: 1 | 2 | 3 }>
    | Readonly<{ variant: 'table'; columns: number; rows?: number }>
    | Readonly<{ variant: 'stat'; count?: number }>
    | Readonly<{ variant: 'facts'; rows?: number }>
    | Readonly<{ variant: 'list'; rows?: number }>
    | Readonly<{ variant: 'chart'; height?: ChartHeight }>
  );

export function Skeleton(props: SkeletonProps) {
  return (
    <SkeletonFrame
      label={props.label ?? 'Loading'}
      variant={props.variant ?? 'text'}
      className={props.className}
    >
      <SkeletonBody {...props} />
    </SkeletonFrame>
  );
}

function SkeletonBody(props: SkeletonProps) {
  switch (props.variant) {
    case 'table':
      return <TableBlocks columns={props.columns} rows={props.rows} />;
    case 'stat':
      return <FigureBlocks count={props.count ?? 4} />;
    case 'facts':
      return <ShapeBlocks shape={{ kind: 'facts', rows: props.rows }} />;
    case 'list':
      return <ShapeBlocks shape={{ kind: 'list', rows: props.rows }} />;
    case 'chart':
      return <ShapeBlocks shape={{ kind: 'chart', height: props.height }} />;
    case 'text':
    case undefined:
      return <TextBlocks lines={props.lines} />;
    default: {
      const exhaustive: never = props;
      return exhaustive;
    }
  }
}

function TextBlocks({ lines = 3 }: Readonly<{ lines?: 1 | 2 | 3 }>) {
  return (
    <span className="grid gap-2">
      {TEXT_WIDTHS.slice(0, lines).map((width) => (
        <SkeletonBlock key={width} className={cn('h-4', width)} />
      ))}
    </span>
  );
}
