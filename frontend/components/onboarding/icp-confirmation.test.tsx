import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import {
  IcpAudience,
  IcpCategory,
  hasConfirmedIcp,
} from '@/components/onboarding/icp-confirmation';

/**
 * The step renders the two halves in different places now — what you sell leads
 * at full width, the audience questions sit beside the found competitors — so
 * the test mounts both together, which is what the reader still sees.
 */
function IcpConfirmation(props: Parameters<typeof IcpCategory>[0]) {
  return (
    <>
      <IcpCategory {...props} />
      <IcpAudience {...props} />
    </>
  );
}
import type { DiscoveryProfile } from '@/lib/api/brand-discoveries';

function profile(overrides: Partial<DiscoveryProfile> = {}): DiscoveryProfile {
  return {
    description: 'A commerce platform',
    positioning: 'Reliable product data',
    products_services: ['Product feeds'],
    target_audience: 'Retailers',
    industry: 'Commerce software',
    business_type: 'b2b',
    price_tier: 'premium',
    field_confidence: {},
    category: 'product feed management platform',
    category_options: [],
    category_aliases: ['feed management software'],
    category_terms: ['product feed management', 'marketplace integrations'],
    jobs_to_be_done: ['sell on marketplaces'],
    sector: 'Software',
    business_model: 'b2b_saas',
    secondary_business_models: [],
    market_scope: 'global',
    buyer_register: 'research_comparative',
    buyer_roles: [],
    service_areas: [],
    knowledge_strength: 'strong',
    ...overrides,
  };
}

describe('hasConfirmedIcp', () => {
  it('gates only on what the screen actually shows', () => {
    // Positioning and audience are no longer asked for here, so they must not
    // block a user on a field they were never presented with.
    expect(hasConfirmedIcp(profile())).toBe(true);
    expect(hasConfirmedIcp(profile({ positioning: '', target_audience: '' }))).toBe(true);
    expect(hasConfirmedIcp(profile({ category: '   ' }))).toBe(false);
    expect(hasConfirmedIcp(null)).toBe(false);
  });
});

describe('IcpConfirmation', () => {
  it('asks three questions, all answerable by clicking', () => {
    render(<IcpConfirmation profile={profile()} onChange={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'What you sell' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Who buys it' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Where they buy it' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/positioning/i)).toBeNull();
    expect(screen.queryByLabelText(/description/i)).toBeNull();
  });

  it('caps the category choices so the screen stays short', () => {
    render(
      <IcpConfirmation
        profile={profile({
          category_options: ['one', 'two', 'three', 'four'],
          category_aliases: ['five'],
        })}
        onChange={vi.fn()}
      />,
    );

    // Three suggestions plus the explicit escape hatch. Matched by exact name:
    // a loose regex counted the escape chip too, because "None of these"
    // contains "one".
    for (const name of ['Product feed management platform', 'One', 'Two']) {
      expect(screen.getByRole('radio', { name })).toBeVisible();
    }
    expect(screen.queryByRole('radio', { name: 'Three' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'None of these' })).toBeVisible();
  });

  it('never shows a discovered category as the raw stored token', () => {
    const onChange = vi.fn();
    render(
      <IcpConfirmation
        profile={profile({
          category: 'brand_audit_services',
          category_options: ['marketing_consulting'],
          category_aliases: [],
        })}
        onChange={onChange}
      />,
    );

    // A database value was the first thing a new customer read on this screen.
    expect(screen.queryByRole('radio', { name: /brand_audit_services/ })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Brand Audit Services' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Marketing Consulting' })).toBeVisible();
  });

  it('stores the discovered token, not the label it displays', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <IcpConfirmation
        profile={profile({
          category: 'brand_audit_services',
          category_options: ['marketing_consulting'],
          category_aliases: [],
        })}
        onChange={onChange}
      />,
    );

    // Humanising is a display concern; round-tripping the prettified string
    // back into the payload would change what the project is built from.
    await user.click(screen.getByRole('radio', { name: 'Marketing Consulting' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'marketing_consulting' }),
    );
  });

  it('names the escape hatch for what it is when there is nothing to reject', () => {
    // With no suggestions on screen, "None of these" refers to an empty set.
    render(
      <IcpConfirmation
        profile={profile({ category: '', category_aliases: [] })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Other' })).toBeVisible();
  });

  it('offers one regional choice and keeps every choice on screen after selection', async () => {
    // Regression: selecting a scope made the rest of the options vanish.
    const onChange = vi.fn();
    const { rerender } = render(<IcpConfirmation profile={profile()} onChange={onChange} />);

    expect(screen.queryByRole('radio', { name: 'City by city' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Across a region' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Regional' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ market_scope: 'regional' }));
    rerender(<IcpConfirmation profile={profile({ market_scope: 'local' })} onChange={onChange} />);

    expect(screen.getByRole('radio', { name: 'Locally' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Regional' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Worldwide' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Businesses' })).toBeVisible();
    expect(screen.getByText('What you sell')).toBeVisible();
  });

  it('reveals a text field only when the suggestions are rejected', async () => {
    render(<IcpConfirmation profile={profile()} onChange={vi.fn()} />);

    expect(screen.queryByLabelText(/describe what you sell/i)).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'None of these' }));
    expect(screen.getByLabelText(/describe what you sell/i)).toBeVisible();
  });

  it('drops the rejected suggestion so it cannot be submitted silently', async () => {
    // Regression: "None of these" only flipped the input on. The rejected
    // category stayed in the payload, the field looked empty, and Create
    // project stayed enabled — so the user shipped the label they rejected.
    const onChange = vi.fn();
    const { rerender } = render(<IcpConfirmation profile={profile()} onChange={onChange} />);
    expect(hasConfirmedIcp(profile())).toBe(true);

    await userEvent.click(screen.getByRole('radio', { name: 'None of these' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ category: '' }));
    const rejected = profile({ category: '' });
    rerender(<IcpConfirmation profile={rejected} onChange={onChange} />);
    expect(hasConfirmedIcp(rejected)).toBe(false);

    const field = screen.getByLabelText(/describe what you sell/i);
    expect(field).toHaveValue('');
    await userEvent.type(field, 'x');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'x' }));
    expect(hasConfirmedIcp(profile({ category: 'x' }))).toBe(true);
  });

  it('switches category with one click', async () => {
    const onChange = vi.fn();
    render(
      <IcpConfirmation
        profile={profile({ category_options: ['marketplace syndication software'] })}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole('radio', { name: /marketplace syndication software/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'marketplace syndication software' }),
    );
  });
});
