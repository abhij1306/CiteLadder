import {
  overviewWidgetTitles,
  type OverviewLayout,
  type OverviewWidget,
} from '@citeladder/contracts/overview';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { LayoutGrid } from '@/lib/icons';
import { addableWidgets, addWidget } from '@/lib/overview/layout';

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
  onSave: (widgets: OverviewWidget[] | null) => void;
}>) {
  const addable = addableWidgets(layout.widgets);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" pending={pending}>
          <Icon icon={LayoutGrid} />
          Layout
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onSelect={() => onEditingChange(!editing)}>
          {editing ? 'Done editing' : 'Edit layout'}
        </MenuItem>
        {addable.length ? (
          <>
            <MenuSeparator />
            <MenuLabel>Add widget</MenuLabel>
            {addable.map((key) => (
              <MenuItem
                key={key}
                onSelect={() => {
                  onSave(addWidget(layout.widgets, key));
                  onEditingChange(true);
                }}
              >
                {overviewWidgetTitles[key]}
              </MenuItem>
            ))}
          </>
        ) : null}
        <MenuSeparator />
        <MenuItem disabled={!layout.customized} onSelect={() => onSave(null)}>
          Reset to default
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
