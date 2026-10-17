import { expect, it } from 'vite-plus/test';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SiteFactsPanel } from './site-facts-panel';
import { makeSiteCrawl, makeSiteFacts } from '@/test/fixtures/site-health';
import { parseAgentHandoff } from '@/lib/agent/handoff';

it('renders all policies and Not specified with accessible purpose tables and an agent handoff', async () => {
  const user = userEvent.setup();
  const crawl = makeSiteCrawl({ site_facts: makeSiteFacts() });
  render(
    <MemoryRouter>
      <SiteFactsPanel crawl={crawl} dashboard={undefined} />
    </MemoryRouter>,
  );
  // Closed by default: one summary line instead of the crawler rows.
  expect(screen.getByRole('table', { hidden: true })).not.toBeVisible();
  await user.click(
    screen.getByText('4 crawlers: 1 all allowed, 1 restricted, 1 all disallowed, 1 unknown'),
  );
  const training = screen.getByRole('table', { name: 'Crawler robots policy by purpose' });
  expect(within(training).getByRole('row', { name: /GPTBot/ })).toHaveTextContent('All disallowed');
  expect(within(training).getByRole('row', { name: /ClaudeBot/ })).toHaveTextContent('All allowed');
  expect(within(training).getByRole('row', { name: /Google-Extended/ })).toHaveTextContent(
    'Unknown',
  );
  const search = screen.getByRole('table', { name: 'Crawler robots policy by purpose' });
  const row = within(search).getByRole('row', { name: /PerplexityBot/ });
  expect(row).toHaveTextContent('Not specified');
  expect(row).toHaveTextContent('Restricted');
  expect(row).toHaveTextContent('1 of 4 known URLs disallowed');
  const href = screen.getByRole('link', { name: 'Ask agent' }).getAttribute('href')!;
  const url = new URL(href, 'https://example.test');
  expect(url.searchParams.get('project')).toBe(crawl.project_id);
  expect(parseAgentHandoff(url.searchParams).prompt).toContain(crawl.id);
  expect(parseAgentHandoff(url.searchParams).context.site_facts_reference).toEqual({
    crawl_id: crawl.id,
  });
  await user.click(screen.getByRole('combobox', { name: 'Filter crawlers by purpose' }));
  await user.click(screen.getByRole('option', { name: 'AI search' }));
  expect(screen.queryByRole('row', { name: /GPTBot/ })).not.toBeInTheDocument();
  expect(
    screen.getByRole('table', { name: 'Crawler robots policy by purpose' }),
  ).toBeInTheDocument();
});
it('keeps an unreadable robots file distinct from an absent panel', () => {
  const facts = makeSiteFacts();
  const robots = { ...facts.robots, fetched: false, status: 'access_blocked', status_code: 403 };
  const { rerender } = render(
    <MemoryRouter>
      <SiteFactsPanel
        crawl={makeSiteCrawl({ site_facts: { ...facts, robots } })}
        dashboard={undefined}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('robots.txt could not be read');
  rerender(
    <MemoryRouter>
      <SiteFactsPanel crawl={makeSiteCrawl({ site_facts: null })} dashboard={undefined} />
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole('heading', { name: 'AI crawler robots policy' }),
  ).not.toBeInTheDocument();
});
