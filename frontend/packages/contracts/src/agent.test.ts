// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test';

import { agentRequestSchemas } from './agent';

const { message } = agentRequestSchemas({
  message_max_chars: 100,
  mentions_max: 2,
  attachments_max: 3,
  attachment_max_chars: 6,
  attachments_total_max_chars: 10,
  output_title_max_chars: 10,
  output_body_max_chars: 10,
  instructions_max_chars: 10,
});

const sent = (...texts: string[]) =>
  message.safeParse({
    message: 'Import these',
    attachments: texts.map((text, index) => ({ kind: 'file', name: `f${index}.csv`, text })),
  });

describe('agent message attachments', () => {
  it('accepts attachments that together reach the total bound and refuses one character more', () => {
    expect(sent('abcdef', 'ghij').success).toBe(true);
    const over = sent('abcdef', 'ghijk');
    expect(over.success).toBe(false);
    expect(over.error?.issues.map((issue) => issue.message)).toEqual([
      'Attachments hold up to 10 characters together',
    ]);
  });
});
