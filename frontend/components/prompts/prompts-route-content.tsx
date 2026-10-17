'use client';

import { useSearchParams } from 'react-router-dom';
import { Suspense, useEffect, useState } from 'react';

import { GENERATE_PROMPTS_PARAM, REVIEW_PROMPTS_PARAM } from '@/lib/prompts/routes';

import { PromptLibrary } from './prompt-library';

function PromptsRouteSurface() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Each arrival with `generate=1` or `review=1`, including in-page navigation,
  // is one request to open the dialog in that mode. Counting it while rendering
  // records it before the effect below consumes the parameter, so a reload or
  // back navigation does not reopen the dialog.
  const [generateRequest, setGenerateRequest] = useState(0);
  const [reviewRequest, setReviewRequest] = useState(false);
  const [countedParams, setCountedParams] = useState<URLSearchParams | null>(null);
  const wantsReview = searchParams.get(REVIEW_PROMPTS_PARAM) === '1';
  if (
    (searchParams.get(GENERATE_PROMPTS_PARAM) === '1' || wantsReview) &&
    countedParams !== searchParams
  ) {
    setCountedParams(searchParams);
    setGenerateRequest((count) => count + 1);
    setReviewRequest(wantsReview);
  }
  useEffect(() => {
    if (!searchParams.has(GENERATE_PROMPTS_PARAM) && !searchParams.has(REVIEW_PROMPTS_PARAM))
      return;
    const next = new URLSearchParams(searchParams);
    next.delete(GENERATE_PROMPTS_PARAM);
    next.delete(REVIEW_PROMPTS_PARAM);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return <PromptLibrary generateRequest={generateRequest} reviewRequest={reviewRequest} />;
}

/** Shared /prompts route content: the prompt library, opened directly. */
export function PromptsRouteContent() {
  // Keep the route surface behind a Suspense boundary while it reads the URL.
  return (
    <Suspense>
      <PromptsRouteSurface />
    </Suspense>
  );
}
