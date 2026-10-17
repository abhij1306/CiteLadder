import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { CsvImportDialog } from './csv-import-dialog';

describe('CsvImportDialog file flow', () => {
  it('previews topic and prompt, then imports only the importable rows', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(<CsvImportDialog open onOpenChange={vi.fn()} onImport={onImport} isImporting={false} />);

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
});
