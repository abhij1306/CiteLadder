import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import type { ModelProvenance } from '@citeladder/contracts';

import { MeasurementContext } from './measurement-context';

function provenance(model: string): ModelProvenance {
  return {
    logical_engine: 'gemini',
    transport_provider: 'google',
    transport_model: model,
  } as ModelProvenance;
}

describe('MeasurementContext', () => {
  it('names the single model when provenance carries exactly one', () => {
    render(<MeasurementContext provenance={[provenance('gemini-2.5-pro')]} />);

    expect(screen.getByText('gemini-2.5-pro')).toBeVisible();
    expect(screen.queryByText(/Multiple models/)).not.toBeInTheDocument();
  });

  it('collapses repeated routes on the same model to a singular surface', () => {
    render(
      <MeasurementContext
        provenance={[
          provenance('gemini-2.5-pro'),
          provenance('gemini-2.5-pro'),
          provenance('gemini-2.5-pro'),
        ]}
      />,
    );

    expect(screen.getByText('gemini-2.5-pro')).toBeVisible();
    expect(screen.queryByText(/Multiple models/)).not.toBeInTheDocument();
  });

  it('refuses to elect a representative model for an aggregate', () => {
    render(
      <MeasurementContext
        provenance={[provenance('gemini-2.5-pro'), provenance('claude-4.5-sonnet')]}
      />,
    );

    expect(screen.getByText('Multiple models (2)')).toBeVisible();
    expect(screen.queryByText('gemini-2.5-pro')).not.toBeInTheDocument();
    expect(screen.queryByText('claude-4.5-sonnet')).not.toBeInTheDocument();
  });

  it('still lists the aggregate’s models for anyone who needs them', () => {
    render(
      <MeasurementContext
        provenance={[provenance('gemini-2.5-pro'), provenance('claude-4.5-sonnet')]}
      />,
    );

    expect(screen.getByText('Multiple models (2)')).toHaveAttribute(
      'title',
      'gemini-2.5-pro, claude-4.5-sonnet',
    );
  });

  it('ignores provenance rows with no recorded model', () => {
    render(<MeasurementContext provenance={[provenance('gemini-2.5-pro'), provenance('')]} />);

    expect(screen.getByText('gemini-2.5-pro')).toBeVisible();
    expect(screen.queryByText(/Multiple models/)).not.toBeInTheDocument();
  });

  it('says the model is not recorded when provenance is empty', () => {
    render(<MeasurementContext provenance={[]} />);

    expect(screen.getByText('Model not recorded')).toBeVisible();
  });
});
