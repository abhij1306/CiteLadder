import { useMutation } from '@tanstack/react-query';

import { useRequestKey } from '@/lib/agent/idempotency';
import { commerceMutations } from '@/lib/api/commerce';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import type { BuyerPromptGenerateRequest } from '@citeladder/contracts/commerce-requests';
import type { BuyerPrompt } from '@citeladder/contracts/commerce-suite';

/**
 * Metered shopping-prompt generation. A retry of the same request after a
 * failure reuses its idempotency key, so prompts the server already generated
 * (and charged for) are replayed instead of generated again; a success retires
 * the key.
 */
export function useGenerateBuyerPrompts(scope: ProjectScope) {
  const mutation = useMutation(commerceMutations.generateBuyerPrompts(scope));
  const requestKey = useRequestKey();
  const generate = (
    input: BuyerPromptGenerateRequest,
    onSuccess?: (created: readonly BuyerPrompt[]) => void,
  ) =>
    mutation.mutate(
      { input, idempotencyKey: requestKey.keyFor(input) },
      {
        onSuccess: (created) => {
          requestKey.accepted();
          onSuccess?.(created);
        },
      },
    );
  return { generate, mutation };
}
