'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';

import { MARKET_COUNTRIES, MARKET_LANGUAGES } from '@citeladder/contracts/markets';

import { Button } from '@/components/ui/button';
import { MarketSelect } from '@/components/ui/market-select';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
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
  const queryClient = useQueryClient();
  const key = queryKeys.projects.markets(projectId);
  const markets = useProjectMarkets(projectId, workspaceId);
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('');
  const add = useMutation({
    mutationFn: () =>
      projectsApi.addMarket(
        projectId,
        { country_code: country, language_code: language },
        { workspaceId },
      ),
    onSuccess: (list) => {
      queryClient.setQueryData(key, list);
      setCountry('');
      setLanguage('');
    },
  });
  const remove = useMutation({
    mutationFn: (marketId: string) =>
      projectsApi.deleteMarket(projectId, marketId, { workspaceId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
    },
  });
  const extra = markets.filter((market) => !market.is_default);
  const failed = add.error ?? remove.error;
  return (
    <section aria-label="Additional markets" className="grid gap-2">
      <p className={textRole('label')}>Additional markets</p>
      <p className="type-caption text-muted">
        Measure the same prompts from other countries. Each market runs and reports separately.
      </p>
      {extra.length ? (
        <ul className={ledgerClasses('boxed')}>
          {extra.map((market) => (
            <li
              key={market.id}
              className="type-body flex items-center justify-between gap-2 px-3 py-2"
            >
              <span>{market.label}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${market.label}`}
                disabled={remove.isPending}
                onClick={() => market.id && remove.mutate(market.id)}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
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
          onClick={() => add.mutate()}
        >
          {add.isPending ? 'Adding…' : 'Add market'}
        </Button>
      </div>
      {failed ? (
        <MutationNotice
          notice={mutationNoticeForError(failed, {
            action: add.error ? 'add the market' : 'remove the market',
          })}
        />
      ) : null}
    </section>
  );
}
