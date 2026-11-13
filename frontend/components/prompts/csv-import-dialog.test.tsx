import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { CsvImportDialog } from './csv-import-dialog';

const mocks = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => ({ saveBlob: mocks.saveBlob }));

beforeEach(() => mocks.saveBlob.mockReset());

const limits = { import_rows_max: 500, persona_max_chars: 120 };

function renderDialog(onImport: (rows: unknown[]) => Promise<void> | void = vi.fn()) {
  render(
    <CsvImportDialog
      open
      onOpenChange={vi.fn()}
      onImport={onImport}
      isImporting={false}
      limits={limits}
    />,
  );
}

describe('CsvImportDialog file flow', () => {
  it('previews topic and prompt, then imports only the importable rows', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    renderDialog(onImport);

    await user.upload(
      screen.getByLabelText('CSV file'),
      new File(['topic,prompt\nBikes,How do I choose a bike?\nBikes,'], 'prompts.csv', {
        type: 'text/csv',
      }),
    );

    expect(await screen.findByText('How do I choose a bike?')).toBeInTheDocument();
    expect(screen.getByText('Prompt is required.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import 1 prompt' }));
    expect(onImport).toHaveBeenCalledWith([
      expect.objectContaining({ text: 'How do I choose a bike?', topic: 'Bikes' }),
    ]);
  });

  it('refuses a Windows-1252 file before previewing or importing anything', async () => {
    const user = userEvent.setup();
    renderDialog();

    // "topic,prompt\nCafés,Best café near me?" with é as the Windows-1252 byte 0xE9.
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('topic,prompt\nCaf'),
      0xe9,
      ...new TextEncoder().encode('s,Best caf'),
      0xe9,
      ...new TextEncoder().encode(' near me?\n'),
    ]);
    await user.upload(
      screen.getByLabelText('CSV file'),
      new File([bytes], 'prompts.csv', { type: 'text/csv' }),
    );

    expect(
      await screen.findByText('This file is not UTF-8 text. Save as CSV UTF-8 and upload again.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Parsed rows' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 0 prompts' })).toBeDisabled();
  });

  it('downloads a sample CSV in the format the import reads', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Download sample CSV' }));

    const [blob, filename] = mocks.saveBlob.mock.calls[0] as [Blob, string];
    expect(filename).toBe('prompts-sample.csv');
    expect((await blob.text()).replace(/^﻿/u, '').split('\r\n')[0]).toBe('topic,prompt');
  });

  it('sends one import when the button is clicked twice before it settles', async () => {
    const user = userEvent.setup();
    let settle: () => void = () => {};
    const onImport = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    renderDialog(onImport);
    await user.upload(
      screen.getByLabelText('CSV file'),
      new File(['topic,prompt\nBikes,How do I choose a bike?\n'], 'prompts.csv', {
        type: 'text/csv',
      }),
    );
    const button = await screen.findByRole('button', { name: 'Import 1 prompt' });

    await user.dblClick(button);
    settle();

    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
