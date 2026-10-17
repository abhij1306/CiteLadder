import { render as renderInDocument, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vite-plus/test';

import { FlowGroup, FlowShell } from './flow-shell';

/** The flow bar's logo links home, so the shell renders inside a router. */
function render(ui: ReactElement) {
  return renderInDocument(<MemoryRouter>{ui}</MemoryRouter>);
}

const steps = [
  { id: 'brand', label: 'Basics' },
  { id: 'research', label: 'Research' },
  { id: 'confirm', label: 'Confirm' },
] as const;

describe('FlowShell', () => {
  it('labels the main landmark and announces the current setup step once', () => {
    render(
      <FlowShell mainLabel="Project setup" steps={steps} currentStep={1}>
        <h1 className="flow-title">Finding what to track</h1>
      </FlowShell>,
    );

    expect(screen.getByRole('main', { name: 'Project setup' })).toBeVisible();
    const progress = screen.getByRole('navigation', { name: 'Setup progress' });
    const current = within(progress).getByRole('listitem', { current: 'step' });
    expect(current).toHaveTextContent('Research');
    expect(progress.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('renders a labelled group with its heading, help, and meta copy', () => {
    render(
      <FlowGroup title="Your websites" help="Auto-verified from your domain." meta="1 of 1">
        <span>example.com</span>
      </FlowGroup>,
    );

    const group = screen.getByRole('region', { name: 'Your websites' });
    const heading = within(group).getByRole('heading', { level: 2, name: 'Your websites' });
    expect(group).toHaveAttribute('aria-labelledby', heading.id);
    expect(within(group).getByText('Auto-verified from your domain.')).toBeInTheDocument();
    expect(within(group).getByText('1 of 1')).toBeInTheDocument();
  });
});
