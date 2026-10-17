import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { PromptGenerateResponse, Topic } from '@/lib/api/types';

import { GeneratePromptsDialog } from './generate-prompts-dialog';

const topic = (id: string, name: string, parent_id: string | null = null): Topic => ({
  id,
  project_id: 'project',
  parent_id,
  name,
  description: '',
  origin: 'manual',
  active_count: 0,
  created_at: '',
  updated_at: '',
});

const TOPICS = [
  topic('shoes', 'Running shoes'),
  topic('trail', 'Trail', 'shoes'),
  topic('sandals', 'Sandals'),
];

describe('GeneratePromptsDialog', () => {
  it('opens pending review without a competing generation form', async () => {
    render(
      <GeneratePromptsDialog
        open
        onOpenChange={vi.fn()}
        topics={TOPICS}
        onGenerate={vi.fn()}
        review={<p>Saved questions to review</p>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Review suggested questions' })).toBeVisible();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate more' }));
    expect(screen.getByRole('spinbutton', { name: 'Number of prompts' })).toBeVisible();
  });
  it('sends every selected topic, starting from the rail selection', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(
      <GeneratePromptsDialog
        open
        onOpenChange={vi.fn()}
        topics={TOPICS}
        defaultTopicId="shoes"
        onGenerate={onGenerate}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Running shoes' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Trail' }));
    await user.click(screen.getByRole('button', { name: /generate/i }));

    expect(onGenerate).toHaveBeenCalledWith({ count: 10, topic_ids: ['shoes', 'trail'] });
  });

  it('covers every topic when none is selected', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(
      <GeneratePromptsDialog open onOpenChange={vi.fn()} topics={TOPICS} onGenerate={onGenerate} />,
    );

    expect(screen.getByText(/suggestions cover every topic/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /generate/i }));

    expect(onGenerate).toHaveBeenCalledWith({ count: 10, topic_ids: [] });
  });

  it('explains a shortfall caused by the quality gate and admission checks', () => {
    const result: PromptGenerateResponse = {
      candidates: [],
      topics: [],
      requested_count: 3,
      dropped_duplicates: 0,
      candidates_generated: 6,
      quality_gate: 'gate',
      quality_rejected: 3,
      admission_drops: { off_topic: 2, duplicate: 1 },
      shortfall_reason: null,
    };
    render(
      <GeneratePromptsDialog
        open
        onOpenChange={vi.fn()}
        topics={TOPICS}
        onGenerate={vi.fn()}
        result={result}
      />,
    );

    const alert = screen.getByText(/removed by quality checks/i);
    expect(alert).toHaveTextContent('3 weak suggestions removed by quality checks');
    expect(alert.textContent).toMatch(/Not admitted: 2 unrelated/);
    expect(alert.textContent).not.toMatch(/add topics|already tracked/i);
  });

  it('says when drafting stopped at the time limit', () => {
    const result: PromptGenerateResponse = {
      candidates: [],
      topics: [],
      requested_count: 20,
      dropped_duplicates: 0,
      candidates_generated: 0,
      quality_gate: 'off',
      quality_rejected: 0,
      admission_drops: {},
      shortfall_reason: 'deadline',
    };
    render(
      <GeneratePromptsDialog
        open
        onOpenChange={vi.fn()}
        topics={TOPICS}
        onGenerate={vi.fn()}
        result={result}
      />,
    );

    expect(screen.getByRole('alert').textContent).toMatch(/stopped at the time limit/i);
  });
});
