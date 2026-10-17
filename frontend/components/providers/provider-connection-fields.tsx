'use client';

import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage, type useProviderConnection } from '@/lib/providers/use-provider-connection';

type ConnectionState = ReturnType<typeof useProviderConnection>;

/**
 * The bearer-key shape: one write-only field.
 */
function ApiKeyField({ state }: Readonly<{ state: ConnectionState }>) {
  const { configured, apiKey, setApiKey } = state;
  return (
    <Field label={configured ? 'API key (enter a new key to rotate)' : 'API key'}>
      {(props) => (
        <Input
          {...props}
          type="password"
          autoComplete="off"
          placeholder={configured ? '•••••••• stored' : 'Paste your API key'}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * The HTTP Basic shape: a login and a password, both required together.
 *
 * Rotation takes both halves. Replacing one half against a remembered other
 * half would leave the stored credential in a state nobody entered, so the
 * row asks for the pair every time it asks at all.
 */
function BasicAuthFields({ state }: Readonly<{ state: ConnectionState }>) {
  const { configured, apiLogin, setApiLogin, apiPassword, setApiPassword } = state;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={configured ? 'API login (enter both fields to rotate)' : 'API login'}>
        {(props) => (
          <Input
            {...props}
            type="text"
            autoComplete="off"
            placeholder={configured ? '•••••••• stored' : 'Your DataForSEO API login'}
            value={apiLogin}
            onChange={(event) => setApiLogin(event.target.value)}
          />
        )}
      </Field>
      <Field label="API password">
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="off"
            placeholder={configured ? '•••••••• stored' : 'Your DataForSEO API password'}
            value={apiPassword}
            onChange={(event) => setApiPassword(event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}

/**
 * Shared BYOK credential fields + save/test feedback for one provider
 * credential — the presentation half of `useProviderConnection`.
 *
 * Two credential shapes are supported because two auth schemes are: a bearer
 * key, and an HTTP Basic login/password pair. Both stay write-only (never
 * pre-filled — the stored secret is never on the wire); this component is the
 * single home for that invariant's copy.
 */
export function ProviderConnectionFields({
  state,
}: Readonly<{
  state: ConnectionState;
}>) {
  const { credentialShape, saveMutation, testResult } = state;

  return (
    <>
      {credentialShape === 'basic' ? (
        <BasicAuthFields state={state} />
      ) : (
        <ApiKeyField state={state} />
      )}

      {saveMutation.isError ? (
        <Alert tone="danger">{errorMessage(saveMutation.error)}</Alert>
      ) : null}

      {testResult ? (
        <Alert tone={testResult.status === 'ok' ? 'success' : 'danger'}>{testResult.message}</Alert>
      ) : null}
    </>
  );
}
