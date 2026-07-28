import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSettingsPageColors, type ThemeColors } from '../../../theme/colors';

export type MultiSelectOption = { value: string; label: string; sublabel?: string };

export function MultiSelectDialog({ visible, title, options, values, onChange, onCancel }: {
  visible: boolean;
  title: string;
  options: MultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  onCancel: () => void;
}) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const selected = new Set(values);
  const toggle = (value: string) => onChange(selected.has(value) ? values.filter((item) => item !== value) : [...values, value]);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={onCancel} /><View style={styles.dialog}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.actions}><Pressable onPress={() => onChange(options.map((item) => item.value))}><Text style={styles.action}>全选</Text></Pressable><Pressable onPress={() => onChange([])}><Text style={styles.action}>清空</Text></Pressable></View>
      <ScrollView style={styles.list}>{options.map((option, index) => <Pressable key={option.value} style={[styles.option, index > 0 && styles.border]} onPress={() => toggle(option.value)}>
        <View style={styles.text}><Text style={[styles.label, selected.has(option.value) && styles.selected]}>{option.label}</Text>{option.sublabel ? <Text style={styles.sublabel}>{option.sublabel}</Text> : null}</View>
        <Text style={[styles.check, !selected.has(option.value) && styles.unchecked]}>{selected.has(option.value) ? '✓' : '○'}</Text>
      </Pressable>)}</ScrollView>
      <Pressable style={styles.done} onPress={onCancel}><Text style={styles.doneText}>完成</Text></Pressable>
    </View></View>
  </Modal>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.35)', justifyContent: 'center', paddingHorizontal: 28 },
  dialog: { maxHeight: '82%', backgroundColor: colors.inputBackground, borderRadius: 14, overflow: 'hidden' },
  title: { padding: 16, paddingBottom: 8, fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 10 },
  action: { color: colors.primary, fontSize: 14 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  option: { minHeight: 50, paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 12 },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  text: { flex: 1 }, label: { color: colors.text, fontSize: 15 }, selected: { color: colors.primary, fontWeight: '600' },
  sublabel: { color: colors.textTertiary, fontSize: 11, marginTop: 2 }, check: { color: colors.primary, fontSize: 18 }, unchecked: { color: colors.textTertiary },
  done: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 14 }, doneText: { color: colors.primary, textAlign: 'center', fontWeight: '600' },
});
