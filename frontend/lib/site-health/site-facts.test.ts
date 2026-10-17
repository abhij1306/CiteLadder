import { expect, it } from 'vite-plus/test';
import { makeSiteFacts } from '@/test/fixtures/site-health';
import { readSiteFacts } from './site-facts';

it('renders only the persisted catalog projection and rejects incomplete evidence', () => {
  const facts = makeSiteFacts();
  expect(readSiteFacts(facts)?.robots.bots[0]).toMatchObject({
    label: 'GPTBot',
    root_access: 'disallowed',
  });
  expect(readSiteFacts({ ...facts, robots: { fetched: true } })).toBeNull();
  expect(readSiteFacts(null)).toBeNull();
});
