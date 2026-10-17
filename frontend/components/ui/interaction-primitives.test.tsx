import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { Button } from './button';
import { Checkbox } from './checkbox';
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

  it('uses Radix arrow-key semantics for chip radios', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState<'one' | 'two'>('one');
      return (
        <RadioGroup
          variant="chip"
          value={value}
          onValueChange={setValue}
          ariaLabel="Choice"
          options={[
            { value: 'one', label: 'One' },
            { value: 'two', label: 'Two' },
          ]}
        />
      );
    }
    render(<Harness />);
    screen.getByRole('radio', { name: 'One' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Two' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('radio', { name: 'Two' })).toBeChecked();
  });

  it('keeps grouped chip options in one keyboard-navigable radio group', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState('article');
      return (
        <RadioGroup
          variant="chip"
          value={value}
          onValueChange={setValue}
          ariaLabel="Content format"
          options={[
            { value: 'article', label: 'Article', groupLabel: 'Web' },
            { value: 'thread', label: 'Thread', groupLabel: 'Social' },
          ]}
        />
      );
    }
    render(<Harness />);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
    screen.getByRole('radio', { name: 'Article' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Thread' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('radio', { name: 'Thread' })).toBeChecked();
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
