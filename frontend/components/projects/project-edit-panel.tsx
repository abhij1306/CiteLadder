'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { QueryState } from '@/components/ui/query-state';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { MarketSelect } from '@/components/ui/market-select';
import { ProjectMarkets } from './project-markets';
import { textRole } from '@/components/ui/typography';
import { projectsApi } from '@/lib/api/projects';
import { brandDiscoveriesApi } from '@/lib/api/brand-discoveries';
import { queryKeys } from '@/lib/api/query-keys';
import { brandDiscoveryKeys } from '@/lib/api/query-keys/brand-discovery';
import type { Project } from '@/lib/api/types';
import { humanizeApiError } from '@/lib/api/errors';
import { refreshBrandLogos } from '@/lib/project/brand-logos';
import { MARKET_COUNTRIES, MARKET_LANGUAGES } from '@citeladder/contracts/markets';

import { MentionRuleFields, mentionRuleDraft, type MentionRuleDraft } from './mention-rule-fields';

/**
 * Edit an existing project's configuration.
 *
 * Onboarding replaced `/setup` and owns *creation*; this owns everything
 * afterwards. Without it, a brand's website, competitors and domains were fixed
 * at whatever discovery produced on day one — the gap left by retiring the
 * setup edit form.
 *
 * Deliberately a flat panel, not a stepper. The old edit surface was a
 * five-step wizard, which is the wrong shape for changing one alias: a wizard
 * is for a task you do once, a panel is for a thing you keep. Everything is
 * visible at once and Save sends only what changed.
 *
 * Comma-separated text for the list fields rather than per-row editors. These
 * are short lists of short strings, and a row-with-remove-button UI for
 * aliases was a meaningful chunk of the old form's weight for no real gain.
 */
const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Draft rows carry a stable `key` because the list is editable AND removable.
 * Keyed by array index, removing the first of three rows shifted every row's
 * identity: React reused the same DOM inputs for different competitors, so
 * focus, selection, and any in-flight IME composition landed on the wrong row.
 * The counter is module-scoped and monotonic — it only has to be unique within
 * one mounted list, never persisted or sent to the backend.
 */
let competitorKeySeq = 0;
const nextCompetitorKey = () => {
  competitorKeySeq += 1;
  return `competitor-${competitorKeySeq}`;
};

// Aliases are not edited here; each row carries its own so a rename keeps them.
type CompetitorDraft = {
  key: string;
  name: string;
  aliases: string[];
  domains: string;
  rule: MentionRuleDraft;
};

/** Only rules a person changed are saved; the rest keep following their defaults. */
function touchedRules(entities: readonly { name: string; rule: MentionRuleDraft }[]) {
  return entities.flatMap(({ name, rule }) =>
    name.trim() && rule.touched
      ? [
          {
            name: name.trim(),
            mode: rule.mode,
            context_terms: splitList(rule.contextTerms),
            exclusion_phrases: splitList(rule.exclusionPhrases),
          },
        ]
      : [],
  );
}

/** An unnamed competitor row still needs something for a screen reader to say. */
function competitorName(name: string, index: number): string {
  return name || `competitor ${index + 1}`;
}

