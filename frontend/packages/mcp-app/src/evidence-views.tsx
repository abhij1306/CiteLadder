import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Disclosure } from '@/components/ui/disclosure';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import type { AppState, Controller } from './controller';
import { moment, rate, text } from './format';

const sourceSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      responses: z.number(),
      annotations: z.number(),
      citation_rate: z.number().nullable(),
      citation_share: z.number().nullable(),
    }),
  ),
  coverage: z.object({ responses: z.number(), prompts: z.number(), citations: z.number() }),
  pagination: z.object({ next_cursor: z.string().nullable() }),
});
type Props = Readonly<{ state: AppState; controller: Controller }>;

export function SourcesView({ state, controller }: Props) {
  const selection = state.selection!;
  const parsed = sourceSchema.safeParse(state.result?.evidence);
  if (!parsed.success)
    return (
      <p role="alert" className={textRole('body')}>
        Source evidence is unavailable for the selected audit. Retry or reconnect.
      </p>
    );
  const data = parsed.data;
  return (
    <div className="space-y-4">
      <Select
        ariaLabel="Source grouping"
        value={selection.level}
        options={[
          { value: 'domain', label: 'Domains' },
          { value: 'url', label: 'URLs' },
        ]}
        onValueChange={(level) =>
          void controller.select({ ...selection, level, domain: null, cursor: null })
        }
      />
      <p className={textRole('caption')}>
        {data.coverage.responses} responses · {data.coverage.prompts} prompts ·{' '}
        {data.coverage.citations} citations. Citation rate uses responses where the source was
        retrieved; citation share uses citations. These denominators differ.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Citations</TableHead>
            <TableHead>Citation rate</TableHead>
            <TableHead>Evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((row) => (
            <TableRow key={row.key}>
              <TableCell>{row.key}</TableCell>
              <TableCell>{row.annotations}</TableCell>
              <TableCell>{rate(row.citation_rate)}</TableCell>
              <TableCell>
                {selection.level === 'domain' && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void controller.select({
                        ...selection,
                        level: 'url',
                        domain: row.key,
                        cursor: null,
                      })
                    }
                  >
                    URLs
                  </Button>
                )}
                <Button variant="ghost" onClick={() => void controller.drill(row.key)}>
                  Answers
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!data.items.length && (
        <p className={textRole('body')}>No citations observed in this selection.</p>
      )}
      {data.pagination.next_cursor && (
        <Button
          variant="secondary"
          onClick={() =>
            void controller.select({ ...selection, cursor: data.pagination.next_cursor })
          }
        >
          Next sources
        </Button>
      )}
      <p className={textRole('caption')}>
        Names in cited answers are co-occurrence, not proof of presence on the publisher page.
      </p>
      {state.answers.map((answer, index) => (
        <article key={text(answer.task_id, `answer-${index}`)} className="space-y-2">
          <h3 className={textRole('itemTitle')}>
            {typeof answer.prompt_text === 'string' ? answer.prompt_text : 'Answer evidence'}
          </h3>
          <p className={textRole('body')}>
            {typeof answer.answer_text === 'string'
              ? answer.answer_text
              : 'Fetch the referenced answer for its retained text.'}
          </p>
          <p className={textRole('caption')}>
            {text(answer.logical_engine, 'Engine unknown')} · {moment(answer.completed_at)}
          </p>
          {typeof answer.record_uri === 'string' && (
            <Button
              variant="ghost"
              onClick={() => void controller.fetchAnswer(text(answer.record_uri))}
            >
              Read retained answer
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}

const siteSchema = z.object({
  state: z.literal('available'),
  snapshot_id: z.string(),
  crawl_id: z.string(),
  observed_at: z.string(),
  scores: z.object({
    web_fundamentals: z.number().nullable(),
    aeo_readiness: z.number().nullable(),
    aeo_measurement_coverage: z.number().nullable(),
  }),
  coverage: z.object({ selected_urls: z.number(), analyzed_urls: z.number() }),
  measurement_states: z.record(z.string(), z.string()),
  versions: z.record(z.string(), z.string().nullable()),
});
export function SiteHealthView({ state, controller }: Props) {
  const [findings, setFindings] = useState<Awaited<ReturnType<Controller['siteFindings']>>>(null);
  const [loadingFindings, setLoadingFindings] = useState(false);
  const [findingsError, setFindingsError] = useState(false);
  const [pagesError, setPagesError] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);
  const [pages, setPages] = useState<Record<string, unknown>[]>([]);
  const parsed = siteSchema.safeParse(state.result?.evidence);
  if (!parsed.success) {
    const missing = z
      .object({ state: z.literal('unavailable'), reason: z.literal('no_site_snapshot') })
      .safeParse(state.result?.evidence);
    return (
      <p role={missing.success ? undefined : 'alert'} className={textRole('body')}>
        {missing.success
          ? 'No persisted Site Health snapshot. Start a crawl in CiteLadder, then return.'
          : 'Site Health evidence is unavailable. Retry or reconnect.'}
      </p>
    );
  }
  const site = parsed.data;
  return (
    <div className="space-y-4">
      <EditorialSectionHeader title="Persisted Site Health" />
      <p className={textRole('body')}>
        Web fundamentals: {site.scores.web_fundamentals ?? 'Unavailable'} · AEO readiness:{' '}
        {site.scores.aeo_readiness ?? 'Unavailable'} · measurement coverage:{' '}
        {rate(site.scores.aeo_measurement_coverage)}
      </p>
      <p className={textRole('caption')}>
        Observed {moment(site.observed_at)} · {site.coverage.analyzed_urls} analyzed /{' '}
        {site.coverage.selected_urls} selected URLs
      </p>
      <p className={textRole('caption')}>
        {Object.entries(site.measurement_states)
          .map(([kind, value]) => `${kind}: ${value}`)
          .join(' · ')}
      </p>
      <p className={textRole('caption')}>
        Incomplete coverage is partial evidence. This snapshot has no historical period filter.
        Actions are current and may refer to different evidence than this snapshot.
      </p>
      <Disclosure title="Processing versions">
        <dl className={textRole('caption', 'space-y-2 break-all')}>
          {Object.entries(site.versions).map(([kind, version]) => (
            <div key={kind}>
              <dt>{kind.replaceAll('_', ' ')} version</dt>
              <dd>{version ?? 'Not recorded'}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
      <Button
        variant="secondary"
        disabled={loadingFindings}
        onClick={() => {
          setFindings(null);
          setLoadingFindings(true);
          setFindingsError(false);
          void controller
            .siteFindings()
            .then(setFindings)
            .catch(() => setFindingsError(true))
            .finally(() => setLoadingFindings(false));
        }}
      >
        Read current Actions
      </Button>
      <Button
        variant="secondary"
        disabled={loadingPages}
        onClick={() => {
          setPages([]);
          setPagesError(false);
          setLoadingPages(true);
          void controller
            .sitePages()
            .then(setPages)
            .catch(() => setPagesError(true))
            .finally(() => setLoadingPages(false));
        }}
      >
        Read pages from this crawl
      </Button>
      {findingsError && (
        <p role="alert" className={textRole('body')}>
          Actions are unavailable. Retry or reconnect.
        </p>
      )}
      {pagesError && (
        <p role="alert" className={textRole('body')}>
          Page evidence is unavailable. Retry or reconnect.
        </p>
      )}
      {loadingPages && <output>Loading persisted pages…</output>}
      {loadingFindings && <output>Loading Actions…</output>}
      {findings?.state === 'unavailable' && (
        <output className={textRole('body', 'block')}>
          Actions are unavailable. Retry or reconnect.
        </output>
      )}
      {findings?.state === 'available' && !findings.items.length && (
        <output className={textRole('body', 'block')}>No open Actions for this project.</output>
      )}
      {(findings?.state === 'available' ? findings.items : []).map((action, index) => (
        <article key={text(action.id, `action-${index}`)}>
          <h3 className={textRole('itemTitle')}>{text(action.target_label, 'Action')}</h3>
          {text(action.approach) && <p className={textRole('body')}>{text(action.approach)}</p>}
          <p className={textRole('caption')}>
            {text(action.status, 'Status unknown').replaceAll('_', ' ')}
            {text(action.target_url) && ` · ${text(action.target_url)}`}
          </p>
        </article>
      ))}
      {pages.map((page, index) => (
        <article key={text(page.site_url_id, `page-${index}`)}>
          <h3 className={textRole('itemTitle')}>{text(page.url, text(page.title, 'Page'))}</h3>
          {text(page.title) && text(page.title) !== text(page.url) && (
            <p className={textRole('caption')}>{text(page.title)}</p>
          )}
        </article>
      ))}
    </div>
  );
}
