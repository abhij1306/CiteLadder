import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { ScrollFrame } from './scroll-edges';

describe('ScrollFrame row', () => {
  it('cues each edge that hides more, the start only once scrolled from it', () => {
    const { container } = render(
      <ScrollFrame>
        {(ref, region) => (
          <div ref={ref} {...region}>
            <span>Tabs</span>
          </div>
        )}
      </ScrollFrame>,
    );
    const content = container.querySelector<HTMLElement>('[data-scroll-content]')!;
    const frame = container.querySelector<HTMLElement>('[data-scroll-frame]')!;
    const cues = () => ({
      fades: (['start', 'end'] as const).filter((edge) =>
        frame.hasAttribute(`data-scroll-${edge}`),
      ),
      steps: [...container.querySelectorAll('[data-scroll-step]')].map((step) =>
        step.getAttribute('data-scroll-step'),
      ),
    });
    const layout = (scrollWidth: number, scrollLeft: number) => {
      Object.defineProperty(content, 'clientWidth', { configurable: true, value: 300 });
      Object.defineProperty(content, 'scrollWidth', { configurable: true, value: scrollWidth });
      Object.defineProperty(content, 'scrollLeft', { configurable: true, value: scrollLeft });
      fireEvent.scroll(content);
    };

    layout(300, 0);
    expect(cues()).toEqual({ fades: [], steps: [] });
    layout(600, 0);
    expect(cues()).toEqual({ fades: ['end'], steps: ['end'] });
    layout(600, 120);
    expect(cues()).toEqual({ fades: ['start', 'end'], steps: ['start', 'end'] });
    layout(600, 300);
    expect(cues()).toEqual({ fades: ['start'], steps: ['start'] });
  });
});
