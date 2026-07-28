import { type ReactNode, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettingsPageColors, type ThemeColors } from '../../../theme/colors';

export type SettingsRowProps = {
  label: string;
  /** 第二行小字说明 */
  sublabel?: string;
  /** 右侧当前值文本 */
  value?: string;
  /** 右侧值为空时显示的灰色占位文本 */
  placeholder?: string;
  showChevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** 红色 label，用于删除类操作 */
  destructive?: boolean;
  /** 自定义右侧内容（Switch、ActivityIndicator 等），优先于 value */
  right?: ReactNode;
  /** 左侧自定义内容（如缩略图预览） */
  left?: ReactNode;
};

/** iOS Settings 风格基础行：左标签、右值 + chevron，行高 >= 44 */
export function SettingsRow({
  label,
  sublabel,
  value,
  placeholder,
  showChevron,
  onPress,
  onLongPress,
  disabled,
  destructive,
  right,
  left,
}: SettingsRowProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const showValueText = right === undefined && (value !== undefined || placeholder !== undefined);
  const valueIsPlaceholder = !value;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && (!!onPress || !!onLongPress) && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || (!onPress && !onLongPress)}
    >
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.labelBlock}>
        <Text style={[styles.label, destructive && styles.labelDestructive]} numberOfLines={2}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={styles.sublabel} numberOfLines={3}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      {showValueText ? (
        <Text
          style={[styles.value, valueIsPlaceholder && styles.valuePlaceholder]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
      ) : null}
      {right !== undefined ? <View style={styles.right}>{right}</View> : null}
      {showChevron ? <Text style={styles.chevron}>›</Text> : null}
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
      gap: 10,
      backgroundColor: colors.inputBackground,
    },
    rowPressed: {
      backgroundColor: colors.surfaceHover,
    },
    rowDisabled: {
      opacity: 0.45,
    },
    left: {
      marginRight: 2,
    },
    labelBlock: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    label: {
      fontSize: 15,
      color: colors.text,
    },
    labelDestructive: {
      color: colors.danger,
    },
    sublabel: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.textTertiary,
    },
    value: {
      maxWidth: '55%',
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'right',
    },
    valuePlaceholder: {
      color: colors.textTertiary,
    },
    right: {
      flexShrink: 0,
    },
    chevron: {
      fontSize: 20,
      lineHeight: 22,
      color: colors.textTertiary,
      marginLeft: -2,
    },
  });
