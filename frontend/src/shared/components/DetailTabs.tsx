import { useId, useState } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import type { ReactElement, ReactNode, SyntheticEvent } from 'react';

/**
 * DetailTabs — tabbed detail container (design-system §5 #18).
 *
 * Used by the student / teacher / section detail pages (Profile · Grades · Attendance ·
 * …). Wraps MUI Tabs with the correct ARIA wiring (`role="tabpanel"`, `aria-controls`,
 * `aria-labelledby`) and keeps inactive panels unmounted so heavy tab content (a
 * gradebook, an attendance history) only fetches when its tab is opened.
 *
 * Controlled or uncontrolled. Tab content is provided as a `render` thunk so it is
 * only invoked when active (lazy).
 */
export interface DetailTab {
  /** Stable value (also usable as a route segment by the caller). */
  value: string;
  label: string;
  /** Optional leading icon, rendered before the label (decorative — label carries meaning). */
  icon?: ReactElement;
  /** Lazily-rendered panel content. */
  render: () => ReactNode;
  disabled?: boolean;
}

export interface DetailTabsProps {
  tabs: DetailTab[];
  /** Controlled active tab value (omit for uncontrolled). */
  value?: string;
  onChange?: (value: string) => void;
  /** Default active tab when uncontrolled (defaults to the first tab). */
  defaultValue?: string;
  'aria-label'?: string;
}

export function DetailTabs({
  tabs,
  value: controlled,
  onChange,
  defaultValue,
  'aria-label': ariaLabel = 'Detail sections',
}: DetailTabsProps) {
  const first = tabs[0]?.value ?? '';
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? first);
  const isControlled = controlled !== undefined;
  const active = isControlled ? controlled : uncontrolled;
  const idBase = useId();

  const handleChange = (_e: SyntheticEvent, next: string) => {
    if (!isControlled) setUncontrolled(next);
    onChange?.(next);
  };

  const activeTab = tabs.find((t) => t.value === active) ?? tabs[0];

  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={active} onChange={handleChange} aria-label={ariaLabel} variant="scrollable" allowScrollButtonsMobile>
          {tabs.map((t) => (
            <Tab
              key={t.value}
              value={t.value}
              label={t.label}
              icon={t.icon}
              iconPosition="start"
              disabled={t.disabled}
              id={`${idBase}-tab-${t.value}`}
              aria-controls={`${idBase}-panel-${t.value}`}
              sx={{ minHeight: 48 }}
            />
          ))}
        </Tabs>
      </Box>
      {activeTab && (
        <Box
          role="tabpanel"
          id={`${idBase}-panel-${activeTab.value}`}
          aria-labelledby={`${idBase}-tab-${activeTab.value}`}
          sx={{ pt: 3 }}
        >
          {activeTab.render()}
        </Box>
      )}
    </Box>
  );
}

export default DetailTabs;
