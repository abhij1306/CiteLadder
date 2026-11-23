import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { AnswerLink } from './answer-link';

const RUN = '11111111-1111-4111-8111-111111111111';
const EXECUTION = '22222222-2222-4222-8222-222222222222';

function Where() {
  const location = useLocation();
  return <output aria-label="Location">{location.pathname + location.search}</output>;
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('AnswerLink', () => {
  it('opens the answer in place on a plain click and keeps the run page as its href', async () => {
    mswServer.use(
      http.get(`/api/v1/executions/${EXECUTION}`, () => new HttpResponse(null, { status: 404 })),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AnswerLink answer={{ run_id: RUN, execution_id: EXECUTION, prompt: 'best plumber' }}>
          “Fast and local”
        </AnswerLink>
        <Where />
      </>,
      { projectSelection: { activeProject: makeProject() }, initialEntries: ['/perception'] },
    );

    const link = screen.getByRole('link', { name: '“Fast and local”' });
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining(`/runs/${RUN}?execution=${EXECUTION}`),
    );
    await user.click(link);

    expect(await screen.findByRole('dialog', { name: 'best plumber' })).toBeVisible();
    expect(screen.getByLabelText('Location').textContent).toBe('/perception');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(link).toHaveFocus();
  });
});
