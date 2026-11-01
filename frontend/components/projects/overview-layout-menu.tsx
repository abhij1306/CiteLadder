'use client';

import { LayoutGrid } from 'lucide-react';

import {
  overviewWidgetTitles,
  type OverviewLayout,
  type OverviewWidget,
} from '@citeladder/contracts/overview';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { addableWidgets, addWidget } from '@/lib/overview/layout';

/**
 * One fixed "Layout" button for members who can edit: editing, adding and
 * resetting all live in its menu, so the header never reflows between modes.
 */
export function OverviewLayoutMenu({
  layout,
  editing,
  pending,
  onEditingChange,
  onSave,
}: Readonly<{
  layout: OverviewLayout;
  editing: boolean;
  pending: boolean;
  onEditingChange: (editing: boolean) => void;
  /** `null` resets to the default layout. */
  onSave: (widgets: OverviewWidget[] | null) => void;
}>) {
  const addable = addableWidgets(layout.widgets);
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="secondary" pending={pending}>
          <Icon icon={LayoutGrid} />
          Layout
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end">
        <DropdownItem onSelect={() => onEditingChange(!editing)}>
          {editing ? 'Done editing' : 'Edit layout'}
        </DropdownItem>
        {addable.length ? (
          <>
            <DropdownSeparator />
            <DropdownLabel>Add widget</DropdownLabel>
            {addable.map((key) => (
              <DropdownItem
                key={key}
                onSelect={() => {
                  onSave(addWidget(layout.widgets, key));
                  onEditingChange(true);
                }}
              >
                {overviewWidgetTitles[key]}
              </DropdownItem>
            ))}
          </>
        ) : null}
        <DropdownSeparator />
        <DropdownItem disabled={!layout.customized} onSelect={() => onSave(null)}>
          Reset to default
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
