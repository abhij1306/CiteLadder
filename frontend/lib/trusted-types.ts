import { RAZORPAY_CHECKOUT_SCRIPT } from '@/lib/config/billing';
import { TURNSTILE_SCRIPT_URL } from '@/lib/config/turnstile';

type TrustedTypePolicyFactory = {
  createPolicy(name: 'default', rules: { createScriptURL(input: string): string | null }): unknown;
};

declare global {
  interface Window {
    trustedTypes?: TrustedTypePolicyFactory;
  }
}

const TRUSTED_SCRIPT_URLS: ReadonlySet<string> = new Set([
  RAZORPAY_CHECKOUT_SCRIPT,
  TURNSTILE_SCRIPT_URL,
]);

function trustedScriptUrl(input: string): string | null {
  return TRUSTED_SCRIPT_URLS.has(input) ? input : null;
}

export function installTrustedTypesPolicy(): void {
  try {
    window.trustedTypes?.createPolicy('default', { createScriptURL: trustedScriptUrl });
  } catch {
    // An extension may have created the default policy first; reporting is
    // never worth stopping the app from starting.
  }
}
