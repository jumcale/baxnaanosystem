import React, { useState, useEffect, useRef } from 'react';

export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;
  onChange: (value: number) => void;
  /** If provided, restores this value on blur when the input is left blank */
  fallbackOnBlur?: number;
  /** If true, displays literal "0" instead of empty with placeholder="0" when value is 0 */
  showZeroAsValue?: boolean;
}

/**
 * Controlled numeric input that fixes the React `Number("") -> 0` bug:
 * - Clearing the input with Backspace leaves it empty (`""`) instead of forcing a stuck `0`.
 * - Initial `0` values display as a clean `placeholder="0"` that vanishes immediately when typing.
 * - Preserves intermediate decimal strings like `"0."` or `"1.0"` while focused.
 */
export const NumericInput: React.FC<NumericInputProps> = ({
  value,
  onChange,
  fallbackOnBlur,
  showZeroAsValue = false,
  placeholder = '0',
  onBlur,
  onFocus,
  ...rest
}) => {
  const isFocusedRef = useRef(false);

  const formatForDisplay = (num: number): string => {
    if (Number.isNaN(num)) return '';
    if (num === 0 && !showZeroAsValue) return '';
    return String(num);
  };

  const [rawValue, setRawValue] = useState<string>(() => formatForDisplay(value));

  useEffect(() => {
    if (!isFocusedRef.current) {
      setRawValue(formatForDisplay(value));
    } else {
      // If parent programmatically changed value to something different from current parsed rawValue
      const currentParsed = rawValue === '' ? 0 : Number(rawValue);
      if (currentParsed !== value && !Number.isNaN(value)) {
        setRawValue(formatForDisplay(value));
      }
    }
  }, [value, showZeroAsValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextStr = e.target.value;
    setRawValue(nextStr);

    if (nextStr.trim() === '') {
      onChange(0);
      return;
    }

    const parsed = Number(nextStr);
    if (!Number.isNaN(parsed)) {
      onChange(parsed);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = false;
    if (rawValue.trim() === '' || Number(rawValue) <= 0) {
      if (fallbackOnBlur !== undefined && fallbackOnBlur > 0) {
        setRawValue(String(fallbackOnBlur));
        onChange(fallbackOnBlur);
        onBlur?.(e);
        return;
      }
    }
    const parsed = rawValue.trim() === '' ? 0 : Number(rawValue);
    const normalized = Number.isNaN(parsed) ? 0 : parsed;
    setRawValue(formatForDisplay(normalized));
    onBlur?.(e);
  };

  return (
    <input
      {...rest}
      type="number"
      value={rawValue}
      placeholder={placeholder}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
};

