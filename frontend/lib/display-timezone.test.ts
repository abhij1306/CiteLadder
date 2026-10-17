import { afterEach, describe, expect, it } from 'vite-plus/test';

import {
  DISPLAY_TIME_ZONE_COOKIE,
  readTimeZonePreference,
  resolveDisplayTimeZone,
  resolveServerDisplayTimeZone,
  saveTimeZonePreference,
} from './display-timezone';
import {
  formatDisplayDate,
  formatDisplayShortDate,
  formatDisplayTimestamp,
  formatWindowDate,
} from './format';

afterEach(() => {
  document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=; Path=/; Max-Age=0`;
});

describe('display timezone', () => {
  it('uses the visit device zone for Auto and UTC for an unavailable device zone', () => {
    expect(resolveDisplayTimeZone('auto', 'Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(resolveDisplayTimeZone('auto', 'not/a-zone')).toBe('UTC');
    expect(resolveDisplayTimeZone('auto')).toBe('UTC');
    expect(resolveDisplayTimeZone('not/a-zone', 'Asia/Kolkata')).toBe('UTC');
  });

  it('keeps a selected named zone fixed and uses only an explicit cookie on the server', () => {
    expect(resolveDisplayTimeZone('America/New_York', 'Asia/Kolkata')).toBe('America/New_York');
    expect(resolveDisplayTimeZone('UTC', 'Asia/Kolkata')).toBe('UTC');
    expect(resolveServerDisplayTimeZone('')).toBe('UTC');
    expect(resolveServerDisplayTimeZone(`${DISPLAY_TIME_ZONE_COOKIE}=auto`)).toBe('UTC');
    expect(resolveServerDisplayTimeZone(`${DISPLAY_TIME_ZONE_COOKIE}=Asia%2FKolkata`)).toBe(
      'Asia/Kolkata',
    );
    expect(resolveServerDisplayTimeZone(`${DISPLAY_TIME_ZONE_COOKIE}=bad%2Fzone`)).toBe('UTC');
    expect(readTimeZonePreference(`${DISPLAY_TIME_ZONE_COOKIE}=bad%2Fzone`)).toBe('UTC');
  });

  it('persists a named preference through a cookie reload and rejects invalid zones', () => {
    expect(saveTimeZonePreference('Asia/Kolkata')).toBe(true);
    expect(readTimeZonePreference(document.cookie)).toBe('Asia/Kolkata');
    expect(saveTimeZonePreference('not/a-zone')).toBe(false);
    expect(readTimeZonePreference(document.cookie)).toBe('Asia/Kolkata');
    expect(saveTimeZonePreference('auto')).toBe(true);
    expect(readTimeZonePreference(document.cookie)).toBe('auto');
  });

  it('formats instants across a daylight-saving boundary while bucket dates stay fixed', () => {
    const before = formatDisplayTimestamp('2026-03-08T06:30:00Z', 'America/New_York');
    const after = formatDisplayTimestamp('2026-03-08T07:30:00Z', 'America/New_York');
    expect(before).toContain('1:30');
    expect(after).toContain('3:30');
    expect(formatDisplayDate('2026-01-01T00:30:00Z', 'America/New_York')).toContain('Dec 31, 2025');
    expect(formatDisplayShortDate('2026-01-01T00:30:00Z', 'America/New_York')).toBe('Dec 31');
    expect(formatWindowDate('2026-01-01')).toBe('Jan 1, 2026');
  });
});
