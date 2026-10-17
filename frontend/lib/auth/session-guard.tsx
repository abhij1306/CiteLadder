'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { authApi } from '@/lib/api/auth';
import { humanizeApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { SessionUser } from '@/lib/api/types';
import { getBootstrapReadTimeoutMs } from '@/lib/config/operational';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { textRole } from '@/components/ui/typography';

export type SessionContextValue = {
  user: SessionUser;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Publish the resolved local user.
 *
 * `SessionGuard` loads it; this only carries the answer, so a harness can
 * mount the consumers without standing up the guard's `me` request.
 */
export function SessionProvider({
  value,
  children,
}: Readonly<{ value: SessionContextValue; children: ReactNode }>) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
type SessionFallback = ReactNode | ((content?: ReactNode) => ReactNode);

function renderSessionFallback(fallback: SessionFallback, content?: ReactNode) {
  return typeof fallback === 'function' ? fallback(content) : (content ?? fallback);
}

/**
 * SessionGuard — loads the local user (`GET /auth/me`) and publishes it.
 *
 * A self-hosted install has no sign-in, so there is nothing to redirect to:
 * while `me` loads it renders `fallback`, and a failed read explains itself
 * with a retry rather than rendering the application half-resolved.
 */
export function SessionGuard({
  children,
  fallback = null,
}: Readonly<{ children: ReactNode; fallback?: SessionFallback }>) {
  const {
    data: user,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.auth.me(),
    // Every route blocks on this read; the bounded bootstrap timeout keeps a
    // stalled connection on the notice-and-retry path.
    queryFn: ({ signal }) => authApi.me({ signal, timeoutMs: getBootstrapReadTimeoutMs() }),
  });

  const value = useMemo<SessionContextValue | null>(() => (user ? { user } : null), [user]);

  if (isLoading) return <>{renderSessionFallback(fallback)}</>;

  if (!value) {
    if (isError) {
      const notice = (
        <div className="grid min-h-[60vh] place-items-center p-[var(--page-section-gap)]">
          <Alert tone="warning" className="max-w-lg">
            <div className="grid gap-4">
              <h1 className={textRole('sectionTitle')}>CiteLadder could not reach its API</h1>
              <p>{humanizeApiError(error, 'Please try again.').message}</p>
              <Button
                variant="secondary"
                className="w-fit"
                onClick={() => void refetch()}
                pending={isFetching}
                pendingLabel="Retrying…"
              >
                Retry
              </Button>
            </div>
          </Alert>
        </div>
      );
      return <>{renderSessionFallback(fallback, notice)}</>;
    }
    return <>{renderSessionFallback(fallback)}</>;
  }

  return <SessionProvider value={value}>{children}</SessionProvider>;
}

/** Access the local user. Throws if used outside the guard. */
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a <SessionGuard>.');
  }
  return context;
}

/** Convenience accessor for just the user record. */
export function useSessionUser(): SessionUser {
  return useSession().user;
}
