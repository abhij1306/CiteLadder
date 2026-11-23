import { createElement } from 'react';
import { describe, expect, it } from 'vite-plus/test';
import { act } from '@testing-library/react';

import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

import {
  measuredSelection,
  useVisibilityFilters,
  visibilityEvidenceHref,
} from './use-visibility-dashboard';

describe('visibilityEvidenceHref', () => {
  it('keeps the shared selection, drops the Brand page and evidence keys, and applies the slice', () => {
    const href = visibilityEvidenceHref(
      '?market=m-1&cohort=all&run=old&brand=Globex&metric=sov&cursor=c1&prompt=p1',
      { run: 'r-2', engine: 'gemini', competitor: null },
    );
    expect(Object.fromEntries(new URL(href, 'https://x.test').searchParams)).toEqual({
      market: 'm-1',
      cohort: 'all',
      run: 'r-2',
      tab: 'query-fanout',
      engine: 'gemini',
    });
    expect(href.startsWith('/visibility?')).toBe(true);
  });
});

describe('useVisibilityFilters', () => {
  it('pools a period in one write that drops the run read before', () => {
    window.history.replaceState(null, '', '/brand?project=p-1&run=r-1&cursor=c1&engine=gemini');
    let filters: ReturnType<typeof useVisibilityFilters> | undefined;
    function Probe() {
      filters = useVisibilityFilters();
      return null;
    }
    const project = makeProject();
    renderWithProviders(createElement(Probe), {
      projectSelection: { activeProject: project, activeProjectId: project.id, status: 'ready' },
    });
    act(() => filters?.selectPeriod('all'));
    expect(window.location.search).toBe('?project=p-1&engine=gemini&selection=range&range=all');
  });
});

describe('measuredSelection', () => {
  it('falls back to a run when an unchosen default range holds none or a run is named', () => {
    const from = '2026-08-24T00:00:00.000Z';
    const before = [{ completedAt: '2026-08-01T09:00:00Z' }];
    const inside = [...before, { completedAt: '2026-11-01T09:00:00Z' }];
    const cases = [
      { chosen: null, namedRun: false, fallback: 'range', runs: undefined },
      { chosen: null, namedRun: false, fallback: 'range', runs: inside },
      { chosen: null, namedRun: false, fallback: 'range', runs: before },
      { chosen: null, namedRun: false, fallback: 'range', runs: [{ completedAt: null }] },
      { chosen: 'range', namedRun: false, fallback: 'range', runs: before },
      { chosen: null, namedRun: true, fallback: 'range', runs: inside },
      { chosen: null, namedRun: false, fallback: 'run', runs: inside },
    ] as const;
    expect(cases.map((input) => measuredSelection({ ...input, from, to: undefined }))).toEqual([
      'range',
      'range',
      'run',
      'run',
      'range',
      'run',
      'run',
    ]);
  });
});
