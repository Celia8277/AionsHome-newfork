import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useSettingsPageColors } from '../../theme/colors';
import { useSettingsStore } from '../../stores/settings';
import type { IncomingLetterOccasion } from '../../types';
import { formatDateOnly } from '../../utils/time';
import { generateImmediateIncomingLetter } from '../../services/incomingLetters';
import { createSettingsStyles } from './styles';
import { ButtonRow, SettingsGroup, SettingsRow, SwitchRow } from './ui';

type IncomingLetterTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

function validateIncomingLetterDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => parseInt(part, 10));
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function IncomingLetterTab({ showToast, keyboardBottomInset }: IncomingLetterTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const {
    incomingLetterConfig,
    setIncomingLetterConfig,
    addIncomingLetterOccasion,
    updateIncomingLetterOccasion,
    removeIncomingLetterOccasion,
  } = useSettingsStore();
  const occasions = incomingLetterConfig?.occasions || [];
  const [editing, setEditing] = useState<IncomingLetterOccasion | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [draftRepeatYearly, setDraftRepeatYearly] = useState(true);
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('');
  const [generatingOccasionId, setGeneratingOccasionId] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setDraftTitle('');
    setDraftDate(formatDateOnly(Date.now()));
    setDraftRepeatYearly(true);
    setDraftEnabled(true);
    setDraftSystemPrompt('');
    setCreating(true);
  }

  function openEdit(occasion: IncomingLetterOccasion) {
    setEditing(occasion);
    setDraftTitle(occasion.title);
    setDraftDate(occasion.date);
    setDraftRepeatYearly(occasion.repeatYearly);
    setDraftEnabled(occasion.enabled);
    setDraftSystemPrompt(occasion.systemPrompt);
    setCreating(true);
  }

  function closeEditor() {
    setCreating(false);
    setEditing(null);
  }

  function handleSaveDraft() {
    const title = draftTitle.trim();
    const date = draftDate.trim();
    if (!title) {
      Alert.alert('提示', '请填写收信日名称');
      return;
    }
    if (!validateIncomingLetterDate(date)) {
      Alert.alert('提示', '日期格式应为 YYYY-MM-DD');
      return;
    }

    const now = Date.now();
    if (editing) {
      updateIncomingLetterOccasion(editing.id, {
        title,
        date,
        repeatYearly: draftRepeatYearly,
        enabled: draftEnabled,
        systemPrompt: draftSystemPrompt.trim(),
        updatedAt: now,
      });
      showToast('收信日已更新');
    } else {
      addIncomingLetterOccasion({
        id: randomUUID(),
        title,
        date,
        repeatYearly: draftRepeatYearly,
        enabled: draftEnabled,
        systemPrompt: draftSystemPrompt.trim(),
        createdAt: now,
        updatedAt: now,
      });
      showToast('收信日已添加');
    }
    closeEditor();
  }

  function handleDelete(occasion: IncomingLetterOccasion) {
    Alert.alert('删除收信日', `确定删除「${occasion.title || '收信日'}」？历史信件会保留。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          removeIncomingLetterOccasion(occasion.id);
          showToast('收信日已删除');
        },
      },
    ]);
  }

  async function handleGenerateNow(occasion: IncomingLetterOccasion) {
    if (generatingOccasionId) return;
    setGeneratingOccasionId(occasion.id);
    try {
      await generateImmediateIncomingLetter(occasion);
      showToast('测试来信已生成');
      Alert.alert('已生成来信', '回到首页后会弹出这封测试来信。');
    } catch (error: any) {
      Alert.alert('生成失败', error?.message || '无法生成测试来信');
    } finally {
      setGeneratingOccasionId(null);
    }
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <SettingsGroup footer="当天打开 App 或回到前台时，会为命中的收信日生成并保存一封信。">
        <SwitchRow
          label="启用来信"
          value={!!incomingLetterConfig?.enabled}
          onValueChange={(value) => {
            setIncomingLetterConfig({ enabled: value });
            showToast(value ? '来信已开启' : '来信已关闭');
          }}
        />
      </SettingsGroup>

      <SettingsGroup
        header="自定义收信日"
        footer={
          occasions.length === 0
            ? '暂无收信日。可以添加生日、纪念日或任何你想收到信的日子。'
            : '点击编辑收信日，右侧开关控制启用状态。'
        }
      >
        <ButtonRow label="＋ 新建收信日" onPress={openCreate} />
        {occasions.map((occasion) => (
          <SettingsRow
            key={occasion.id}
            label={occasion.title || '收信日'}
            sublabel={`${occasion.date} · ${occasion.repeatYearly ? '每年重复' : '仅此一次'} · ${occasion.systemPrompt ? '已设置专属 System Prompt' : '未设置 System Prompt'}`}
            onPress={() => openEdit(occasion)}
            onLongPress={() => handleDelete(occasion)}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable
                  style={[
                    styles.smallActionButton,
                    generatingOccasionId === occasion.id && styles.smallActionButtonDisabled,
                  ]}
                  onPress={() => handleGenerateNow(occasion)}
                  disabled={!!generatingOccasionId}
                >
                  {generatingOccasionId === occasion.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={styles.smallActionText}>立即来信</Text>
                  )}
                </Pressable>
                <Switch
                  value={occasion.enabled}
                  onValueChange={(enabled) => updateIncomingLetterOccasion(occasion.id, { enabled })}
                  trackColor={{ false: colors.inputBorder, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
            }
          />
        ))}
      </SettingsGroup>

      <Modal visible={creating} transparent animationType="fade" onRequestClose={closeEditor}>
        <View style={styles.overlay}>
          <View style={[styles.modal, styles.largeModal]}>
            <Text style={styles.modalTitle}>{editing ? '编辑收信日' : '新建收信日'}</Text>
            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.field}>
                <Text style={styles.label}>名称</Text>
                <TextInput
                  style={styles.input}
                  value={draftTitle}
                  onChangeText={setDraftTitle}
                  placeholder="生日 / 纪念日"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>日期</Text>
                <TextInput
                  style={styles.input}
                  value={draftDate}
                  onChangeText={setDraftDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.label}>每年重复</Text>
                <Switch
                  value={draftRepeatYearly}
                  onValueChange={setDraftRepeatYearly}
                  trackColor={{ false: colors.inputBorder, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.label}>启用这个收信日</Text>
                <Switch
                  value={draftEnabled}
                  onValueChange={setDraftEnabled}
                  trackColor={{ false: colors.inputBorder, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>System Prompt</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput, { minHeight: 180 }]}
                  value={draftSystemPrompt}
                  onChangeText={setDraftSystemPrompt}
                  multiline
                  textAlignVertical="top"
                  placeholder="这里写这个收信日专用的写信规则、语气、长度和输出格式。"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={closeEditor}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveDraft}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
