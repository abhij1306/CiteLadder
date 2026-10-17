import { useQuery } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { VisibilityEvidenceResponse } from '@/lib/api/types';
import { ApiError } from '@/lib/api/errors';
import { visibilityApi } from '@/lib/api/visibility';
import { renderWithProviders } from '@/test/render';
import { FanoutEvidence } from './fanout-evidence';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const evidence: VisibilityEvidenceResponse = {
  truncated: false,
  items: [
    {
      audit_id: A,
      task_id: A,
      analysis_id: A,
      artifact_id: null,
      prompt_snapshot_id: A,
      prompt_id: null,
      prompt_index: 0,
      prompt_text: 'Best CRM?',
      repetition: 1,
      completed_at: '2026-01-15T00:00:00Z',
      logical_engine: 'chatgpt',
      transport_provider: 'openai',
      transport_model: 'gpt-4',
      retrieval_enabled: true,
      search_used: true,
      search_query_count: 1,
      query_text_available: true,
      state: 'queries_available',
      event_source: 'raw_artifact',
      mentions: [],
      citations: [],
      search_events: [
        { sequence: 0, query: 'best crm', call_id: '', call_sequence: 0, query_sequence: 0 },
      ],
    },
  ],
};

function Panel({ projectId }: Readonly<{ projectId: string }>) {
  const query = useQuery({
    queryKey: ['test-evidence', projectId],
    queryFn: async () => evidence,
    initialData: evidence,
  });
  return (
    <FanoutEvidence
      query={query}
      projectId={projectId}
      runId={null}
      scope={{}}
      scopeReady
      scopeNarrowed={false}
      isFiltered={false}
      limit={100}
    />
  );
}

afterEach(() => vi.restoreAllMocks());

describe('Fanout evidence scope', () => {
  it('drops another project’s totals during a switch and after the new summary fails', async () => {
    let rejectNext!: (error: unknown) => void;
    vi.spyOn(visibilityApi, 'getFanoutSummary').mockImplementation((projectId) =>
      projectId === A
        ? Promise.resolve({
            event_count: 50,
            distinct_queries: 20,
            matched_queries: 20,
            coverage: {},
            next_cursor: null,
            total_answers: 50,
            answers: [],
            items: [],
          })
        : new Promise((_, reject) => {
            rejectNext = reject;
          }),
    );
    const view = renderWithProviders(<Panel projectId={A} />);
    expect(
      await screen.findByLabelText(
        '20 distinct searches and 50 total occurrences across the selected run set',
      ),
    ).toBeInTheDocument();
    view.rerender(<Panel projectId={B} />);
    expect(screen.queryByLabelText(/20 distinct searches/)).not.toBeInTheDocument();
    await act(async () => rejectNext(new ApiError('Access denied', 403, '')));
    expect(
      await screen.findByLabelText(
        '1 distinct searches and 1 total occurrences in the searches shown below',
      ),
    ).toBeInTheDocument();
  });
});
