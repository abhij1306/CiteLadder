import { describe, expect, it } from 'vite-plus/test';

import { ACTIVE_RUN_POLL_MS } from '@/lib/config/operational';
import { discoveryFinished, discoveryPollInterval } from './competitor-discovery';

const task = (id: string, status: string, terminal: boolean) => ({
  id,
  target: { kind: 'category' as const, id: '22222222-2222-4222-8222-222222222222' },
  status,
  error_code: '',
  terminal,
});

describe('discoveryPollInterval', () => {
  it('polls while any tracked discovery is still running', () => {
    expect(discoveryPollInterval([task('a', 'running', false)])).toBe(ACTIVE_RUN_POLL_MS);
    expect(discoveryPollInterval([task('a', 'succeeded', true), task('b', 'queued', false)])).toBe(
      ACTIVE_RUN_POLL_MS,
    );
  });

  it('stops once every tracked discovery has terminalized', () => {
    expect(discoveryPollInterval([task('a', 'succeeded', true), task('b', 'failed', true)])).toBe(
      false,
    );
    expect(discoveryPollInterval([])).toBe(false);
    expect(discoveryPollInterval(undefined)).toBe(false);
  });
});

describe('discoveryFinished', () => {
  it('fires on the read where a tracked task becomes terminal', () => {
    expect(discoveryFinished([task('a', 'running', false)], [task('a', 'succeeded', true)])).toBe(
      true,
    );
    expect(discoveryFinished(undefined, [task('a', 'failed', true)])).toBe(true);
  });

  it('fires for one finished run while another is still running', () => {
    expect(
      discoveryFinished(
        [task('a', 'running', false), task('b', 'running', false)],
        [task('a', 'succeeded', true), task('b', 'running', false)],
      ),
    ).toBe(true);
  });

  it('fires when a task drops off the recovered in-flight list after a reload', () => {
    expect(discoveryFinished([task('a', 'running', false)], [])).toBe(true);
  });

  it('does not fire for work still running, an already-known result, or nothing at all', () => {
    expect(discoveryFinished([task('a', 'running', false)], [task('a', 'running', false)])).toBe(
      false,
    );
    expect(discoveryFinished([task('a', 'succeeded', true)], [task('a', 'succeeded', true)])).toBe(
      false,
    );
    expect(discoveryFinished([task('a', 'succeeded', true)], [task('b', 'queued', false)])).toBe(
      false,
    );
    expect(discoveryFinished(undefined, [])).toBe(false);
  });
});
