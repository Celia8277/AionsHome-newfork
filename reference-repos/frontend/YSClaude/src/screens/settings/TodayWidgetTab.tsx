import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { useSettingsPageColors } from '../../theme/colors';
import { useSettingsStore } from '../../stores/settings';
import { syncTodayWidget } from '../../services/todayWidget';
import { copyFileFromUri } from '../../utils/fileSystem';
import { createSettingsStyles } from './styles';
import { ButtonRow, SettingsGroup, SettingsRow, TextEditRow } from './ui';

type TodayWidgetTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const WIDGET_AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const WIDGET_AVATAR_MIN_SIDE = 64;
const WIDGET_AVATAR_MAX_SIDE = 4096;

function widgetAvatarExtension(asset: ImagePicker.ImagePickerAsset): string {
  const mimeType = asset.mimeType?.toLowerCase();
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/png') return '.png';
  const cleanUri = asset.uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.jpg') || cleanUri.endsWith('.jpeg')) return '.jpg';
  if (cleanUri.endsWith('.webp')) return '.webp';
  return '.png';
}

function validateWidgetAvatar(asset: ImagePicker.ImagePickerAsset): string | null {
  if (asset.fileSize && asset.fileSize > WIDGET_AVATAR_MAX_BYTES) return '图片不能超过 4MB';
  if (asset.width < WIDGET_AVATAR_MIN_SIDE || asset.height < WIDGET_AVATAR_MIN_SIDE) {
    return `图片边长至少 ${WIDGET_AVATAR_MIN_SIDE}px`;
  }
  if (asset.width > WIDGET_AVATAR_MAX_SIDE || asset.height > WIDGET_AVATAR_MAX_SIDE) {
    return `图片边长不能超过 ${WIDGET_AVATAR_MAX_SIDE}px`;
  }
  return null;
}

async function copyWidgetAvatar(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const dir = new Directory(Paths.document, 'today-widget');
  dir.create({ intermediates: true, idempotent: true });
  const destination = new File(dir, `avatar-${randomUUID()}${widgetAvatarExtension(asset)}`);
  await copyFileFromUri(asset.uri, destination);
  return destination.uri;
}

export function TodayWidgetTab({ showToast, keyboardBottomInset }: TodayWidgetTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const { todayWidgetConfig, appearanceConfig, setTodayWidgetConfig } = useSettingsStore();
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const effectiveAvatarUri = todayWidgetConfig.avatarUri || appearanceConfig?.userAvatarImageUri;
  const effectiveDisplayName = todayWidgetConfig.displayName || 'user';
  const effectiveHandle = todayWidgetConfig.handle || 'ysclaude';

  async function pickAvatar() {
    if (pickingAvatar) return;
    setPickingAvatar(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]?.uri) return;

      const asset = result.assets[0];
      const validationError = validateWidgetAvatar(asset);
      if (validationError) {
        Alert.alert('图片不适合作为小组件头像', validationError);
        return;
      }

      const uri = await copyWidgetAvatar(asset);
      setTodayWidgetConfig({ avatarUri: uri });
      await syncTodayWidget();
      showToast('小组件头像已更新');
    } catch (error: any) {
      Alert.alert('选择头像失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingAvatar(false);
    }
  }

  async function syncWidget() {
    setSyncing(true);
    try {
      await syncTodayWidget();
      showToast('小组件已同步');
    } catch (error: any) {
      Alert.alert('同步失败', error?.message || '请重新安装包含小组件的 Android 包');
    } finally {
      setSyncing(false);
    }
  }

  function updateConfig(patch: Parameters<typeof setTodayWidgetConfig>[0]) {
    setTodayWidgetConfig(patch);
    setTimeout(() => syncTodayWidget().catch(() => undefined), 0);
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <SettingsGroup
        header="Android 小组件"
        footer="桌面小组件会显示今天的应用内待办，主题颜色跟随系统日夜间。"
      >
        <SettingsRow
          label="头像"
          sublabel={todayWidgetConfig.avatarUri ? '已使用小组件专属头像' : '默认跟随聊天用户头像'}
          left={
            <View style={[styles.appearanceImagePreview, { borderRadius: 29 }]}>
              {effectiveAvatarUri ? (
                <Image source={{ uri: effectiveAvatarUri }} style={styles.appearanceImageThumb} resizeMode="cover" />
              ) : (
                <Text style={styles.appearanceImagePlaceholder}>YS</Text>
              )}
            </View>
          }
          right={
            <View style={styles.appearanceIconActions}>
              <Pressable
                style={[styles.smallActionButton, pickingAvatar && styles.smallActionButtonDisabled]}
                onPress={pickAvatar}
                disabled={pickingAvatar}
              >
                {pickingAvatar ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>替换</Text>}
              </Pressable>
              <Pressable
                style={[styles.smallActionButton, !todayWidgetConfig.avatarUri && styles.smallActionButtonDisabled]}
                onPress={() => updateConfig({ avatarUri: undefined })}
                disabled={!todayWidgetConfig.avatarUri}
              >
                <Text style={[styles.smallActionText, !todayWidgetConfig.avatarUri && styles.smallActionTextDisabled]}>默认</Text>
              </Pressable>
            </View>
          }
        />
        <TextEditRow
          label="显示名"
          value={todayWidgetConfig.displayName || ''}
          placeholder={effectiveDisplayName}
          onSave={(value) => updateConfig({ displayName: value })}
        />
        <TextEditRow
          label="Handle"
          value={todayWidgetConfig.handle || ''}
          placeholder={effectiveHandle}
          onSave={(value) => updateConfig({ handle: value })}
        />
        <TextEditRow
          label="4x4 签名"
          value={todayWidgetConfig.quote || ''}
          placeholder="One thing at a time."
          multiline
          onSave={(value) => updateConfig({ quote: value })}
        />
      </SettingsGroup>

      <SettingsGroup
        header="预览数据"
        footer="中间列表会自动读取今天在「日历」里创建的待办。"
      >
        <SettingsRow
          label={`${effectiveDisplayName} @${effectiveHandle.replace(/^@+/, '')}`}
        />
      </SettingsGroup>

      <SettingsGroup>
        <ButtonRow label="立即同步小组件" onPress={syncWidget} loading={syncing} />
      </SettingsGroup>
    </ScrollView>
  );
}
