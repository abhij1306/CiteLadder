import { useMutation } from '@tanstack/react-query';

import { useRequestKey } from '@/lib/agent/idempotency';
import { commerceMutations } from '@/lib/api/commerce';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import type { BuyerPromptGenerateRequest } from '@citeladder/contracts/commerce-requests';
import type { BuyerPrompt } from '@citeladder/contracts/commerce-suite';

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
