import { afterEach, describe, expect, it } from 'vite-plus/test';

import { cohortUrlCodec, writeStoredCohort } from './prompt-cohort';

const PROJECT = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

afterEach(() => window.localStorage.clear());

describe('cohortUrlCodec', () => {
  it('reads the project’s remembered choice when the URL names none', () => {
    const codec = cohortUrlCodec(PROJECT);
    expect(codec.parse(null)).toBe('core');
    writeStoredCohort(PROJECT, 'comparison');
    // Parsed again after the choice changed, as when a link drops the param.
    expect(codec.parse(null)).toBe('comparison');
    expect(codec.parse('bogus')).toBe('comparison');
    expect(cohortUrlCodec(OTHER).parse(null)).toBe('core');
  });

  it('lets the URL win and always writes the value, so a copied link names its view', () => {
    writeStoredCohort(PROJECT, 'comparison');
    const codec = cohortUrlCodec(PROJECT);
    expect(codec.parse('core')).toBe('core');
    expect(codec.serialize('core')).toBe('core');
    expect(codec.serialize('comparison')).toBe('comparison');
  });
});
