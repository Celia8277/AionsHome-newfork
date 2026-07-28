import { useEffect, useMemo, useState } from 'react';
import { TextInput } from 'react-native';
import { useSettingsPageColors } from '../../theme/colors';
import { createSettingsStyles } from './styles';

type ClampedNumberInputProps = {
  value: number;
  fallback: number;
  min: number;
  max: number;
  placeholder?: string;
  onCommit: (value: number) => void;
  keyboardType?: 'number-pad' | 'decimal-pad';
};

function parseClampedNumber(value: string, fallback: number, min: number, max: number): number {
  const next = parseInt(value, 10);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

export function ClampedNumberInput({
  value,
  fallback,
  min,
  max,
  placeholder,
  onCommit,
  keyboardType = 'number-pad',
}: ClampedNumberInputProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(String(value));
    }
  }, [focused, value]);

  function commit() {
    const next = parseClampedNumber(text, fallback, min, max);
    const normalized = String(next);
    setText(normalized);
    setFocused(false);
    if (next !== value) {
      onCommit(next);
    }
  }

  return (
    <TextInput
      style={styles.input}
      value={text}
      onFocus={() => setFocused(true)}
      onChangeText={(next) => {
        const cleaned = keyboardType === 'decimal-pad' ? next.replace(/[^0-9.]/g, '') : next.replace(/[^0-9]/g, '');
        setText(cleaned);
      }}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType={keyboardType}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
    />
  );
}
