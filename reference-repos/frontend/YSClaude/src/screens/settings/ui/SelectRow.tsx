import { useState } from 'react';
import { SettingsRow } from './SettingsRow';
import { OptionListDialog, type SelectOption } from './OptionListDialog';

type SelectRowProps<T extends string | number> = {
  label: string;
  sublabel?: string;
  options: Array<SelectOption<T>>;
  value?: T;
  /** 空值时行内显示的占位文本 */
  placeholder?: string;
  dialogTitle?: string;
  onSelect: (value: T) => void;
  disabled?: boolean;
};

/** 选项设置行：点击弹选项列表，当前项打勾 */
export function SelectRow<T extends string | number>({
  label,
  sublabel,
  options,
  value,
  placeholder = '未选择',
  dialogTitle,
  onSelect,
  disabled,
}: SelectRowProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <>
      <SettingsRow
        label={label}
        sublabel={sublabel}
        value={current?.label ?? ''}
        placeholder={placeholder}
        showChevron
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      <OptionListDialog
        visible={open}
        title={dialogTitle || label}
        options={options}
        value={value}
        onCancel={() => setOpen(false)}
        onSelect={(next) => {
          setOpen(false);
          onSelect(next);
        }}
      />
    </>
  );
}
