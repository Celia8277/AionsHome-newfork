import { useState } from 'react';
import { type KeyboardTypeOptions } from 'react-native';
import { SettingsRow } from './SettingsRow';
import { TextInputDialog } from './TextInputDialog';

type TextEditRowProps = {
  label: string;
  sublabel?: string;
  /** 当前值（原始文本） */
  value: string;
  /** 空值时行内显示的占位文本，默认「未设置」 */
  placeholder?: string;
  /** Dialog 标题，默认取 label */
  dialogTitle?: string;
  /** Dialog 内说明文字 */
  dialogDescription?: string;
  /** Dialog 输入框 placeholder，默认取 placeholder */
  inputPlaceholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  secure?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** 行内值的自定义展示（如数字加单位）；不影响编辑时的原始文本 */
  displayValue?: string;
  validate?: (text: string) => string | null;
  onSave: (text: string) => void;
  disabled?: boolean;
};

/** 文本设置行：点击弹 Dialog 编辑，确认保存 */
export function TextEditRow({
  label,
  sublabel,
  value,
  placeholder = '未设置',
  dialogTitle,
  dialogDescription,
  inputPlaceholder,
  multiline,
  keyboardType,
  secure,
  autoCapitalize,
  displayValue,
  validate,
  onSave,
  disabled,
}: TextEditRowProps) {
  const [editing, setEditing] = useState(false);

  const shownValue = secure
    ? value
      ? '••••••••'
      : ''
    : displayValue !== undefined
      ? displayValue
      : multiline
        ? value.replace(/\s*\n\s*/g, ' ')
        : value;

  return (
    <>
      <SettingsRow
        label={label}
        sublabel={sublabel}
        value={shownValue}
        placeholder={placeholder}
        showChevron
        disabled={disabled}
        onPress={() => setEditing(true)}
      />
      <TextInputDialog
        visible={editing}
        title={dialogTitle || label}
        description={dialogDescription}
        initialValue={value}
        placeholder={inputPlaceholder ?? (placeholder === '未设置' ? undefined : placeholder)}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
        validate={validate}
        onCancel={() => setEditing(false)}
        onSave={(text) => {
          setEditing(false);
          onSave(text);
        }}
      />
    </>
  );
}
