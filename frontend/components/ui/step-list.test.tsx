import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { StepList } from './step-list';

describe('StepList', () => {
  it('names the list and speaks each step with its status word', () => {
    render(
      <StepList
        label="Prompt run"
        steps={[
          { id: 'queue', label: 'Queue prompts', status: 'done', time: '0:04' },
          { id: 'ask', label: 'Ask engines', status: 'running', detail: '84 of 120 answers' },
          { id: 'score', label: 'Score answers', status: 'pending' },
        ]}
      />,
    );

    const list = screen.getByRole('list', { name: 'Prompt run' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Queue prompts, Done0:04',
      'Ask engines, Running84 of 120 answers',
      'Score answers, Waiting',
    ]);
  });

  it('marks only the running step as the current one', () => {
    render(
      <StepList
        label="Crawl"
        steps={[
          { label: 'Fetch robots.txt', status: 'done' },
          { label: 'Read pages', status: 'running' },
          { label: 'Check links', status: 'pending' },
        ]}
      />,
    );

    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent(
      'Read pages, Running',
    );
    expect(screen.getAllByRole('listitem', { current: false })).toHaveLength(2);
  });

  it('keeps a failed step with its cause after the run moves on', () => {
    render(
      <StepList
        label="Import"
        steps={[
          {
            label: 'Read the file',
            status: 'failed',
            detail: 'Row 12 has no prompt. Fix it and import again.',
          },
          { label: 'Save prompts', status: 'running' },
        ]}
      />,
    );

    const failed = screen.getAllByRole('listitem')[0];
    expect(failed).toHaveTextContent('Read the file, Failed');
    expect(failed).toHaveTextContent('Row 12 has no prompt. Fix it and import again.');
    expect(failed).not.toHaveAttribute('aria-current');
  });
});
