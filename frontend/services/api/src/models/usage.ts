/** OpenAI-compatible usage under the gateway's own names; an invalid count is unknown (null). */
export function normalizedUsage(raw: Record<string, unknown> | undefined) {
  const usage: Record<string, number | null> = {};
  const nested = (name: string, field: string) => {
    const details = raw?.[name];
    return details && typeof details === 'object' ? Reflect.get(details, field) : undefined;
  };
  const fallback: Record<string, unknown> = {
    cached_input_tokens: nested('prompt_tokens_details', 'cached_tokens'),
    reasoning_tokens: nested('completion_tokens_details', 'reasoning_tokens'),
  };
  for (const [target, aliases] of Object.entries({
    input_tokens: ['input_tokens', 'prompt_tokens'],
    output_tokens: ['output_tokens', 'completion_tokens'],
    total_tokens: ['total_tokens'],
    cached_input_tokens: ['cached_input_tokens'],
    reasoning_tokens: ['reasoning_tokens'],
  })) {
    const alias = aliases.find((name) => raw && Object.hasOwn(raw, name));
    const value = alias ? raw?.[alias] : fallback[target];
    if (value !== undefined)
      usage[target] =
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  return usage;
}
