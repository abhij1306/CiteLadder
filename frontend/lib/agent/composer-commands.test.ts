import { describe, expect, it } from 'vite-plus/test';

import {
  actionLinks,
  applyOption,
  matchOptions,
  tokenAt,
  withLinkMentions,
} from './composer-commands';

describe('composer commands', () => {
  it('finds a command token only at a word start before the caret', () => {
    expect(tokenAt('/gro', 4)).toEqual({ trigger: '/', query: 'gro', start: 0, end: 4 });
    expect(tokenAt('Compare @pric', 13)).toEqual({
      trigger: '@',
      query: 'pric',
      start: 8,
      end: 13,
    });
    expect(tokenAt('see https://acme.example/pricing', 32)).toBeNull();
    expect(tokenAt('mail me@acme', 12)).toBeNull();
  });

  it('replaces the token and places the caret after the insertion', () => {
    const text = 'Compare @pric with last month';
    const token = tokenAt(text, 13)!;

    expect(
      applyOption(text, token, { key: 'a', label: 'Pricing', replacement: '@Pricing' }),
    ).toEqual({ text: 'Compare @Pricing with last month', caret: 17 });
    expect(
      applyOption('/gro', tokenAt('/gro', 4)!, { key: 's', label: 'Growth', replacement: '' }),
    ).toEqual({ text: '', caret: 0 });
  });

  it('matches every query word against label and detail', () => {
    const options = [
      { key: '1', label: 'Pricing page', detail: 'Page edits', replacement: '' },
      { key: '2', label: 'Blog hub', detail: 'Internal links', replacement: '' },
    ];

    expect(matchOptions(options, 'page edit').map((option) => option.key)).toEqual(['1']);
    expect(matchOptions(options, '').map((option) => option.key)).toEqual(['1', '2']);
  });
});

describe('pasted Action links', () => {
  const origin = 'https://app.citeladder.com';
  const projectId = '11111111-1111-4111-8111-111111111111';
  const ACTION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ACTION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const link = (id: string, project = projectId) => `${origin}/actions/${id}?project=${project}`;

  it('finds links to this project’s Action pages on this origin, once each', () => {
    const text = [
      `Find (${link(ACTION_A)}).`,
      `again ${link(ACTION_A)}`,
      `${origin}/actions/${ACTION_B.toUpperCase()}`,
      `${link(ACTION_B, '22222222-2222-4222-8222-222222222222')}`,
      `https://evil.example/actions/${ACTION_B}`,
      `${origin}/agent/chats/${ACTION_B}`,
    ].join(' ');

    expect(actionLinks(text, { origin, projectId })).toEqual([
      { url: link(ACTION_A), actionId: ACTION_A },
      { url: `${origin}/actions/${ACTION_B.toUpperCase()}`, actionId: ACTION_B },
    ]);
  });

  it('replaces resolved links with @label and adds mentions up to the bound', () => {
    const a = { id: ACTION_A, label: 'School uniform shops' };
    const b = { id: ACTION_B, label: 'Returns policy' };
    const text = `Find ${link(ACTION_A)} and ${link(ACTION_B)}`;
    const resolved = [
      { url: link(ACTION_A), mention: a },
      { url: link(ACTION_B), mention: b },
    ];

    expect(withLinkMentions({ text, mentions: [], resolved, max: 5 })).toEqual({
      text: 'Find @School uniform shops and @Returns policy',
      mentions: [a, b],
    });
    expect(withLinkMentions({ text, mentions: [a], resolved, max: 1 })).toEqual({
      text: `Find @School uniform shops and ${link(ACTION_B)}`,
      mentions: [a],
    });
    expect(withLinkMentions({ text: 'Find it', mentions: [], resolved, max: 5 })).toEqual({
      text: 'Find it',
      mentions: [],
    });
  });
});
