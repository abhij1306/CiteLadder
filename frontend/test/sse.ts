/**
 * A one-shot SSE body for the reconnect tests.
 *
 * `use-run-events` and `use-crawl-events` each hand-rolled this identical
 * ReadableStream helper under a different name. Both hooks consume the same
 * `fetch`-based event stream, so they get the same builder.
 */
export function makeStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: true, body } as unknown as Response;
}
