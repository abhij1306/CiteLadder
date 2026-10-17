import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vite-plus/test';

import { DISPLAY_TIME_ZONE_COOKIE, readTimeZonePreference } from '@/lib/display-timezone';

import { TimeZoneSetting } from './time-zone-setting';

afterEach(() => {
  document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=; Path=/; Max-Age=0`;
});

it('lets the account select and retain a named timezone, then return to Auto', async () => {
  const user = userEvent.setup();
  render(<TimeZoneSetting />);
  await user.click(screen.getByRole('combobox', { name: 'Display timezone preference' }));
  await user.click(screen.getByRole('option', { name: 'Named timezone' }));
  await user.type(screen.getByRole('textbox', { name: 'IANA timezone' }), 'Asia/Kolkata');
  await user.click(screen.getByRole('button', { name: 'Save timezone' }));
  expect(readTimeZonePreference(document.cookie)).toBe('Asia/Kolkata');
  expect(screen.getByText('Timestamps currently display in Asia/Kolkata.')).toBeVisible();
  await user.click(screen.getByRole('combobox', { name: 'Display timezone preference' }));
  await user.click(screen.getByRole('option', { name: /Auto/ }));
  expect(readTimeZonePreference(document.cookie)).toBe('auto');
});

it('refreshes the saved choice on focus without discarding an unsaved custom edit', async () => {
  const user = userEvent.setup();
  render(<TimeZoneSetting />);
  act(() => {
    document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=UTC; Path=/`;
    window.dispatchEvent(new Event('focus'));
  });
  expect(screen.getByRole('combobox', { name: 'Display timezone preference' })).toHaveTextContent(
    'UTC',
  );

  await user.click(screen.getByRole('combobox', { name: 'Display timezone preference' }));
  await user.click(screen.getByRole('option', { name: 'Named timezone' }));
  await user.type(screen.getByRole('textbox', { name: 'IANA timezone' }), 'Europe/London');
  act(() => {
    document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=Asia%2FKolkata; Path=/`;
    window.dispatchEvent(new Event('focus'));
  });
  expect(screen.getByRole('textbox', { name: 'IANA timezone' })).toHaveValue('Europe/London');
  expect(screen.getByText('Timestamps currently display in Asia/Kolkata.')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Save timezone' }));
  expect(readTimeZonePreference(document.cookie)).toBe('Europe/London');
  expect(screen.getByRole('textbox', { name: 'IANA timezone' })).toHaveValue('Europe/London');
});
