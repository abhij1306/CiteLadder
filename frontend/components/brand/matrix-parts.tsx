import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { Visibility } from '@citeladder/contracts';
import type { MatrixAxes, MatrixDimension } from '@citeladder/contracts/visibility-matrix';
import { BrandMark } from '@/components/ui/brand-mark';
import { AxisItemLabel } from '@/components/ui/heat-table';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { YouTag } from '@/components/ui/table';
import { useEngineCatalog } from '@/lib/providers/engines';

const AXIS_LIMIT = 10;
const UNCOUNTED_AXIS = 5;

export function pendingAxisLength(selected: Visibility, dimension: MatrixDimension): number {
  return Math.min(AXIS_LIMIT, Math.max(1, countedAxisLength(selected, dimension)));
}

function countedAxisLength(selected: Visibility, dimension: MatrixDimension): number {
  if (dimension === 'engine') return selected.per_engine.length;
  if (dimension === 'brand') return selected.rankings.length;
  return UNCOUNTED_AXIS;
}

export function matrixBodyState(
  query: UseQueryResult<unknown>,
  what: string,
  pending: ReactNode,
): ReactNode {
  if (query.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title={`Couldn't load the ${what}`}
        fallback="The request failed or timed out."
      />
    );
  if (query.isPending) return pending;
  return null;
}

export function useAxisText() {
  const { label: engineLabel } = useEngineCatalog();
  return (axes: MatrixAxes, dimension: MatrixDimension): string[] => {
    switch (dimension) {
      case 'engine':
        return axes.engine.map((item) => engineLabel(item.logical_engine));
      case 'topic':
        return axes.topic.map((item) => item.name);
      case 'market':
        return axes.market.map((item) => item.label);
      case 'brand':
        return axes.brand.map((item) => item.name);
      default: {
        const _exhaustive: never = dimension;
        return _exhaustive;
      }
    }
  };
}

export function AxisLabel({
  axes,
  dimension,
  index,
  text,
}: Readonly<{ axes: MatrixAxes; dimension: MatrixDimension; index: number; text: string }>) {
  if (dimension === 'brand') {
    const brand = axes.brand[index];
    return (
      <AxisItemLabel
        text={text}
        lead={
          <BrandMark
            name={text}
            logoUrl={brand?.logo_url}
            websiteUrl={brand?.website_url}
            placement="inline"
          />
        }
        trail={brand?.is_brand ? <YouTag /> : null}
      />
    );
  }
  const renamed = dimension === 'topic' ? axes.topic[index]?.renamed_from : null;
  return (
    <AxisItemLabel
      text={text}
      note={
        renamed
          ? {
              label: '· renamed',
              tip: `Renamed from ${renamed}; this run keeps the topic it asked under.`,
            }
          : undefined
      }
    />
  );
}