export function ProjectEditPanel({
  project,
  open,
  onOpenChange,
}: Readonly<{
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const queryClient = useQueryClient();
  const discoveryCatalog = useQuery({
    queryKey: brandDiscoveryKeys.catalog(project.workspace_id),
    queryFn: ({ signal }) =>
      brandDiscoveriesApi.catalog({
        signal,
        workspaceId: project.workspace_id,
      }),
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const [name, setName] = useState(project.name);
  const [brandName, setBrandName] = useState(project.brand_name);
  const [websiteUrl, setWebsiteUrl] = useState(project.website_url);
  const [country, setCountry] = useState(project.country_code);
  const [language, setLanguage] = useState(project.language_code);
  // Lazy initializers: these join/map the project's arrays, and a bare
  // `useState(expr)` re-runs `expr` on every keystroke in this panel only to
  // throw the result away.
  const [aliases, setAliases] = useState(() => project.brand.aliases.join(', '));
  const [brandRule, setBrandRule] = useState(() => mentionRuleDraft(project.brand.matching));
  const [ownedDomains, setOwnedDomains] = useState(() => project.owned_domains.join(', '));
  const [unintendedDomains, setUnintendedDomains] = useState(() =>
    project.unintended_domains.join(', '),
  );
  const [competitors, setCompetitors] = useState<CompetitorDraft[]>(() =>
    project.competitors.map((competitor) => ({
      key: nextCompetitorKey(),
      name: competitor.name,
      aliases: competitor.aliases,
      domains: competitor.domains.join(', '),
      rule: mentionRuleDraft(competitor.matching),
    })),
  );
  const maximumCompetitors = discoveryCatalog.data?.maximum_competitors;
  const competitorLimitReached =
    maximumCompetitors === undefined || competitors.length >= maximumCompetitors;

  const save = useMutation({
    mutationFn: () =>
      projectsApi.updateProject(
        project.id,
        {
          // An emptied name keeps the current one rather than failing the save.
          name: name.trim() || project.name,
          brand_name: brandName.trim(),
          website_url: websiteUrl.trim(),
          country_code: country.trim().toUpperCase(),
          language_code: language.trim(),
          brand: { aliases: splitList(aliases) },
          owned_domains: splitList(ownedDomains),
          unintended_domains: splitList(unintendedDomains),
          competitors: competitors.flatMap((competitor) => {
            const name = competitor.name.trim();
            return name
              ? [
                  {
                    name,
                    aliases: competitor.aliases,
                    domains: splitList(competitor.domains),
                  },
                ]
              : [];
          }),
          entity_matching: touchedRules([{ name: brandName, rule: brandRule }, ...competitors]),
        },
        { workspaceId: project.workspace_id },
      ),
    onSuccess: async () => {
      // The website or a competitor's domains may have changed.
      refreshBrandLogos(queryClient, project.id, project.workspace_id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      onOpenChange(false);
    },
  });

  const updateCompetitor = (index: number, patch: Partial<CompetitorDraft>) =>
    setCompetitors((prev) =>
      prev.map((competitor, i) => (i === index ? { ...competitor, ...patch } : competitor)),
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${project.brand_name || project.name}`}
      description="Changes apply to future audits. Existing results keep the settings they ran with."
      className="w-155"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <Stack gap="workspace">
        {save.isError ? <Alert tone="danger">{humanizeApiError(save.error).message}</Alert> : null}

        <Stack gap="workspace">
          <Field label="Project name" hint="How this project appears in your project list.">
            {(props) => (
              <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label="Brand name">
            {(props) => (
              <Input
                {...props}
                value={brandName}
                onChange={(event) => {
                  setBrandName(event.target.value);
                  // Rules are saved by name, so a renamed entity carries its rule.
                  setBrandRule((rule) => ({ ...rule, touched: true }));
                }}
              />
            )}
          </Field>
          <Field label="Website">
            {(props) => (
              <Input
                {...props}
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Brand aliases"
            hint="Comma separated. Every other spelling an answer might use for you — a mention only counts when it matches one of these or your brand name."
          >
            {(props) => (
              <Input
                {...props}
                value={aliases}
                onChange={(event) => setAliases(event.target.value)}
                placeholder="Acme Inc, Acme Co"
              />
            )}
          </Field>
          <MentionRuleFields name={brandName} rule={brandRule} onChange={setBrandRule} />
          <Stack gap="compact" className="grid-cols-2">
            <Field label="Country">
              {(props) => (
                <MarketSelect
                  {...props}
                  ariaLabel="Country"
                  value={country}
                  onChange={setCountry}
                  options={MARKET_COUNTRIES}
                />
              )}
            </Field>
            <Field label="Language">
              {(props) => (
                <MarketSelect
                  {...props}
                  ariaLabel="Language"
                  value={language}
                  onChange={setLanguage}
                  options={MARKET_LANGUAGES}
                />
              )}
            </Field>
          </Stack>
          {open ? (
            <ProjectMarkets projectId={project.id} workspaceId={project.workspace_id} />
          ) : null}
        </Stack>

        <Stack gap="workspace">
          <p className={textRole('label')}>Domains</p>
          <Field label="Owned" hint="Comma separated">
            {(props) => (
              <Input
                {...props}
                value={ownedDomains}
                onChange={(event) => setOwnedDomains(event.target.value)}
                placeholder="acme.com, shop.acme.com"
              />
            )}
          </Field>
          <Field label="Unintended" hint="Domains that are not yours but get confused for you">
            {(props) => (
              <Input
                {...props}
                value={unintendedDomains}
                onChange={(event) => setUnintendedDomains(event.target.value)}
              />
            )}
          </Field>
        </Stack>

        <Stack gap="compact">
          <div className="flex items-center gap-2">
            <p className={textRole('label')}>Competitors</p>
            <span className="type-caption">
              {competitors.length} of {maximumCompetitors ?? '…'}
            </span>
            <Button
              variant="ghost"
              className="ms-auto"
              aria-label="Add competitor"
              disabled={competitorLimitReached}
              onClick={() =>
                setCompetitors((prev) => [
                  ...prev,
                  {
                    key: nextCompetitorKey(),
                    name: '',
                    aliases: [],
                    domains: '',
                    rule: mentionRuleDraft(undefined),
                  },
                ])
              }
            >
              <Plus className="size-3.5" aria-hidden />
              Add
            </Button>
          </div>
          {competitors.length === 0 ? (
            <QueryState kind="empty" inline message="None tracked." />
          ) : (
            <Stack as="ul" gap="compact" className="list-none">
              {competitors.map((competitor, index) => (
                <Stack as="li" key={competitor.key} gap="compact">
                  <div className="flex items-center gap-2">
                    <Input
                      value={competitor.name}
                      onChange={(event) =>
                        updateCompetitor(index, {
                          name: event.target.value,
                          rule: { ...competitor.rule, touched: true },
                        })
                      }
                      aria-label={`Competitor ${index + 1} name`}
                      placeholder="Name"
                    />
                    <Input
                      value={competitor.domains}
                      onChange={(event) => updateCompetitor(index, { domains: event.target.value })}
                      aria-label={`Competitor ${index + 1} domains`}
                      placeholder="Domains"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${competitorName(competitor.name, index)}`}
                      onClick={() => setCompetitors((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </div>
                  <MentionRuleFields
                    name={competitor.name}
                    rule={competitor.rule}
                    onChange={(rule) => updateCompetitor(index, { rule })}
                  />
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Dialog>
  );
}
