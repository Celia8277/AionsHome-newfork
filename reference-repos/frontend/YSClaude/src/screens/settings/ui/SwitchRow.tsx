import { Switch } from 'react-native';
import { useSettingsPageColors } from '../../../theme/colors';
import { SettingsRow } from './SettingsRow';

type SwitchRowProps = {
  label: string;
  sublabel?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

/** iOS Settings 风格开关行 */
export function SwitchRow({ label, sublabel, value, onValueChange, disabled }: SwitchRowProps) {
  const colors = useSettingsPageColors();
  return (
    <SettingsRow
      label={label}
      sublabel={sublabel}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      }
    />
  );
}
