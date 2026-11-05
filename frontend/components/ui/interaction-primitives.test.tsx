import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { Button } from './button';
import { Checkbox } from './checkbox';
import { ChipInput, type ChipItem } from './chip-input';
import { CsvImportFileInput, CsvImportTrigger } from './csv-import';
import { RadioGroup } from './radio-group';
import { SearchField } from './search-field';
import { Select } from './select';
import { TabPanel, Tabs } from './tabs';

describe('authenticated interaction primitives', () => {
  it('makes a pending Button busy and prevents another submission', () => {
    render(
      <Button pending pendingLabel="Saving…">
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps the original label when a pending Button has no replacement label', () => {
    render(<Button pending>Refresh</Button>);

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('clears a controlled SearchField without replacing its owner', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState('orphan');
      return <SearchField value={value} onValueChange={setValue} aria-label="Find issues" />;
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('searchbox', { name: 'Find issues' })).toHaveValue('');
  });

  it('prevents the clear control from changing a disabled SearchField', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SearchField
        disabled
        value="orphan"
        onValueChange={onValueChange}
        aria-label="Find issues"
      />,
    );

    const clear = screen.getByRole('button', { name: 'Clear search' });
    expect(clear).toBeDisabled();
    await user.click(clear);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('opens Select options and commits a controlled value', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState<'all' | 'high'>('all');
      return (
        <Select
          value={value}
          onValueChange={setValue}
          ariaLabel="Severity"
          options={[
            { value: 'all', label: 'All' },
            { value: 'high', label: 'High' },
          ]}
        />
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('combobox', { name: 'Severity' }));
    await user.click(screen.getByRole('option', { name: 'High' }));
    expect(screen.getByRole('combobox', { name: 'Severity' })).toHaveTextContent('High');
  });

  it('uses Radix keyboard selection and panel wiring for Tabs', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState<'one' | 'two'>('one');
      return (
        <Tabs
          value={value}
          onValueChange={setValue}
          ariaLabel="Views"
          items={[
            { value: 'one', label: 'One' },
            { value: 'two', label: 'Two' },
          ]}
        >
          <TabPanel value="one">First panel</TabPanel>
          <TabPanel value="two">Second panel</TabPanel>
        </Tabs>
      );
    }
    render(<Harness />);
    screen.getByRole('tab', { name: 'One' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Second panel');
  });

  it('exposes checkbox and radio state', async () => {
    const onCheck = vi.fn();
    const onRadio = vi.fn();
    render(
      <>
        <Checkbox checked={false} onCheckedChange={onCheck} label="Include archived" />
        <RadioGroup
          value="a"
          onValueChange={onRadio}
          ariaLabel="Mode"
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />
      </>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived' }));
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(onCheck).toHaveBeenCalledWith(true);
    expect(onRadio).toHaveBeenCalledWith('b');
  });

  it('announces and updates an indeterminate checkbox', async () => {
    const user = userEvent.setup();
    const onCheck = vi.fn();
    render(
      <Checkbox
        checked="indeterminate"
        onCheckedChange={onCheck}
        aria-label="Select all products"
      />,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Select all products' });
    expect(checkbox).toHaveAttribute('data-state', 'indeterminate');
    await user.click(checkbox);
    expect(onCheck).toHaveBeenCalledWith(true);
  });

  it('rejects a checkbox without visible or programmatic labeling', () => {
    expect(() =>
      render(<Checkbox checked={false} onCheckedChange={() => {}} label={null as never} />),
    ).toThrow('Checkbox requires a visible label or aria-label.');
  });

  it('moves and selects card radios with the arrow keys', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState<'one' | 'two'>('one');
      return (
        <RadioGroup
          variant="cards"
          columns={2}
          value={value}
          onValueChange={setValue}
          ariaLabel="Choice"
          options={[
            { value: 'one', label: 'One', description: 'The first plan' },
            { value: 'two', label: 'Two', description: 'The second plan' },
          ]}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByText('The second plan')).toBeInTheDocument();
    screen.getByRole('radio', { name: /One/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /Two/ })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('radio', { name: /Two/ })).toBeChecked();
  });

  it('clears a SearchField on Escape and focuses it from its shortcut', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState('');
      return (
        <SearchField value={value} onValueChange={setValue} aria-label="Search" shortcut="/" />
      );
    }
    render(<Harness />);
    const field = screen.getByRole('searchbox', { name: 'Search' });
    expect(field).not.toHaveFocus();

    await user.keyboard('{Control>}/{/Control}');
    expect(field).toHaveFocus();
    await user.keyboard('crawl');
    expect(field).toHaveValue('crawl');
    await user.keyboard('{Escape}');
    expect(field).toHaveValue('');
  });

  it('adds chips on Enter, ignores a duplicate and removes the last on Backspace', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [items, setItems] = useState<ChipItem[]>([{ value: 'Running shoes' }]);
      return <ChipInput label="Topics" items={items} onChange={setItems} max={5} />;
    }
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Topics' })).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'Add to Topics' });

    await user.type(field, 'Trail shoes, waterproof{Enter}');
    await user.type(field, 'running shoes{Enter}');
    expect(screen.getByText('Trail shoes, waterproof')).toBeInTheDocument();
    expect(screen.getAllByText(/running shoes/i)).toHaveLength(1);
    expect(screen.getByText('2/5')).toBeInTheDocument();
    // The ignored repeat stays in the field for the person to correct.
    expect(field).toHaveValue('running shoes');

    await user.clear(field);
    await user.keyboard('{Backspace}');
    expect(screen.queryByText('Trail shoes, waterproof')).not.toBeInTheDocument();
    expect(screen.getByText('Running shoes')).toBeInTheDocument();
  });

  it('allows selecting the same CSV file again', () => {
    const onSelect = vi.fn();
    render(<CsvImportTrigger accessibleLabel="Import products" onSelect={onSelect} />);
    const input = screen.getByLabelText('Import products');
    const file = new File(['name\nExample'], 'products.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('resets the CSV field after forwarding its selected file', () => {
    const onSelect = vi.fn();
    const inputRef = createRef<HTMLInputElement>();
    render(<CsvImportFileInput inputRef={inputRef} onSelect={onSelect} />);
    const input = screen.getByLabelText('CSV file');
    const file = new File(['text'], 'prompts.csv', { type: 'text/csv' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onSelect).toHaveBeenCalledWith(file);
    expect(input).toHaveValue('');
  });
});
