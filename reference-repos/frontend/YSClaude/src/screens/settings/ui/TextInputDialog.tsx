import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { useSettingsPageColors, type ThemeColors } from '../../../theme/colors';

export type TextInputDialogProps = {
  visible: boolean;
  title: string;
  description?: string;
  /** 打开时的初始文本 */
  initialValue: string;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** 返回错误信息则不关闭并显示红字；返回 null 表示通过 */
  validate?: (text: string) => string | null;
  onSave: (text: string) => void;
  onCancel: () => void;
  saveText?: string;
};

/** iOS 风格文本输入弹窗：标题 + 输入框 + 取消/保存 */
export function TextInputDialog({
  visible,
  title,
  description,
  initialValue,
  placeholder,
  multiline,
  keyboardType,
  secureTextEntry,
  autoCapitalize = 'none',
  validate,
  onSave,
  onCancel,
  saveText = '保存',
}: TextInputDialogProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [text, setText] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setText(initialValue);
      setError(null);
      // Modal 动画完成后再 focus，Android 上立即 focus 可能不弹键盘
      const timer = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(timer);
    }
  }, [visible, initialValue]);

  function handleSave() {
    if (validate) {
      const message = validate(text);
      if (message) {
        setError(message);
        return;
      }
    }
    onSave(text);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
          {multiline ? (
            <ScrollView style={styles.multilineScroll} keyboardShouldPersistTaps="handled">
              <TextInput
                ref={inputRef}
                style={[styles.input, styles.inputMultiline]}
                value={text}
                onChangeText={(value) => {
                  setText(value);
                  if (error) setError(null);
                }}
                placeholder={placeholder}
                placeholderTextColor={colors.textTertiary}
                multiline
                textAlignVertical="top"
                autoCapitalize={autoCapitalize}
              />
            </ScrollView>
          ) : (
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={text}
              onChangeText={(value) => {
                setText(value);
                if (error) setError(null);
              }}
              placeholder={placeholder}
              placeholderTextColor={colors.textTertiary}
              keyboardType={keyboardType}
              secureTextEntry={secureTextEntry}
              autoCapitalize={autoCapitalize}
              returnKeyType="done"
              onSubmitEditing={handleSave}
              selectTextOnFocus
            />
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable style={styles.actionButton} onPress={onCancel}>
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={handleSave}>
              <Text style={styles.saveText}>{saveText}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
      paddingHorizontal: 28,
    },
    dialog: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: colors.background,
      borderRadius: 14,
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 8,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 6,
    },
    description: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.textTertiary,
      textAlign: 'center',
      marginBottom: 8,
    },
    input: {
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
      marginTop: 6,
    },
    multilineScroll: {
      maxHeight: 260,
      marginTop: 6,
    },
    inputMultiline: {
      minHeight: 120,
      marginTop: 0,
    },
    error: {
      fontSize: 12,
      color: colors.danger,
      marginTop: 8,
      textAlign: 'center',
    },
    actions: {
      flexDirection: 'row',
      marginTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    actionButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 13,
    },
    cancelText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    saveText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.primary,
    },
  });
