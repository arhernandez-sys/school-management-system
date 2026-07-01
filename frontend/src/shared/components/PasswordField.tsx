import { useState } from 'react';
import { IconButton, InputAdornment, TextField } from '@mui/material';
import type { TextFieldProps } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

/**
 * PasswordField — password input with a show/hide toggle (design-system §5 #22).
 *
 * Promoted from the Phase-6 stub for Settings (the optional admin-supplied temporary
 * password on user-create, and any password entry). The strength meter from the full
 * design spec is intentionally NOT built here — the 7.2 surfaces only need masked
 * entry + reveal. The toggle button carries a state-describing aria-label.
 *
 * It forwards the common TextField props so callers control label/value/error/helper.
 */
export type PasswordFieldProps = Omit<TextFieldProps, 'type'> & {
  /** Accessible labels for the reveal toggle. */
  showLabel?: string;
  hideLabel?: string;
};

export function PasswordField({
  showLabel = 'Show password',
  hideLabel = 'Hide password',
  InputProps,
  ...textFieldProps
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      {...textFieldProps}
      type={visible ? 'text' : 'password'}
      InputProps={{
        ...InputProps,
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              aria-label={visible ? hideLabel : showLabel}
              onClick={() => setVisible((v) => !v)}
              edge="end"
            >
              {visible ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}

export default PasswordField;
