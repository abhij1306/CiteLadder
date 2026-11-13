import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { screen, within } from '@testing-library/react';

import { mswServer } from '@/test/msw-server';
import { parseAgentHandoff } from '@/lib/agent/handoff';
import {
  CRAWL,
  ISSUE_A,
  IssuesCatalog,
  issue,
  issueDetail,
  occurrence,
  renderIssues,
  summary,
} from './issues-catalog.test-support';

/** The Issues screen with the form issue open, as a link to it opens it. */
const OPEN = `/issues?issue=${ISSUE_A}`;

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  window.history.replaceState(null, '', '/issues');
  mswServer.use(
    http.get(`/api/v1/site-crawls/${CRAWL}/issue-fixes`, () =>
      HttpResponse.json({ crawl_id: CRAWL, items: [] }),
    ),
  );
});
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('IssuesCatalog', () => {
  describe('pages that share one piece of evidence', () => {
    const FORM_RULE = 'web.accessibility_form_names';
    const formOccurrence = (index: number, control: Record<string, string>) =>
      occurrence({
        rule_id: FORM_RULE,
        occurrence_id: `dddddddd-${String(index).padStart(4, '0')}-4111-8111-111111111111`,
        site_url_id: `cccccccc-${String(index).padStart(4, '0')}-4111-8111-111111111111`,
        normalized_url: `https://acme.com/page-${index}`,
        display_url: `https://acme.com/page-${index}`,
        title: `Page ${index}`,
        evidence: { missing_control_descriptors: [{ ordinal: index, ...control }] },
      });
    const email = { tag: 'INPUT', name: 'email' };

    function serveFormIssue(detail: Record<string, unknown>) {
      mswServer.use(
        http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
          HttpResponse.json({
            items: [
              issue({
                rule_id: FORM_RULE,
                title: 'Form controls missing accessible names',
                affected_url_count: 3,
              }),
            ],
            next_cursor: null,
            summary,
          }),
        ),
        http.get(`/api/v1/site-crawls/${CRAWL}/issues/${ISSUE_A}`, () =>
          HttpResponse.json(issueDetail({ rule_id: FORM_RULE, ...detail })),
        ),
      );
    }

    it('says shared evidence once, with one question for every page that carries it', async () => {
      serveFormIssue({
        affected_url_count: 3,
        occurrences: [
          formOccurrence(1, email),
          formOccurrence(2, { tag: 'SELECT', id: 'country' }),
          formOccurrence(3, email),
        ],
      });

      renderIssues(<IssuesCatalog crawlId={CRAWL} />, OPEN);

      // The two pages differ only in the control's ordinal, which is not
      // shown, so they are one fix.
      expect(await screen.findAllByText('input[name="email"]')).toHaveLength(1);
      expect(screen.getByText('On 2 pages')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Page 1/ })).toHaveAttribute(
        'href',
        `/site/crawls/${CRAWL}/pages/cccccccc-0001-4111-8111-111111111111`,
      );
      expect(screen.getByRole('link', { name: /Page 3/ })).toBeInTheDocument();
      // The group's question names the issue, not one page of it.
      const shared = screen.getByRole('link', { name: 'Ask agent about these pages' });
      const handoff = parseAgentHandoff(
        new URL(shared.getAttribute('href')!, 'http://x').searchParams,
      );
      expect(handoff.context).toEqual({
        issue_group_reference: { crawl_id: CRAWL, group_id: ISSUE_A },
      });
      expect(handoff.prompt).toContain('input[name="email"]');
      // Evidence on one page only keeps that page's own row and question.
      expect(screen.getByText('select[id="country"]')).toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: 'Ask agent about this page' })).toHaveLength(1);
    });

    it('claims only the loaded pages while more pages of occurrences follow', async () => {
      serveFormIssue({
        affected_url_count: 179,
        occurrences: [formOccurrence(1, email), formOccurrence(2, email)],
        next_cursor: 'cursor-page-2',
      });

      renderIssues(<IssuesCatalog crawlId={CRAWL} />, OPEN);

      expect(await screen.findByText('On all 2 pages shown, of 179 affected')).toBeInTheDocument();
      const dialog = screen.getByRole('dialog', { name: 'Form controls missing accessible names' });
      expect(within(dialog).getByRole('button', { name: 'Next page' })).not.toBeDisabled();
    });

    it('says when the whole list shares it', async () => {
      serveFormIssue({
        affected_url_count: 2,
        occurrences: [formOccurrence(1, email), formOccurrence(2, email)],
      });

      renderIssues(<IssuesCatalog crawlId={CRAWL} />, OPEN);

      expect(await screen.findByText('On all 2 affected pages')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Ask agent about this page' })).toBeNull();
    });
  });
});
