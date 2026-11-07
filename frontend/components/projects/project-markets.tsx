'use client';

import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';

import { MARKET_COUNTRIES, MARKET_LANGUAGES } from '@citeladder/contracts/markets';

import { Button, IconButton } from '@/components/ui/button';
import { Inline, Stack } from '@/components/ui/layout';
import { MarketSelect } from '@/components/ui/market-select';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { projectMutations } from '@/lib/api/projects';
import { useProjectMarkets } from '@/lib/project/use-project-markets';

/**
 * Additional measurement markets. Each one is measured as its own run and
 * read on its own in Visibility; the default market is the project's country
 * and language above. Adding and removing apply at once, apart from the
 * panel's Save.
 */
export function ProjectMarkets({
  projectId,
  workspaceId,
}: Readonly<{ projectId: string; workspaceId: string }>) {
  const scope = { workspaceId, projectId };
  const markets = useProjectMarkets(projectId, workspaceId);
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('');
  const add = useMutation(projectMutations.addMarket(scope));
  const remove = useMutation(projectMutations.removeMarket(scope));
  const addMarket = () =>
    add.mutate(
      { country_code: country, language_code: language },
      {
        onSuccess: () => {
          setCountry('');
          setLanguage('');
        },
      },
    );
  const extra = markets.filter((market) => !market.is_default);
  const failed = add.error ?? remove.error;
  return (
    <Stack as="section" gap="compact" aria-label="Additional markets">
      <p className={textRole('label')}>Additional markets</p>
      <p className="type-caption text-ink-muted">
        Measure the same prompts from other countries. Each market runs and reports separately.
      </p>
      {extra.length ? (
        <ul className={ledgerClasses('boxed')}>
          {extra.map((market) => (
            <Inline
              as="li"
              key={market.id}
              className={ledgerItemClasses('type-body justify-between')}
            >
              <span>{market.label}</span>
              <IconButton
                icon={X}
                label={`Remove ${market.label}`}
                disabled={remove.isPending}
                onClick={() => market.id && remove.mutate(market.id)}
              />
            </Inline>
          ))}
        </ul>
      ) : null}
      <Stack gap="item" className="grid-cols-[1fr_1fr_auto] items-end">
        <MarketSelect
          ariaLabel="Market country"
          value={country}
          onChange={setCountry}
          options={MARKET_COUNTRIES}
        />
        <MarketSelect
          ariaLabel="Market language"
          value={language}
          onChange={setLanguage}
          options={MARKET_LANGUAGES}
        />
        <Button
          variant="secondary"
          disabled={!country || !language || add.isPending}
          onClick={addMarket}
        >
          {add.isPending ? 'Adding…' : 'Add market'}
        </Button>
      </Stack>
      {failed ? (
        <MutationNotice
          notice={mutationNoticeForError(failed, {
            action: add.error ? 'add the market' : 'remove the market',
          })}
        />
      ) : null}
    </Stack>
  );
}
