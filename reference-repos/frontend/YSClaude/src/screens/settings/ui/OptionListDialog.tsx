import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSettingsPageColors, type ThemeColors } from '../../../theme/colors';

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
  sublabel?: string;
};

export type OptionListDialogProps<T extends string | number> = {
  visible: boolean;
  title: string;
  options: Array<SelectOption<T>>;
  value?: T;
  onSelect: (value: T) => void;
  onCancel: () => void;
};

/** iOS 风格选项列表弹窗：当前项右侧打勾，点选即回调关闭 */
export function OptionListDialog<T extends string | number>({
  visible,
  title,
  options,
  value,
  onSelect,
  onCancel,
}: OptionListDialogProps<T>) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={styles.list} bounces={false}>
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <Pressable
                  key={String(option.value)}
                  style={({ pressed }) => [
                    styles.option,
                    index > 0 && styles.optionBorder,
                    pressed && styles.optionPressed,
                  ]}
                  onPress={() => onSelect(option.value)}
                >
                  <View style={styles.optionTextBlock}>
                    <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                      {option.label}
                    </Text>
                    {option.sublabel ? (
                      <Text style={styles.optionSublabel}>{option.sublabel}</Text>
                    ) : null}
                  </View>
                  {selected ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
    },
    dialog: {
      width: '100%',
      maxWidth: 340,
      maxHeight: '70%',
      backgroundColor: colors.background,
      borderRadius: 14,
      paddingTop: 16,
      overflow: 'hidden',
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 8,
      paddingHorizontal: 18,
    },
    list: {
      flexGrow: 0,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 46,
      paddingHorizontal: 18,
      paddingVertical: 11,
      gap: 10,
    },
    optionBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    optionPressed: {
      backgroundColor: colors.surfaceHover,
    },
    optionTextBlock: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    optionLabel: {
      fontSize: 15,
      color: colors.text,
    },
    optionLabelSelected: {
      color: colors.primary,
      fontWeight: '600',
    },
    optionSublabel: {
      fontSize: 12,
      color: colors.textTertiary,
    },
    check: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.primary,
    },
    cancelButton: {
      alignItems: 'center',
      paddingVertical: 13,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    cancelText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
  });
