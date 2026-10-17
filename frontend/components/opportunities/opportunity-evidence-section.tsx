import { OpportunityKvRow } from '@/components/opportunities/opportunity-kv-row';
import { panelClasses } from '@/components/ui/panel';
import { OpportunitySourcePattern } from '@/components/opportunities/opportunity-source-pattern';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/typography';
import type { OpportunityDetail } from '@/lib/api/types';
import { parseSourcePattern } from '@/lib/opportunities/source-pattern';
import { formatCount } from '@/lib/format';
import { keywordGapEvidenceSchema } from '@citeladder/contracts';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** A keyword gap: who ranks, where, and the provider estimate it rests on. */
function KeywordGapEvidence({ evidence }: Readonly<{ evidence: Record<string, unknown> }>) {
  // Evidence the gap detector did not write in this shape is left unstated, not guessed at.
  const parsed = keywordGapEvidenceSchema.safeParse(evidence);
  if (!parsed.success) return null;
  const { search_volume: volume, competitors, statement } = parsed.data;
  return (
    <div className="grid gap-2">
      {volume === null ? null : (
        <OpportunityKvRow
          label="Monthly searches (DataForSEO estimate)"
          value={formatCount(volume)}
        />
      )}
      <ul className="type-body grid gap-1">
        {competitors.map((item) => (
          <li key={item.row_id}>
            {item.name} ranks
            {item.rank_group === null ? '' : ` #${item.rank_group}`}
            {item.url ? ` with ${item.url}` : ''}
          </li>
        ))}
      </ul>
      <p className="type-caption">{statement}</p>
    </div>
  );
}

export function OpportunityEvidenceSection({ detail }: Readonly<{ detail: OpportunityDetail }>) {
  const evidence = detail.evidence;
  if (detail.rule_id === 'search_keyword_gap')
    return (
      <section className="grid gap-2">
        <Label>Evidence</Label>
        {detail.target_theme ? (
          <OpportunityKvRow label="Search" value={detail.target_theme} />
        ) : null}
        <KeywordGapEvidence evidence={evidence} />
      </section>
    );
  const promptText = asString(evidence.prompt_text);
  const url = asString(evidence.url) ?? detail.target_url;
  const theme = asString(evidence.prompt_theme) ?? detail.target_theme;
  const competitors = asStringList(evidence.competitor_names);
  const sourcePattern = parseSourcePattern(evidence);

  return (
    <section className="grid gap-2">
      <Label>Evidence</Label>
      {promptText ? (
        <blockquote className={panelClasses({ tone: 'accent', pad: 'compact' })}>
          <p className="type-body text-foreground">“{promptText}”</p>
        </blockquote>
      ) : null}
      {url ? (
        <p className="type-caption text-foreground bg-background-alt rounded-[var(--radius-control)] px-3 py-2 break-all tabular-nums">
          {url}
        </p>
      ) : null}
      {theme ? <OpportunityKvRow label="Topic" value={theme} /> : null}
      {competitors.length > 0 ? (
        <div className="grid gap-1">
          <span className="type-caption">Competitors mentioned</span>
          <div className="flex flex-wrap gap-2">
            {competitors.map((name) => (
              <Badge key={name} variant="classification" value="competitor">
                {name}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      {sourcePattern ? <OpportunitySourcePattern pattern={sourcePattern} /> : null}
    </section>
  );
}
