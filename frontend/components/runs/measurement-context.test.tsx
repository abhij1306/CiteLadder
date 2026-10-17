import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import type { ModelProvenance } from '@/lib/api/types';

import { MeasurementContext } from './measurement-context';

/**
 * The measurement conditions behind a figure. Three distinctions carry weight,
 * and all three are the kind a careless badge collapses:
 *
 * - An AGGREGATE spanning several models must not elect one to stand in for
 *   the rest, which would attribute every number in it to a model that
 *   produced only some of them.
 * - `null` retrieval means "unrecorded" (the run predates the frozen policy
 *   block), which is not the same as "off".
 * - A missing model says so, rather than rendering an empty badge.
 */
function provenance(model: string): ModelProvenance {
  return {
    logical_engine: 'gemini',
    transport_provider: 'google',
    transport_model: model,
  } as ModelProvenance;
}

describe('MeasurementContext', () => {
  it('names the one exact model on a singular surface', () => {
    render(<MeasurementContext model="gemini-2.5-pro" retrieval />);

    expect(screen.getByText('gemini-2.5-pro')).toBeVisible();
  });

  it('says the model is not recorded rather than rendering an empty badge', () => {
    render(<MeasurementContext model={null} />);

    expect(screen.getByText('Model not recorded')).toBeVisible();
  });

  it('names the single model when provenance carries exactly one', () => {
    render(<MeasurementContext provenance={[provenance('gemini-2.5-pro')]} />);

    expect(screen.getByText('gemini-2.5-pro')).toBeVisible();
    expect(screen.queryByText(/Multiple models/)).not.toBeInTheDocument();
  });

  it('collapses repeated routes on the same model to a singular surface', () => {
    // Three executions on one model is still one model; "Multiple models (1)"
    // would be nonsense.
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

    // Showing either name here would attribute the whole aggregate to a model
    // that produced only half of it.
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

  it('falls back to "not recorded" when provenance is empty', () => {
    render(<MeasurementContext provenance={[]} />);

    expect(screen.getByText('Model not recorded')).toBeVisible();
  });

  it('prefers an explicit model over provenance on a singular surface', () => {
    render(<MeasurementContext model="gpt-5.5" provenance={[provenance('gemini-2.5-pro')]} />);

    expect(screen.getByText('gpt-5.5')).toBeVisible();
  });

  it.each([
    [true, 'Retrieval on'],
    [false, 'Retrieval off'],
  ])('states retrieval %s explicitly', (retrieval, label) => {
    render(<MeasurementContext model="gemini-2.5-pro" retrieval={retrieval as boolean} />);

    expect(screen.getByText(label as string)).toBeVisible();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('renders no retrieval badge when it is %s', (_name, retrieval) => {
    // Unrecorded is not "off". A run that predates the frozen policy block
    // must not be labelled as having had retrieval disabled.
    render(<MeasurementContext model="gemini-2.5-pro" retrieval={retrieval as boolean | null} />);

    expect(screen.queryByText(/^Retrieval/)).not.toBeInTheDocument();
  });
});
