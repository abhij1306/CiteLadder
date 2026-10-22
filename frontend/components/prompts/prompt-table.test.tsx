import { describe, expect, it, vi } from 'vite-plus/test';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { Prompt, Topic } from '@/lib/api/types';

import { PromptTable } from './prompt-table';

function makePrompt(n: number, overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    prompt_set_id: '11111111-1111-4111-8111-111111111111',
    text: `Prompt number ${n}`,
    theme: 'Comfort',
    intent: 'discovery',
    branded: false,
    enabled: true,
    status: 'active',
    origin: 'manual',
    ...overrides,
  } as Prompt;
}

const TOPICS = [{ id: '22222222-2222-4222-8222-222222222222', name: 'Running shoes' }] as Topic[];

function renderTable(prompts: Prompt[]) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <PromptTable
          prompts={prompts}
          topics={TOPICS}
          onEdit={() => {}}
          onDelete={() => {}}
          onToggleEnabled={() => {}}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('PromptTable pagination', () => {
  it('captions each question with its topic, branding, intent and buyer stage', () => {
    renderTable([
      makePrompt(1, { branded: true, buyer_stage: 'consideration' }),
      makePrompt(2, { intent: '', buyer_stage: '' }),
    ]);

    const [, tagged, untagged] = screen.getAllByRole('row');
    expect(within(tagged!).getAllByRole('cell')[0]!.textContent).toBe(
      'Prompt number 1No topic · Branded · Discovery · Consideration',
    );
    expect(within(untagged!).getAllByRole('cell')[0]!.textContent).toBe(
      'Prompt number 2No topic · Unbranded',
    );
  });

  it('carries the whole question in a tooltip when the row cuts it', async () => {
    // jsdom lays nothing out; report the question as wider than its line.
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1000);
    renderTable([makePrompt(1)]);

    await userEvent.setup().tab();
    expect(screen.getByRole('link', { name: 'Prompt number 1' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Prompt number 1');
    scrollWidth.mockRestore();
  });

  it('opens each question on its history and shows its measured rates', () => {
    const prompt = makePrompt(7);
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable
            prompts={[prompt]}
            topics={TOPICS}
            onEdit={() => {}}
            onDelete={() => {}}
            onToggleEnabled={() => {}}
            measurements={
              new Map([
                [
                  prompt.id,
                  { visibilityRate: 0.5, ownedCitationRate: 0.25, change: null, position: null },
                ],
              ])
            }
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /Prompt number 7/ })).toHaveAttribute(
      'href',
      '/prompts/00000000-0000-4000-8000-000000000007',
    );
    const [header, row] = screen.getAllByRole('row');
    const columns = within(header!)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    const cells = within(row!)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells[columns.indexOf('Visibility')]).toBe('50%');
    expect(cells[columns.indexOf('Owned citations')]).toBe('25%');
  });

  it('names each row by its topic rather than its internal theme', () => {
    renderTable([
      makePrompt(1, { topic_id: TOPICS[0]!.id }),
      makePrompt(2, { topic_id: null }),
      makePrompt(3, { topic_id: '33333333-3333-4333-8333-333333333333' }),
    ]);

    const [, filed, unassigned, unresolved] = screen.getAllByRole('row');
    expect(within(unresolved!).getAllByRole('cell')[0]!.textContent).toBe(
      'Prompt number 3Topic unavailable · Unbranded · Discovery',
    );
    expect(within(filed!).getAllByRole('cell')[0]!.textContent).toBe(
      'Prompt number 1Running shoes · Unbranded · Discovery',
    );
    expect(within(unassigned!).getAllByRole('cell')[0]!.textContent).toBe(
      'Prompt number 2No topic · Unbranded · Discovery',
    );
  });

  it('pages through rows with the page indicator and ghost buttons', async () => {
    const user = userEvent.setup();
    const prompts = Array.from({ length: 12 }, (_, i) => makePrompt(i + 1));
    renderTable(prompts);

    const table = screen.getByRole('table');
    // Page 1 shows the first 10 rows with the mono page indicator.
    expect(within(table).getByText('Prompt number 1')).toBeInTheDocument();
    expect(within(table).queryByText('Prompt number 11')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'SPAN' &&
          el.textContent?.replace(/\s+/g, ' ').trim() === '1–10 of 12 prompts',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(within(table).queryByText('Prompt number 1')).not.toBeInTheDocument();
    expect(within(table).getByText('Prompt number 11')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'SPAN' &&
          el.textContent?.replace(/\s+/g, ' ').trim() === '11–12 of 12 prompts',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(within(table).getByText('Prompt number 1')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'SPAN' &&
          el.textContent?.replace(/\s+/g, ' ').trim() === '1–10 of 12 prompts',
      ),
    ).toBeInTheDocument();
  });

  it('clamps the current page when the list shrinks instead of resetting', async () => {
    const user = userEvent.setup();
    const prompts = Array.from({ length: 12 }, (_, i) => makePrompt(i + 1));
    const { rerender } = render(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable
            prompts={prompts}
            topics={TOPICS}
            onEdit={() => {}}
            onDelete={() => {}}
            onToggleEnabled={() => {}}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'SPAN' &&
          el.textContent?.replace(/\s+/g, ' ').trim() === '11–12 of 12 prompts',
      ),
    ).toBeInTheDocument();

    // A refetch/filter shrinking the list clamps the page into range.
    rerender(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable
            prompts={prompts.slice(0, 5)}
            topics={TOPICS}
            onEdit={() => {}}
            onDelete={() => {}}
            onToggleEnabled={() => {}}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'SPAN' &&
          el.textContent?.replace(/\s+/g, ' ').trim() === '1–5 of 5 prompts',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('keeps row actions wired on paginated rows', async () => {
    const user = userEvent.setup();
    const onToggleEnabled = vi.fn();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable
            prompts={[makePrompt(1)]}
            topics={TOPICS}
            onEdit={() => {}}
            onDelete={() => {}}
            onToggleEnabled={onToggleEnabled}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('switch', { name: 'Disable prompt' }));
    expect(onToggleEnabled).toHaveBeenCalledTimes(1);
  });
});
