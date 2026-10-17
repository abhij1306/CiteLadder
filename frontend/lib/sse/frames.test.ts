import { describe, expect, it } from 'vite-plus/test';

import { parseSseFrame, splitSseFrames } from './frames';

describe('SSE frame mechanics', () => {
  it('keeps a chunk-split frame buffered until its delimiter arrives', () => {
    const first = splitSseFrames('id: evt-1\ndata: {"event_');
    expect(first.frames).toEqual([]);

    const second = splitSseFrames(`${first.rest}type":"crawl.status"}\n\n`);
    expect(second.rest).toBe('');
    expect(second.frames).toHaveLength(1);
    expect(parseSseFrame(second.frames[0]!)).toEqual({
      id: 'evt-1',
      event: null,
      data: '{"event_type":"crawl.status"}',
    });
  });

  it('retains multiple data lines and ignores keep-alive comments', () => {
    expect(parseSseFrame(': ping\nevent: update\ndata: first\ndata: second')).toEqual({
      id: null,
      event: 'update',
      data: 'first\nsecond',
    });
  });
});
