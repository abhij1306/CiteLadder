import { describe, expect, it } from 'vite-plus/test';

import { slowInteractionReport, type AnimationFrame, type Interaction } from './interaction-timing';

const button = document.createElement('button');
button.textContent = 'Send to jane@example.com';

const interaction: Interaction = {
  name: 'click',
  startTime: 1000,
  duration: 320,
  processingStart: 1030,
  processingEnd: 1250,
  interactionId: 7,
  target: button,
};

const frame = (startTime: number, scripts: AnimationFrame['scripts']): AnimationFrame => ({
  startTime,
  duration: 120,
  scripts,
});

const script = (sourceURL: string, invoker: string, duration: number) => ({
  sourceURL,
  invoker,
  duration,
});

describe('slowInteractionReport', () => {
  it('names the phases and the longest scripts in overlapping frames, without text or query strings', () => {
    const frames = [
      frame(700, [script('https://app.test/app-assets/early.js', 'Window.setTimeout', 400)]),
      frame(1010, [
        script('https://app.test/app-assets/chat-a1.js?v=2', 'BUTTON#send.onclick', 180.4),
        script('https://checkout.razorpay.com/v1/checkout.js', 'Response.json.then', 12),
      ]),
      frame(1200, [
        script('https://app.test/app-assets/list-b2.js', 'Promise.then', 60),
        script('', 'IntersectionObserver.callback', 30),
      ]),
      frame(1400, [
        script('https://app.test/app-assets/late.js', 'Window.requestAnimationFrame', 90),
      ]),
    ];

    expect(
      slowInteractionReport({ interaction, frames, route: '/agent', release: 'abc123' }),
    ).toEqual({
      kind: 'slow_interaction',
      route: '/agent',
      release: 'abc123',
      event: 'click',
      target: 'button',
      duration_ms: 320,
      input_delay_ms: 30,
      processing_ms: 220,
      presentation_ms: 70,
      scripts: [
        {
          source: 'https://app.test/app-assets/chat-a1.js',
          invoker: 'BUTTON#send.onclick',
          duration_ms: 180,
        },
        {
          source: 'https://app.test/app-assets/list-b2.js',
          invoker: 'Promise.then',
          duration_ms: 60,
        },
        { source: '', invoker: 'IntersectionObserver.callback', duration_ms: 30 },
      ],
    });
  });

  it('reports nothing for an interaction under the slow limit', () => {
    const quick = { ...interaction, duration: 199 };
    expect(
      slowInteractionReport({ interaction: quick, frames: [], route: '/agent', release: 'abc' }),
    ).toBeNull();
    expect(
      slowInteractionReport({
        interaction: { ...quick, duration: 200 },
        frames: [],
        route: '/agent',
        release: 'abc',
      })?.duration_ms,
    ).toBe(200);
  });
});
