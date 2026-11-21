import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { SetupPage, SetupStep } from './setup-page';

describe('SetupPage', () => {
  it('names the current step in its stepper and counts it against the whole setup', () => {
    render(
      <SetupPage label="Project setup" steps={['Basics', 'Research', 'Confirm']} current={1}>
        <SetupStep title="Finding what to track" next={<button type="button">Review</button>}>
          steps
        </SetupStep>
      </SetupPage>,
    );

    const progress = screen.getByRole('region', { name: 'Setup progress' });
    expect(progress).toHaveTextContent('Step 2 of 3');
    expect(within(progress).getByRole('progressbar', { name: 'Research' })).toHaveAttribute(
      'value',
      '2',
    );
    const stepItems = within(progress).getAllByRole('listitem');
    expect(stepItems.map((item) => item.textContent)).toEqual(['Basics', '2Research', '3Confirm']);
    expect(stepItems[1]).toHaveAttribute('aria-current', 'step');
    expect(stepItems[0]).not.toHaveAttribute('aria-current');

    const main = screen.getByRole('main', { name: 'Project setup' });
    expect(within(main).getByRole('region', { name: 'Finding what to track' })).toHaveTextContent(
      'steps',
    );
    expect(within(main).getByRole('button', { name: 'Review' })).toBeVisible();
    expect(document.title).toBe('Finding what to track · CiteLadder');
  });

  it('leaves the stepper out of a one-screen setup', () => {
    render(
      <SetupPage label="Workspace setup">
        <SetupStep title="Set up your workspace">name</SetupStep>
      </SetupPage>,
    );

    expect(screen.queryByRole('region', { name: 'Setup progress' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Set up your workspace' })).toHaveTextContent('name');
  });
});
