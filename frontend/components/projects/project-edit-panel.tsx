import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { MarketSelect } from '@/components/ui/market-select';
import { ProjectMarkets } from './project-markets';
import { textRole } from '@/components/ui/typography';
import { Plus, X } from '@/lib/icons';
import { projectMutations } from '@/lib/api/projects';
import { brandDiscoveryQueries } from '@/lib/api/brand-discoveries';
import type { Project } from '@citeladder/contracts';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { MARKET_COUNTRIES, MARKET_LANGUAGES } from '@citeladder/contracts/markets';

import { MentionRuleFields, mentionRuleDraft, type MentionRuleDraft } from './mention-rule-fields';
import { Notice } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

let competitorKeySeq = 0;
const nextCompetitorKey = () => {
  competitorKeySeq += 1;
  return `competitor-${competitorKeySeq}`;
};

type CompetitorDraft = {
  key: string;
  id?: string;
  name: string;
  aliases: string[];
  domains: string;
  rule: MentionRuleDraft;
};

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

function competitorName(name: string, index: number): string {
  return name || `competitor ${index + 1}`;
}

export function ProjectEditPanel({
  project,
  open,
  onOpenChange,
}: Readonly<{ project: Project; open: boolean; onOpenChange: (open: boolean) => void }>) {
  const discoveryCatalog = useQuery({
    ...brandDiscoveryQueries.catalog(project.workspace_id),
    enabled: open,
  });

  const [name, setName] = useState(project.name);
  const [brandName, setBrandName] = useState(project.brand_name);
  const [websiteUrl, setWebsiteUrl] = useState(project.website_url);
  const [country, setCountry] = useState(project.country_code);
  const [language, setLanguage] = useState(project.language_code);
  const [brandRule, setBrandRule] = useState(() => mentionRuleDraft(project.brand.matching));
  const [ownedDomains, setOwnedDomains] = useState(() => project.owned_domains.join(', '));
  const [unintendedDomains, setUnintendedDomains] = useState(() =>
    project.unintended_domains.join(', '),
  );
  const [competitors, setCompetitors] = useState<CompetitorDraft[]>(() =>
    project.competitors.map((competitor) => ({
      key: nextCompetitorKey(),
      id: competitor.id,
      name: competitor.name,
      aliases: competitor.aliases,
      domains: competitor.domains.join(', '),
      rule: mentionRuleDraft(competitor.matching),
    })),
  );
  const maximumCompetitors = discoveryCatalog.data?.maximum_competitors;
  const competitorLimitReached =
    maximumCompetitors === undefined || competitors.length >= maximumCompetitors;

  const save = useMutation(
    projectMutations.update({ workspaceId: project.workspace_id, projectId: project.id }),
  );
  const nameMissing = name.trim() === '';
  const submit = () =>
    save.mutate(
      {
        name: name.trim(),
        brand_name: brandName.trim(),
        website_url: websiteUrl.trim(),
        country_code: country.trim().toUpperCase(),
        language_code: language.trim(),
        owned_domains: splitList(ownedDomains),
        unintended_domains: splitList(unintendedDomains),
        competitors: competitors.flatMap((competitor) => {
          const name = competitor.name.trim();
          return name
            ? [
                {
                  ...(competitor.id === undefined ? {} : { id: competitor.id }),
                  name,
                  aliases: competitor.aliases,
                  domains: splitList(competitor.domains),
                },
              ]
            : [];
        }),
        entity_matching: touchedRules([{ name: brandName, rule: brandRule }, ...competitors]),
      },
      { onSuccess: () => onOpenChange(false) },
    );

  const updateCompetitor = (index: number, patch: Partial<CompetitorDraft>) =>
    setCompetitors((prev) =>
      prev.map((competitor, i) => (i === index ? { ...competitor, ...patch } : competitor)),
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${project.brand_name || project.name}`}
      width="wide"
      footer={
        <>
          <Button variant="quiet" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            <Icon icon={X} />
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending || nameMissing}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <Stack gap="workspace">
        {save.isError ? (
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(save.error, { action: 'save the project' })}
          />
        ) : null}

        <Stack gap="workspace">
          <Field
            label="Project name"
            error={nameMissing ? 'Enter a project name.' : undefined}
            required
          >
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
          <p className={textRole('body', 'text-ink-2')}>Domains</p>
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
          <Field label="Unintended">
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
          <Inline>
            <p className={textRole('body', 'text-ink-2')}>Competitors</p>
            <span className="type-caption">
              {competitors.length} of {maximumCompetitors ?? '…'}
            </span>
            <Button
              variant="quiet"
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
              <Icon icon={Plus} />
              Add
            </Button>
          </Inline>
          {competitors.length === 0 ? (
            <StateBlock kind="empty" inline message="None tracked." />
          ) : (
            <Stack as="ul" gap="compact" className="list-none">
              {competitors.map((competitor, index) => (
                <Stack as="li" key={competitor.key} gap="compact">
                  <Inline>
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
                    <IconButton
                      icon={X}
                      label={`Remove ${competitorName(competitor.name, index)}`}
                      onClick={() => setCompetitors((prev) => prev.filter((_, i) => i !== index))}
                    />
                  </Inline>
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
