import { describe, expect, it, vi } from 'vite-plus/test';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { Prompt } from '@citeladder/contracts';

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

const TOPIC_ID = '22222222-2222-4222-8222-222222222222';

const ANSWER = { auditId: '33333333-3333-4333-8333-333333333333', promptIndex: 0 };

const NO_OP_ACTIONS = { onEdit: () => {}, onDelete: () => {}, onToggleEnabled: () => {} };

function renderTable(prompts: Prompt[]) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <PromptTable prompts={prompts} actions={NO_OP_ACTIONS} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('PromptTable pagination', () => {
  it('shows each question without tags', () => {
    renderTable([
      makePrompt(1, { branded: true, buyer_stage: 'consideration', topic_id: TOPIC_ID }),
    ]);

    const [, measured] = screen.getAllByRole('row');
    expect(within(measured!).getAllByRole('cell')[0]!.textContent).toBe('Prompt number 1');
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

  it('opens each question on its history and shows its measured rates and named brands', () => {
    const prompt = makePrompt(7);
    const unnamed = makePrompt(8);
    const brand = (name: string, kind: 'brand' | 'competitor') => ({
      kind,
      name,
      responses: 1,
      logo_url: null,
      website: null,
    });
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable
            prompts={[prompt, unnamed]}
            actions={NO_OP_ACTIONS}
            measurements={
              new Map([
                [
                  prompt.id,
                  {
                    visibilityRate: 0.5,
                    ownedCitationRate: 0.25,
                    change: null,
                    position: 2,
                    answer: ANSWER,
                    mentions: 4,
                    brands: [
                      brand('Acme', 'brand'),
                      brand('Globex', 'competitor'),
                      brand('Initech', 'competitor'),
                    ],
                  },
                ],
                [
                  unnamed.id,
                  {
                    visibilityRate: 0,
                    ownedCitationRate: 0,
                    change: null,
                    position: null,
                    answer: ANSWER,
                    mentions: 0,
                    brands: [],
                  },
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
    const [header, row, unnamedRow] = screen.getAllByRole('row');
    const columns = within(header!)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(columns.slice(0, 6)).toEqual([
      'Prompt',
      'Visibility',
      expect.stringMatching(/^Mentions/),
      expect.stringMatching(/^Citations/),
      expect.stringMatching(/^Position/),
      'Change',
    ]);
    const cells = within(row!).getAllByRole('cell');
    expect(cells[1]!.textContent).toBe('50%');
    // Three marks, each named for a screen reader, then the fourth as overflow.
    expect(cells[2]).toHaveTextContent('AcmeAGlobexGInitechI+1 more');
    expect(cells[3]!.textContent).toBe('25%');
    expect(cells[4]!.textContent).toBe('#2');
    // Measured, and no brand named: zero, not the "not measured" mark.
    expect(within(unnamedRow!).getAllByRole('cell')[2]!.textContent).toBe('None');
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
          el?.tagName === 'OUTPUT' &&
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
          el?.tagName === 'OUTPUT' &&
          el.textContent?.replace(/\s+/g, ' ').trim() === '11–12 of 12 prompts',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(within(table).getByText('Prompt number 1')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'OUTPUT' &&
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
          <PromptTable prompts={prompts} actions={NO_OP_ACTIONS} />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'OUTPUT' &&
          el.textContent?.replace(/\s+/g, ' ').trim() === '11–12 of 12 prompts',
      ),
    ).toBeInTheDocument();

    // A refetch/filter shrinking the list clamps the page into range.
    rerender(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable prompts={prompts.slice(0, 5)} actions={NO_OP_ACTIONS} />
        </TooltipProvider>
      </MemoryRouter>,
    );
    // Five prompts fit on one page, so the table shows them with no pager.
    expect(screen.getByText('Prompt number 1')).toBeInTheDocument();
    expect(screen.getByText('Prompt number 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('states the enabled state without offering a control when the reader may not edit', () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable prompts={[makePrompt(1), makePrompt(2, { enabled: false })]} />
        </TooltipProvider>
      </MemoryRouter>,
    );

    const [, first, second] = screen.getAllByRole('row');
    expect(
      within(first!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Prompt number 1', 'Yes']);
    expect(within(second!).getAllByRole('cell')[1]!.textContent).toBe('No');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prompt actions' })).toBeNull();
  });

  it('keeps row actions wired on paginated rows', async () => {
    const user = userEvent.setup();
    const onToggleEnabled = vi.fn();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable prompts={[makePrompt(1)]} actions={{ ...NO_OP_ACTIONS, onToggleEnabled }} />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('switch', { name: 'Disable prompt' }));
    expect(onToggleEnabled).toHaveBeenCalledTimes(1);
  });
});
