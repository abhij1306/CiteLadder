import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { installTrustedTypesPolicy } from './trusted-types';

type Rules = { createScriptURL(input: string): string | null };

afterEach(() => {
  delete window.trustedTypes;
});

describe('Trusted Types default policy', () => {
  it('passes only the script URLs the app loads on purpose', () => {
    const policies = new Map<string, Rules>();
    window.trustedTypes = {
      createPolicy: (name: string, rules: Rules) => policies.set(name, rules),
    };
    installTrustedTypesPolicy();
    expect(
      [
        'https://checkout.razorpay.com/v1/checkout.js',
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
        'https://challenges.cloudflare.com/turnstile/v0/api.js',
        'https://evil.example/checkout.js',
      ].map((url) => policies.get('default')?.createScriptURL(url)),
    ).toEqual([
      'https://checkout.razorpay.com/v1/checkout.js',
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
      null,
      null,
    ]);
  });

  it('lets the app start when another script already created the default policy', () => {
    const createPolicy = vi.fn(() => {
      throw new TypeError('Policy with name "default" already exists.');
    });
    window.trustedTypes = { createPolicy };
    installTrustedTypesPolicy();
    expect(createPolicy).toHaveBeenCalledTimes(1);
  });
});
