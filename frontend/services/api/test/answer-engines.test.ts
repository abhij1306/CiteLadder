import { describe, expect, it } from 'vitest';
import { providerPolicy, providerSettings } from '../src/providers/config.ts';
import { answerRequestSchema, type AnswerRequest } from '../src/answer-engines/contracts.ts';
import { answerPayload, executeAnswer } from '../src/answer-engines/execute.ts';
import { parseAnswer, usageCount } from '../src/answer-engines/parse.ts';
import { scoreExecution, scoringConfig } from '../src/analysis/scoring.ts';

function request(engine: 'chatgpt' | 'gemini' | 'claude', retrieval = true): AnswerRequest {
  const route = providerPolicy.routes[engine];
  return answerRequestSchema.parse({
    logical_engine: engine,
    transport_provider: route.transport_provider,
    transport_model: route.transport_model,
    prompt: 'Which options fit a small team?',
    system_instruction: 'Answer neutrally.',
    retrieval_enabled: retrieval,
    max_output_tokens: 512,
    timeout_seconds: 1,
    reasoning_effort: route.reasoning_effort,
    anthropic_thinking: route.anthropic_thinking,
    country_code: 'AU',
    anthropic_max_uses: 0,
    openai_max_tool_calls: 0,
  });
}
describe('frozen answer-engine execution', () => {
  it('returns only a safe code for a permanent provider error body', async () => {
    const error = await executeAnswer(
      request('claude'),
      { secret: 'test-secret', base_url: '' },
      providerSettings({}),
      async () =>
        Response.json(
          { error: { message: 'private-provider-message', key: 'private-key' } },
          { status: 400 },
        ),
    ).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'client_error', retryable: false });
    expect(String(error)).not.toContain('private-provider-message');
    expect(String(error)).not.toContain('private-key');
  });
  it.each([undefined, { query: 'Acme options' }])(
    'keeps count-only OpenAI searches distinct from query text (%j)',
    (action) => {
      const result = parseAnswer(
        { status: 'completed', output: [{ type: 'web_search_call', action }] },
        request('chatgpt'),
      );
      const score = scoreExecution({
        config: scoringConfig({ brand_name: 'Acme' }),
        answerText: result.answer_text,
        promptText: 'Which options fit?',
        citations: result.citations,
        searchEvents: result.search_events,
        searchUsed: result.search_used,
        queryTextAvailable: Boolean(result.provider_metadata.query_text_available),
      });
      expect(score.search_query_text_available).toBe(Boolean(action));
      expect(score.brand_injected_in_search).toBe(action ? true : null);
    },
  );
  it.each([500, 502, 503, 504, 501, 505, 507])(
    'only retries transient HTTP %s failures',
    async (status) => {
      await expect(
        executeAnswer(
          request('chatgpt'),
          { secret: 'test', base_url: '' },
          providerSettings({}),
          async () => new Response('', { status }),
        ),
      ).rejects.toMatchObject({
        code: 'server_error',
        retryable: [500, 502, 503, 504].includes(status),
      });
    },
  );
  it.each([
    ['off', { effort: 'none' }],
    ['low', { effort: 'low' }],
    ['unrecorded', undefined],
  ])('sends OpenAI reasoning effort %s as the model accepts it', (effort, reasoning) => {
    const body = answerPayload({ ...request('chatgpt'), reasoning_effort: effort });
    expect(body.reasoning).toEqual(reasoning);
  });
  it.each([
    ['between_tools', 'low', { type: 'between_tools' }, { effort: 'low' }],
    ['disabled', 'high', { type: 'disabled' }, { effort: 'high' }],
    [null, 'unrecorded', undefined, undefined],
  ] as const)(
    'sends Anthropic thinking %s at effort %s within the frozen output budget',
    (thinking, effort, sentThinking, sentConfig) => {
      const body = answerPayload({
        ...request('claude'),
        anthropic_thinking: thinking,
        reasoning_effort: effort,
      });
      expect(body.max_tokens).toBe(512);
      expect(body.thinking).toEqual(sentThinking);
      expect(body.output_config).toEqual(sentConfig);
    },
  );
  it.each([
    [
      'claude',
      {
        stop_reason: 'max_tokens',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'server_tool_use', name: 'web_search', input: { query: 'options' } },
          { type: 'web_search_tool_result', content: [] },
        ],
        usage: { input_tokens: 900, output_tokens: 856 },
      },
      { code: 'truncated_before_answer', retryable: true },
    ],
    [
      'chatgpt',
      {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{ type: 'reasoning', text: 'private-reasoning' }],
      },
      { code: 'truncated_before_answer', retryable: true },
    ],
    [
      'gemini',
      { finish_reason: 'MAX_TOKENS', steps: [] },
      { code: 'truncated_before_answer', retryable: true },
    ],
    [
      'claude',
      { stop_reason: 'refusal', content: [] },
      { code: 'content_filter', retryable: false },
    ],
    [
      'chatgpt',
      {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help.' }] }],
      },
      { code: 'content_filter', retryable: false },
    ],
    [
      'claude',
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '  ' }] },
      { code: 'empty_answer', retryable: true },
    ],
  ] as const)(
    'fails a %s exchange with no answer text instead of returning an observation (%j)',
    async (engine, payload, failure) => {
      await expect(
        executeAnswer(
          request(engine),
          { secret: 'test-secret', base_url: '' },
          providerSettings({}),
          async () => Response.json(payload),
        ),
      ).rejects.toMatchObject(failure);
    },
  );
  it('keeps non-empty text cut off by the budget as an observation with its finish reason', async () => {
    const result = await executeAnswer(
      request('claude'),
      { secret: 'test-secret', base_url: '' },
      providerSettings({}),
      async () =>
        Response.json({
          stop_reason: 'max_tokens',
          content: [{ type: 'text', text: 'Acme Running suits' }],
        }),
    );
    expect(result).toMatchObject({
      answer_text: 'Acme Running suits',
      finish_reason: 'length',
      raw_finish_reason: 'max_tokens',
    });
  });
  it.each([
    [1, 1],
    [0, undefined],
  ])('caps OpenAI search rounds at %s', (cap, sent) => {
    const body = answerPayload({ ...request('chatgpt'), openai_max_tool_calls: cap });
    expect(body.max_tool_calls).toBe(sent);
  });
  it('rejects a negative OpenAI search-round cap at configuration', () => {
    expect(() => providerSettings({ PROVIDER_OPENAI_MAX_TOOL_CALLS: '-1' })).toThrow(/>= 0/);
    expect(providerSettings({ PROVIDER_OPENAI_MAX_TOOL_CALLS: '0' }).openaiMaxToolCalls).toBe(0);
  });
  it('records an OpenAI query repeated as both query and queries once', () => {
    const result = parseAnswer(
      {
        status: 'completed',
        output: [
          {
            type: 'web_search_call',
            id: 's1',
            action: { query: 'golf nets', queries: ['golf nets', 'net reviews'] },
          },
          { type: 'web_search_call', id: 's2', action: { query: 'only query' } },
        ],
      },
      request('chatgpt'),
    );
    expect(result.search_events.map((event) => [event.query, event.query_sequence])).toEqual([
      ['golf nets', 0],
      ['net reviews', 1],
      ['only query', 0],
    ]);
  });
  it.each(['chatgpt', 'gemini', 'claude'] as const)(
    'runs %s with fresh policy and no tools when retrieval is off',
    async (engine) => {
      const input = request(engine, false);
      const body = answerPayload(input);
      expect(body).not.toHaveProperty('tools');
      expect(body).not.toHaveProperty('previous_response_id');
      expect(body).not.toHaveProperty('previous_interaction_id');
      let calls = 0;
      const send: typeof fetch = async (_url, options) => {
        calls++;
        expect(options?.redirect).toBe('error');
        expect(JSON.parse(String(options?.body))).toEqual(body);
        return Response.json(
          engine === 'chatgpt'
            ? {
                status: 'completed',
                output: [{ type: 'message', content: [{ type: 'output_text', text: 'Answer.' }] }],
              }
            : engine === 'gemini'
              ? {
                  finish_reason: 'STOP',
                  steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Answer.' }] }],
                }
              : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Answer.' }] },
        );
      };
      const result = await executeAnswer(
        input,
        { secret: 'test-secret', base_url: '' },
        providerSettings({}),
        send,
      );
      expect(result).toMatchObject({
        answer_text: 'Answer.',
        finish_reason: 'stop',
        search_used: false,
      });
      expect(result.normalized_usage.output_tokens).toBeNull();
      expect(calls).toBe(1);
    },
  );

  it('keeps OpenAI calls grouped, offsets exact and reasoning content excluded', () => {
    const result = parseAnswer(
      {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [
          { type: 'reasoning', text: 'private-reasoning' },
          { type: 'web_search_call', id: 's1', action: { queries: ['first', 'second'] } },
          { type: 'web_search_call', id: 's2' },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: '😀 Brand choice',
                annotations: [
                  {
                    type: 'url_citation',
                    url: 'https://www.publisher.example/page',
                    start_index: 2,
                    end_index: 7,
                  },
                  {
                    type: 'url_citation',
                    url: 'https://publisher.example/other',
                    start_index: 1,
                    end_index: 999,
                  },
                ],
              },
            ],
          },
        ],
        usage: {
          input_tokens: 40,
          input_tokens_details: { cached_tokens: 10 },
          output_tokens: 30,
          output_tokens_details: { reasoning_tokens: 7 },
        },
      },
      request('chatgpt'),
    );
    expect(result).toMatchObject({
      finish_reason: 'length',
      normalized_usage: {
        uncached_input_tokens: 30,
        cached_input_tokens: 10,
        output_tokens: 23,
        reasoning_tokens: 7,
        total_tokens: 70,
        web_search_requests: 2,
      },
    });
    expect(result.search_events.map((event) => [event.query, event.call_sequence])).toEqual([
      ['first', 0],
      ['second', 0],
      ['', 1],
    ]);
    expect(result.citations[0]?.cited_text).toBe('Brand');
    expect(result.citations[1]).toMatchObject({
      start_index: null,
      end_index: null,
      cited_text: '',
    });
    expect(JSON.stringify(result)).not.toContain('private-reasoning');
  });

  it('records what each engine read apart from what it cited, and unknown where unexposed', () => {
    const openai = parseAnswer(
      {
        status: 'completed',
        output: [
          {
            type: 'web_search_call',
            action: {
              query: 'options',
              sources: [
                { type: 'url', url: 'https://www.acme.example/pricing' },
                { type: 'url', url: 'https://rival.example/' },
                { type: 'url', url: 'https://www.acme.example/pricing' },
              ],
            },
          },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Rival',
                annotations: [{ type: 'url_citation', url: 'https://rival.example/' }],
              },
            ],
          },
        ],
      },
      request('chatgpt'),
    );
    expect(openai.retrieved_sources).toEqual([
      { ordinal: 0, url: 'https://www.acme.example/pricing', title: '', domain: 'acme.example' },
      { ordinal: 1, url: 'https://rival.example/', title: '', domain: 'rival.example' },
    ]);
    expect(openai.citations.map((citation) => citation.url)).toEqual(['https://rival.example/']);
    const claude = parseAnswer(
      {
        content: [
          {
            type: 'web_search_tool_result',
            content: [
              { type: 'web_search_result', url: 'https://acme.example/a', title: 'Acme A' },
            ],
          },
          { type: 'text', text: 'Answer' },
        ],
      },
      request('claude'),
    );
    expect(claude.retrieved_sources).toEqual([
      { ordinal: 0, url: 'https://acme.example/a', title: 'Acme A', domain: 'acme.example' },
    ]);
    expect(claude.citations).toEqual([]);
    const gemini = parseAnswer({ steps: [] }, request('gemini'));
    expect(gemini.retrieved_sources).toBeNull();
    expect(answerPayload(request('chatgpt'))).toMatchObject({
      include: ['web_search_call.action.sources'],
    });
  });

  it('keeps Google redirect identity and counts calls even without usable queries', () => {
    const result = parseAnswer(
      {
        finishReason: 'SAFETY',
        steps: [
          { type: 'thought', signature: 'private-signature', content: 'private-thought' },
          { type: 'google_search_call', arguments: { queries: 'malformed' } },
          {
            type: 'model_output',
            content: [
              {
                type: 'text',
                text: 'Brand is an option.',
                annotations: [
                  {
                    type: 'url_citation',
                    url: 'https://vertexaisearch.cloud.google.com/token',
                    title: 'www.publisher.example',
                    startIndex: 0,
                    endIndex: 5,
                  },
                ],
              },
            ],
          },
        ],
        usage: {
          promptTokenCount: 'bad',
          prompt_token_count: 99,
          candidatesTokenCount: 0,
          thoughtsTokenCount: 4,
        },
      },
      request('gemini'),
    );
    expect(result).toMatchObject({
      finish_reason: 'content_filter',
      search_used: true,
      search_events: [],
      normalized_usage: {
        uncached_input_tokens: null,
        output_tokens: 0,
        reasoning_tokens: 4,
        web_search_requests: 1,
      },
    });
    expect(result.citations[0]).toMatchObject({
      domain: 'publisher.example',
      cited_text: 'Brand',
      url: 'https://vertexaisearch.cloud.google.com/token',
    });
    expect(JSON.stringify(result)).not.toContain('private-');
  });

  it('includes Anthropic cache writes and honors reported zero search activity', () => {
    const result = parseAnswer(
      {
        stop_reason: 'pause_turn',
        content: [
          { type: 'server_tool_use', name: 'web_search', input: { query: 'options' } },
          {
            type: 'text',
            text: 'Answer',
            citations: [
              {
                type: 'web_search_result_location',
                url: 'https://publisher.example/',
                cited_text: ' Evidence ',
                start_index: 0,
                end_index: 6,
              },
            ],
          },
        ],
        usage: {
          input_tokens: 10,
          cacheCreationInputTokens: 5,
          cacheReadInputTokens: 20,
          output_tokens: 7,
          server_tool_use: { web_search_requests: 0 },
        },
      },
      request('claude'),
    );
    expect(result).toMatchObject({
      finish_reason: 'unknown',
      search_used: false,
      normalized_usage: {
        uncached_input_tokens: 15,
        cached_input_tokens: 20,
        total_tokens: 42,
        reasoning_tokens: null,
      },
    });
    expect(result.citations[0]).toMatchObject({
      cited_text: ' Evidence ',
      start_index: null,
      end_index: null,
    });
  });

  it('leaves retryable HTTP and embedded search errors to the queue without echoing bodies', async () => {
    let calls = 0;
    const send: typeof fetch = async () => {
      calls++;
      return Response.json(
        { secret: 'must-not-echo' },
        { status: 429, headers: { 'retry-after': '3' } },
      );
    };
    await expect(
      executeAnswer(
        request('claude'),
        { secret: 'test-secret', base_url: '' },
        providerSettings({}),
        send,
      ),
    ).rejects.toMatchObject({ code: 'rate_limit', retryable: true, retryAfterSeconds: 3 });
    expect(calls).toBe(1);
    await expect(
      executeAnswer(
        request('claude'),
        { secret: 'test-secret', base_url: '' },
        providerSettings({}),
        async () =>
          Response.json({
            content: [
              {
                type: 'web_search_tool_result',
                content: {
                  type: 'web_search_tool_result_error',
                  error_code: 'unavailable',
                },
              },
            ],
          }),
      ),
    ).rejects.toMatchObject({ code: 'server_error', retryable: true });
  });

  it('cancels an oversized successful response and reports only the safe parser error', async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"private":"secret"}'));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    await expect(
      executeAnswer(
        request('claude'),
        { secret: 'test-secret', base_url: '' },
        { ...providerSettings({}), maxResponseBytes: 4 },
        async () => response,
      ),
    ).rejects.toMatchObject({ code: 'parse_error', retryable: false });
    expect(cancelled).toBe(true);
  });

  it.each([true, -1, 1.5, '', '1.5', 'NaN', {}, null])(
    'keeps malformed usage %j unknown',
    (value) => {
      expect(usageCount(value)).toBeNull();
    },
  );
});
