import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vite-plus/test';

import { usePerformanceSelection } from './use-performance-selection';

beforeEach(() => window.history.replaceState(null, '', '/performance'));

function open(search: string) {
  window.history.replaceState(null, '', `/performance${search}`);
  return renderHook(() => usePerformanceSelection());
}

const param = (key: string) => new URLSearchParams(window.location.search).get(key);

describe('usePerformanceSelection', () => {
  it.each([
    [
      '',
      { range: 'last_synced', from: '', to: '', compare: 'none', compareFrom: '', compareTo: '' },
      ['clicks', 'impressions'],
    ],
    [
      '?range=custom&from=2026-11-01&to=2026-13-45&compare=custom&compare_from=2025-02-29&compare_to=2024-02-29',
      {
        range: 'custom',
        from: '2026-11-01',
        to: '',
        compare: 'custom',
        compareFrom: '',
        compareTo: '2024-02-29',
      },
      ['clicks', 'impressions'],
    ],
    [
      '?range=forever&compare=never&metrics=position,bogus,ctr',
      { range: 'last_synced', from: '', to: '', compare: 'none', compareFrom: '', compareTo: '' },
      ['ctr', 'position'],
    ],
    [
      '?metrics=bogus',
      { range: 'last_synced', from: '', to: '', compare: 'none', compareFrom: '', compareTo: '' },
      ['clicks', 'impressions'],
    ],
  ])('reads %s as a valid selection', (search, selection, metrics) => {
    const { result } = open(search);
    expect(result.current.selection).toEqual(selection);
    expect([...result.current.activeMetrics]).toEqual(metrics);
  });

  it('writes metrics in card order, omits the landing pair and keeps the last metric', () => {
    const { result } = open('');
    act(() => result.current.toggleMetric('position'));
    act(() => result.current.toggleMetric('ctr'));
    expect(param('metrics')).toBe('clicks,impressions,ctr,position');

    act(() => result.current.toggleMetric('ctr'));
    act(() => result.current.toggleMetric('position'));
    expect(param('metrics')).toBeNull();

    act(() => result.current.toggleMetric('clicks'));
    act(() => result.current.toggleMetric('impressions'));
    expect([...result.current.activeMetrics]).toEqual(['impressions']);
    expect(param('metrics')).toBe('impressions');
  });

  it('writes a custom window and drops it again for a preset', () => {
    const { result } = open('?keep=1');
    act(() =>
      result.current.setSelection({
        range: 'custom',
        from: '2026-10-01',
        to: '2026-10-31',
        compare: 'none',
        compareFrom: '',
        compareTo: '',
      }),
    );
    expect(window.location.search).toBe('?keep=1&range=custom&from=2026-10-01&to=2026-10-31');

    act(() =>
      result.current.setSelection({
        range: 'last_synced',
        from: '',
        to: '',
        compare: 'none',
        compareFrom: '',
        compareTo: '',
      }),
    );
    expect(window.location.search).toBe('?keep=1');
  });

  it('resets every choice to the landing state and keeps unrelated parameters', () => {
    const { result } = open(
      '?keep=1&range=week&compare=previous&granularity=month&dimension=device&metrics=ctr',
    );
    expect([result.current.granularity, result.current.dimension]).toEqual(['month', 'device']);

    act(() => result.current.reset());

    expect(window.location.search).toBe('?keep=1');
    expect(result.current.selection.range).toBe('last_synced');
    expect(result.current.selection.compare).toBe('none');
    expect([result.current.granularity, result.current.dimension]).toEqual(['day', 'query']);
    expect([...result.current.activeMetrics]).toEqual(['clicks', 'impressions']);
  });
});
