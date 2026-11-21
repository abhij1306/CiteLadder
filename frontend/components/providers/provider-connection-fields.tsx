import { AppGrid } from '@/components/ui/app-grid';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import type { useProviderConnection } from '@/lib/providers/use-provider-connection';
import { Notice } from '@/components/ui/notice';

type ConnectionState = ReturnType<typeof useProviderConnection>;

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

function BasicAuthFields({ state }: Readonly<{ state: ConnectionState }>) {
  const { configured, apiLogin, setApiLogin, apiPassword, setApiPassword } = state;
  return (
    <AppGrid layout="halves">
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
    </AppGrid>
  );
}

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
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(saveMutation.error, { action: 'save the connection' })}
        />
      ) : null}

      {testResult ? (
        <Notice tone={testResult.status === 'ok' ? 'positive' : 'negative'}>
          {testResult.message}
        </Notice>
      ) : null}
    </>
  );
}
