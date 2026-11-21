import { describe, expect, it, vi } from 'vite-plus/test';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

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

const NO_OP_ACTIONS = {
  onEdit: () => {},
  onDelete: () => {},
  onToggleEnabled: () => {},
  onSetStatus: () => {},
};

function Pathname() {
  return <output data-testid="pathname">{useLocation().pathname}</output>;
}

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
  it('says a Commerce prompt has no per-prompt figures while a brand prompt shows its own', () => {
    const COMMERCE_SET = '44444444-4444-4444-8444-444444444444';
    const brandPrompt = makePrompt(1);
    const shelfPrompt = makePrompt(2, { prompt_set_id: COMMERCE_SET });
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable
            prompts={[brandPrompt, shelfPrompt]}
            commerceSetIds={new Set([COMMERCE_SET])}
            measurements={
              new Map([
                [
                  brandPrompt.id,
                  {
                    visibilityRate: 0.5,
                    ownedCitationRate: 0.25,
                    change: { kind: 'first' },
                    position: 2,
                    shareOfVoice: null,
                    sentiment: null,
                    answer: ANSWER,
                    mentions: 0,
                    brands: [],
                    named: [],
                    sources: [],
                  },
                ],
              ])
            }
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    const [, brandRow, shelfRow] = screen.getAllByRole('row');
    expect(within(brandRow!).getAllByRole('cell')[2]!.textContent).toBe('50.0%');
    const shelfCells = within(shelfRow!).getAllByRole('cell');
    expect(shelfCells[2]!.textContent).toBe('—Measured with Shopping');
    expect(shelfRow!.querySelectorAll('[data-absence="not_applicable"]')).toHaveLength(7);
    expect(shelfCells).toHaveLength(within(brandRow!).getAllByRole('cell').length);
    expect(within(shelfRow!).queryByText('Not measured')).toBeNull();
  });

  it('shows each question with its topic, captioning only a prompt that audits skip', () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable
            prompts={[
              makePrompt(1, { branded: true, buyer_stage: 'consideration', topic_id: TOPIC_ID }),
              makePrompt(2, { over_plan_limit: true }),
              makePrompt(3, { topic_id: '55555555-5555-4555-8555-555555555555' }),
            ]}
            topicNames={new Map([[TOPIC_ID, 'Espresso at home']])}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    const [, filed, overLimit, unknownTopic] = screen.getAllByRole('row');
    const cells = (row: HTMLElement | undefined) =>
      within(row!)
        .getAllByRole('cell')
        .slice(0, 2)
        .map((cell) => cell.textContent);
    expect(cells(filed)).toEqual(['Prompt number 1', 'Espresso at home']);
    expect(cells(overLimit)).toEqual(['Prompt number 2Beyond the plan limit', '—No topic']);
    expect(
      within(overLimit!).getAllByRole('cell')[1]!.querySelector('[data-absence]'),
    ).toHaveAttribute('data-absence', 'none');
    expect(
      within(unknownTopic!).getAllByRole('cell')[1]!.querySelector('[data-absence]'),
    ).toHaveAttribute('data-absence', 'unavailable');
  });

  it('carries the whole question in a tooltip when the row cuts it', async () => {
    // jsdom lays nothing out; report the question as wider than its line and
    // the table as fitting its frame, so the frame takes no tab stop.
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute('data-scroll-content') ? 0 : 1000;
      });
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
                    change: { kind: 'first' },
                    position: 2,
                    shareOfVoice: 0.4,
                    sentiment: {
                      mentions: 31,
                      classified: 30,
                      positive: 20,
                      negative: 5,
                      net_sentiment: 50,
                    },
                    answer: ANSWER,
                    mentions: 4,
                    brands: [
                      brand('Acme', 'brand'),
                      brand('Globex', 'competitor'),
                      brand('Initech', 'competitor'),
                    ],
                    named: [],
                    sources: [],
                  },
                ],
                [
                  unnamed.id,
                  {
                    visibilityRate: 0,
                    ownedCitationRate: 0,
                    change: { kind: 'not_compared', reason: 'changed_context' },
                    position: null,
                    shareOfVoice: 0,
                    sentiment: {
                      mentions: 6,
                      classified: 4,
                      positive: 2,
                      negative: 2,
                      net_sentiment: 0,
                    },
                    answer: ANSWER,
                    mentions: 0,
                    brands: [],
                    named: [],
                    sources: [],
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
    expect(columns).toEqual([
      'Prompt',
      'Topic',
      'Visibility',
      'Change',
      expect.stringMatching(/^Mentions/),
      expect.stringMatching(/^Citations/),
      expect.stringMatching(/^Sources/),
      expect.stringMatching(/^Position/),
      expect.stringMatching(/^Share of voice/),
      expect.stringMatching(/^Sentiment/),
      'Actions',
    ]);
    const cells = within(row!).getAllByRole('cell');
    const unnamedCells = within(unnamedRow!).getAllByRole('cell');
    expect([2, 8, 9].map((index) => cells[index]!.textContent)).toEqual(['50.0%', '40.0%', '+50']);
    expect(unnamedCells.slice(7, 10).map((cell) => cell.textContent)).toEqual([
      '—Not named',
      '0.0%',
      '—Too few',
    ]);
    expect(cells[7]!.textContent).toBe('2.0');
    expect(cells[4]).toHaveTextContent('AcmeAGlobexGInitechI+1 more');
    expect(cells[5]!.textContent).toBe('25.0%');
    expect(unnamedCells[4]!.textContent).toBe('—None');
    expect(cells[3]!.querySelector('[data-absence]')).toHaveAttribute(
      'data-absence',
      'not_applicable',
    );
    expect(unnamedCells[3]!.querySelector('[data-absence]')).toHaveAttribute(
      'data-absence',
      'unavailable',
    );
  });

  it('pages through rows with the page indicator and ghost buttons', async () => {
    const user = userEvent.setup();
    const prompts = Array.from({ length: 12 }, (_, i) => makePrompt(i + 1));
    const view = renderTable(prompts);

    const table = screen.getByRole('table');
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
    expect(window.location.search).toBe('?page=2');
    view.unmount();
    renderTable(prompts);
    const reloaded = screen.getByRole('table');
    expect(within(reloaded).getByText('Prompt number 11')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(window.location.search).toBe('');
    expect(within(reloaded).getByText('Prompt number 1')).toBeInTheDocument();
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

    rerender(
      <MemoryRouter>
        <TooltipProvider>
          <PromptTable prompts={prompts.slice(0, 5)} actions={NO_OP_ACTIONS} />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Prompt number 1')).toBeInTheDocument();
    expect(screen.getByText('Prompt number 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('opens the prompt from a click on its row, but not from the row controls', async () => {
    const user = userEvent.setup();
    const onToggleEnabled = vi.fn();
    const selection = {
      ids: new Set<string>(),
      selected: [],
      toggle: vi.fn(),
      togglePage: vi.fn(),
      clear: vi.fn(),
    };
    const prompt = makePrompt(1);
    render(
      <MemoryRouter initialEntries={['/prompts']}>
        <TooltipProvider>
          <PromptTable
            prompts={[prompt]}
            actions={{ ...NO_OP_ACTIONS, onToggleEnabled }}
            selection={selection}
          />
          <Pathname />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const path = () => screen.getByTestId('pathname').textContent;

    await user.click(screen.getByRole('checkbox', { name: 'Select “Prompt number 1”' }));
    await user.click(screen.getByRole('button', { name: 'Prompt actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Disable' }));
    expect([path(), selection.toggle.mock.calls.length, onToggleEnabled.mock.calls.length]).toEqual(
      ['/prompts', 1, 1],
    );

    await user.click(screen.getByText('No topic'));
    expect(path()).toBe(`/prompts/${prompt.id}`);
  });

  it("opens a measured prompt's latest answer from its row or its question, and stays on the page", async () => {
    const user = userEvent.setup();
    const onOpenAnswer = vi.fn();
    const measured = makePrompt(1);
    const unmeasured = makePrompt(2);
    const measurement = {
      visibilityRate: 0.5,
      ownedCitationRate: 0,
      change: { kind: 'first' },
      position: null,
      shareOfVoice: null,
      sentiment: null,
      answer: ANSWER,
      mentions: 0,
      brands: [],
      named: [],
      sources: [],
    } as const;
    render(
      <MemoryRouter initialEntries={['/prompts']}>
        <TooltipProvider>
          <PromptTable
            prompts={[measured, unmeasured]}
            onOpenAnswer={onOpenAnswer}
            measurements={new Map([[measured.id, measurement]])}
          />
          <Pathname />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const [, row] = screen.getAllByRole('row');

    await user.click(within(row!).getByText('50.0%'));
    const question = screen.getByRole('link', { name: 'Prompt number 1' });
    expect(question).toHaveAttribute('href', `/prompts/${measured.id}`);
    await user.click(question);
    expect(onOpenAnswer.mock.calls).toEqual([
      [measured, ANSWER],
      [measured, ANSWER],
    ]);
    expect(screen.getByTestId('pathname').textContent).toBe('/prompts');
    expect(screen.getByRole('link', { name: 'Prompt number 2' })).toHaveAttribute(
      'href',
      `/prompts/${unmeasured.id}`,
    );
  });
});
