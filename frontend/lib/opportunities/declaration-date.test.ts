import { describe, expect, it } from 'vite-plus/test';

import { declarationDays, declaredInstant, isDeclarableDay, localDay } from './declaration-date';

describe('declaration date', () => {
  it('declares today as the moment the dialog opened and an earlier day as its local noon', () => {
    const opened = new Date(2026, 9, 8, 9, 30);
    expect(declaredInstant(localDay(opened), opened)).toBe(opened.toISOString());
    expect(declaredInstant('2026-10-01', opened)).toBe(new Date(2026, 9, 1, 12).toISOString());
  });

  it('starts the range on the first day whose noon the server window still accepts', () => {
    const now = new Date(2026, 9, 8, 9);
    const morning = new Date(2026, 8, 8, 9).toISOString();
    const evening = new Date(2026, 8, 8, 18).toISOString();
    expect(declarationDays(morning, now)).toEqual({ min: '2026-09-08', max: '2026-10-08' });
    expect(declarationDays(evening, now).min).toBe('2026-09-09');
  });

  it('accepts only real calendar days inside the range', () => {
    const range = { min: '2026-09-08', max: '2026-10-08' };
    expect(isDeclarableDay('2026-10-01', range)).toBe(true);
    expect(isDeclarableDay('2026-10-09', range)).toBe(false);
    expect(isDeclarableDay('2026-09-07', range)).toBe(false);
    expect(isDeclarableDay('2026-09-31', range)).toBe(false);
    expect(isDeclarableDay('2026-10-1', range)).toBe(false);
  });
});
