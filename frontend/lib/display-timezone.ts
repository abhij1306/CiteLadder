import { useSyncExternalStore } from 'react';

export const DISPLAY_TIME_ZONE_COOKIE = 'citeladder-display-timezone';
const CHANGE_EVENT = 'citeladder:display-timezone-change';
const COOKIE_AGE_SECONDS = 60 * 60 * 24 * 365;

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function readTimeZonePreference(cookieHeader: string): string {
  const encoded = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DISPLAY_TIME_ZONE_COOKIE}=`))
    ?.slice(DISPLAY_TIME_ZONE_COOKIE.length + 1);
  if (!encoded) return 'auto';
  try {
    const value = decodeURIComponent(encoded);
    return value === 'auto' || validTimeZone(value) ? value : 'UTC';
  } catch {
    return 'UTC';
  }
}

export function resolveDisplayTimeZone(preference: string, deviceTimeZone?: string): string {
  if (preference !== 'auto') return validTimeZone(preference) ? preference : 'UTC';
  return deviceTimeZone && validTimeZone(deviceTimeZone) ? deviceTimeZone : 'UTC';
}

function detectDeviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

const visitDeviceTimeZone = typeof window === 'undefined' ? undefined : detectDeviceTimeZone();

function browserTimeZone(): string {
  return resolveDisplayTimeZone(readTimeZonePreference(document.cookie), visitDeviceTimeZone);
}

function subscribe(notify: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, notify);
  window.addEventListener('focus', notify);
  return () => {
    window.removeEventListener(CHANGE_EVENT, notify);
    window.removeEventListener('focus', notify);
  };
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

export function endOfDayInZone(isoDay: string, timeZone: string): string {
  const wall = Date.parse(`${isoDay}T23:59:59Z`);
  let instant = wall - zoneOffsetMs(wall, timeZone);
  instant = wall - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

export function useDisplayTimeZone(): string {
  return useSyncExternalStore(subscribe, browserTimeZone, () => 'UTC');
}

export function useTimeZonePreference(): string {
  return useSyncExternalStore(
    subscribe,
    () => readTimeZonePreference(document.cookie),
    () => 'auto',
  );
}

export function saveTimeZonePreference(preference: string): boolean {
  if (preference !== 'auto' && !validTimeZone(preference)) return false;
  document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=${encodeURIComponent(preference)}; Path=/; Max-Age=${COOKIE_AGE_SECONDS}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  if (readTimeZonePreference(document.cookie) !== preference) return false;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}
