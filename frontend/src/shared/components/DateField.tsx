import type { SxProps, Theme } from '@mui/material/styles';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import dayjs, { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

// `dayjs(value, format, true)` below is a STRICT parse, and strict parsing is only
// available once this plugin is registered — without it dayjs silently ignores the format
// argument and falls back to its loose parser, which is the difference between rejecting a
// malformed value and quietly accepting a wrong date.
dayjs.extend(customParseFormat);

/**
 * DateField / DateTimeField — the app's ONLY date controls (D42 §6).
 *
 * **Why these exist.** Every date input in the app was a native `<input type="date">`.
 * A native date input renders in the BROWSER's locale and there is no attribute, prop or
 * stylesheet that changes it — so on a US-locale machine a Belize school typed and read
 * `mm/dd/yyyy` on all twenty-two of them. The client asked for `dd/mm/yyyy` everywhere,
 * which means a real picker: `LocalizationProvider adapterLocale="en-gb"` in AppProviders
 * makes day-first the parse and display format, and these two wrappers are what every
 * screen mounts so that decision lives in one file.
 *
 * **The API is deliberately the one the call sites already had**: `value` and `onChange`
 * speak the WIRE string, not a Dayjs. Every form in this app holds its dates as the
 * strings the API sends and receives — `YYYY-MM-DD` for a date, a UTC ISO instant for a
 * datetime — and handing them a date object would have pushed a conversion into two dozen
 * components, which is exactly how two of them end up converting differently.
 *
 * **A cleared field is `''`, never `null`.** The forms treat empty-string as "not filled
 * in" (`!start`, `date.trim()`, `value || null` on submit), so returning null would make
 * every one of those checks subtly wrong. An INVALID partial entry — "14/" while the user
 * is still typing — is also `''`: it is not a date yet, and reporting a half-typed value
 * as a real one would let a form submit garbage.
 */

/** The wire format for a plain date. Not a display format — see the file note. */
const WIRE_DATE = 'YYYY-MM-DD';

export interface DateFieldProps {
  label: string;
  /** `YYYY-MM-DD`, or `''` when empty. */
  value: string;
  /** Receives `YYYY-MM-DD`, or `''` when cleared or mid-typing. */
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  error?: boolean;
  helperText?: string;
  /** `YYYY-MM-DD` bounds, matching the native `min` / `max` these replaced. */
  minDate?: string;
  maxDate?: string;
  size?: 'small' | 'medium';
  name?: string;
  autoFocus?: boolean;
  /** Layout only. Applied to the text field, which is what the `TextField` it replaced
   *  did with the same prop — so call sites that sized their input keep working. */
  sx?: SxProps<Theme>;
}

/**
 * A `dd/mm/yyyy` date picker over a `YYYY-MM-DD` string.
 *
 * `parse` is strict on the wire format. `dayjs('2004-03-14')` and `dayjs('14/03/2004')`
 * both succeed but mean different days, and a value arriving in the wrong shape should
 * render as empty rather than as a confidently wrong date.
 */
export function DateField({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  fullWidth = false,
  error = false,
  helperText,
  minDate,
  maxDate,
  size,
  name,
  autoFocus = false,
  sx,
}: DateFieldProps) {
  return (
    <DatePicker
      label={label}
      format="DD/MM/YYYY"
      value={parseWire(value, WIRE_DATE)}
      onChange={(next) => onChange(formatWire(next, WIRE_DATE))}
      disabled={disabled}
      minDate={parseWire(minDate, WIRE_DATE) ?? undefined}
      maxDate={parseWire(maxDate, WIRE_DATE) ?? undefined}
      slotProps={{
        textField: {
          required,
          fullWidth,
          error,
          helperText,
          size,
          name,
          autoFocus,
          sx,
          // The picker's own placeholder is the format itself, which is the clearest
          // possible instruction here: the whole change is about which order the parts go in.
          placeholder: 'dd/mm/yyyy',
        },
      }}
    />
  );
}

export interface DateTimeFieldProps
  extends Omit<DateFieldProps, 'value' | 'onChange' | 'minDate' | 'maxDate'> {
  /** A UTC ISO instant, or `''` when empty. */
  value: string;
  /** Receives a UTC ISO instant, or `''` when cleared or mid-typing. */
  onChange: (value: string) => void;
}

/**
 * A `dd/mm/yyyy hh:mm` picker over a **UTC ISO instant**.
 *
 * The displayed value is the browser's LOCAL wall clock and the stored value is UTC,
 * which is the same contract the `datetime-local` inputs this replaced had — and it is
 * load-bearing. A Dean setting a freeze for "23:00 on the 15th" means 23:00 in Belize;
 * rendering the UTC wall clock instead would show them "05:00 on the 16th".
 */
export function DateTimeField({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  fullWidth = false,
  error = false,
  helperText,
  size,
  name,
  autoFocus = false,
  sx,
}: DateTimeFieldProps) {
  const parsed = value ? dayjs(value) : null;
  return (
    <DateTimePicker
      label={label}
      format="DD/MM/YYYY HH:mm"
      ampm={false}
      value={parsed !== null && parsed.isValid() ? parsed : null}
      onChange={(next) =>
        onChange(next !== null && next.isValid() ? next.toDate().toISOString() : '')
      }
      disabled={disabled}
      slotProps={{
        textField: {
          required,
          fullWidth,
          error,
          helperText,
          size,
          name,
          autoFocus,
          sx,
          placeholder: 'dd/mm/yyyy hh:mm',
        },
      }}
    />
  );
}

function parseWire(value: string | undefined, format: string): Dayjs | null {
  if (!value) return null;
  const d = dayjs(value, format, true);
  return d.isValid() ? d : null;
}

function formatWire(value: Dayjs | null, format: string): string {
  return value !== null && value.isValid() ? value.format(format) : '';
}

export default DateField;
