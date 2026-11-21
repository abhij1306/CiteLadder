import { createElement } from 'react';
import { describe, expect, it } from 'vite-plus/test';
import { act } from '@testing-library/react';

import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

import { useVisibilityFilters, visibilityEvidenceHref } from './use-visibility-dashboard';

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
