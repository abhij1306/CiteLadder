import { describe, expect, it } from 'vite-plus/test';
import { render, screen, within } from '@testing-library/react';

import { RootErrorsBlock } from './root-errors-block';
import type { RootError } from '@/lib/api/types';

const errors: RootError[] = [
  {
    method: 'GET',
    target: 'https://acme.com/',
    outcome: 'error',
    error_code: 'http_5xx',
    status_code: 500,
    latency_ms: 812,
  },
  {
    method: 'GET',
    target: 'https://acme.com/',
    outcome: 'error',
    error_code: 'http_5xx',
    status_code: 500,
    latency_ms: 1040,
  },
];

describe('RootErrorsBlock', () => {
  it('renders one NON-clickable row per failed root call', () => {
    render(<RootErrorsBlock errors={errors} />);

    const block = screen.getByTestId('root-errors-block');
    const rows = within(block).getAllByTestId('root-error-row');
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!);
    expect(first.getByText('GET')).toBeInTheDocument();
    expect(first.getByText('https://acme.com/')).toBeInTheDocument();
    expect(first.getByText('http_5xx')).toBeInTheDocument();
    expect(first.getByText('HTTP 500')).toBeInTheDocument();
    expect(first.getByText('812 ms')).toBeInTheDocument();
    // No PageDetail exists for a URL the crawl never admitted: the rows must
    // not link anywhere.
    expect(within(block).queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders dashes for unmeasured status/latency and skips an empty code', () => {
    render(
      <RootErrorsBlock
        errors={[
          {
            method: 'GET',
            target: 'https://acme.com/',
            outcome: 'error',
            error_code: '',
            status_code: null,
            latency_ms: null,
          },
        ]}
      />,
    );

    const row = screen.getByTestId('root-error-row');
    expect(within(row).getAllByText('Not measured')).toHaveLength(2);
    expect(within(row).queryByText('http_5xx')).not.toBeInTheDocument();
  });

  it('renders not measured for a 0 ms latency — an unmeasured hop, not an instant one', () => {
    render(
      <RootErrorsBlock
        errors={[
          {
            method: 'GET',
            target: 'https://acme.com/',
            outcome: 'error',
            error_code: 'dns_resolution_failed',
            status_code: null,
            latency_ms: 0,
          },
        ]}
      />,
    );

    const row = screen.getByTestId('root-error-row');
    expect(within(row).queryByText('0 ms')).not.toBeInTheDocument();
    expect(within(row).getAllByText('Not measured')).toHaveLength(2);
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<RootErrorsBlock errors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
