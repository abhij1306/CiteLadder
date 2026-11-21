import { render } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';

import { Plus } from '@/lib/icons';

import { Button } from './button';

it('warns about a quiet button only when it carries no glyph', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  render(
    <Button variant="quiet">
      <Plus />
      Add
    </Button>,
  );
  render(<Button variant="quiet">Bare</Button>);
  expect(warn.mock.calls).toEqual([
    ['Quiet button "Bare" has no icon: give it one, or make it secondary.'],
  ]);
  warn.mockRestore();
});
