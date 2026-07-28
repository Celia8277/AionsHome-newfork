import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useSettingsPageColors, type ThemeColors } from '../../../theme/colors';

type ButtonRowProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  /** 居中显示（iOS 操作行风格），默认 true */
  center?: boolean;
};

/** iOS Settings 风格操作行（如「测试连接」「立即来信」） */
export function ButtonRow({ label, onPress, loading, disabled, destructive, center = true }: ButtonRowProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const inactive = disabled || loading;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        center && styles.rowCenter,
        pressed && !inactive && styles.rowPressed,
        inactive && styles.rowDisabled,
      ]}
      onPress={onPress}
      disabled={inactive}
    >
      {loading ? (
        <ActivityIndicator size="small" color={destructive ? colors.danger : colors.primary} />
      ) : (
        <Text style={[styles.label, destructive && styles.labelDestructive]}>{label}</Text>
      )}
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      paddingHorizontal: 16,
      paddingVertical: 11,
      backgroundColor: colors.inputBackground,
    },
    rowCenter: {
      justifyContent: 'center',
    },
    rowPressed: {
      backgroundColor: colors.surfaceHover,
    },
    rowDisabled: {
      opacity: 0.45,
    },
    label: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.primary,
    },
    labelDestructive: {
      color: colors.danger,
    },
  });
