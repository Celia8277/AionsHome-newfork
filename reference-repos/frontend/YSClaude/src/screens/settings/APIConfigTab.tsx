import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSettingsPageColors } from '../../theme/colors';
import {
  useSettingsStore,
  type NamedAPIConfig,
  type PromptCacheCompatibility,
  type PromptCacheTtl,
  type ThinkingCompatibility,
  type ThinkingEffort,
} from '../../stores/settings';
import { useChatStore } from '../../stores/chat';
import { applyThinkingConfig } from '../../services/api';
import { createAndShareBackup, pickBackupFile, restoreBackup, type PickedBackup } from '../../services/backup';
import { disablePromptCacheRemoteKeepalive } from '../../services/promptCacheKeepalive';
import { formatFullTime } from '../../utils/time';
import { createSettingsStyles } from './styles';
import { ButtonRow, OptionListDialog, SelectRow, SettingsGroup, SwitchRow, TextEditRow } from './ui';

type SettingsTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
  section?: 'all' | 'chat' | 'image' | 'backup';
  embedded?: boolean;
};

const IMAGE_SIZE_OPTIONS = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const;
const IMAGE_QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;
const PROMPT_CACHE_COMPATIBILITY_OPTIONS: Array<{ value: PromptCacheCompatibility; label: string }> = [
  { value: 'standard', label: '标准' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'nanogpt', label: 'NanoGPT' },
];
const PROMPT_CACHE_TTL_OPTIONS: Array<{ value: PromptCacheTtl; label: string }> = [
  { value: '5m', label: '5min' },
  { value: '1h', label: '1h' },
];
const THINKING_COMPATIBILITY_OPTIONS: Array<{ value: ThinkingCompatibility; label: string }> = [
  { value: 'standard', label: '标准' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'nanogpt', label: 'NanoGPT/CLIProxyAPI' },
];
const THINKING_EFFORT_OPTIONS: Array<{ value: ThinkingEffort; label: string }> = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];
type ModelPickerTarget = 'chat' | 'image';

export function APIConfigTab({
  showToast,
  keyboardBottomInset,
  section = 'all',
  embedded = false,
}: SettingsTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const router = useRouter();
  const {
    _hydrated,
    apiConfigs,
    activeConfigIndex,
    imageGenerationConfig,
    promptCacheConfig,
    saveAPIConfig,
    removeAPIConfig,
    setActiveConfig,
    setImageGenerationConfig,
    setPromptCacheConfig,
  } = useSettingsStore();
  const conversationId = useChatStore((state) => state.conversationId);

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState('');
  const [generateThinking, setGenerateThinking] = useState(false);
  const [returnNativeThinking, setReturnNativeThinking] = useState(false);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('high');
  const [thinkingCompatibility, setThinkingCompatibility] = useState<ThinkingCompatibility>('standard');
  const [promptCacheCompatibility, setPromptCacheCompatibility] = useState<PromptCacheCompatibility>('standard');
  const [imageEnabled, setImageEnabled] = useState(imageGenerationConfig?.enabled ?? false);
  const [imageBaseUrl, setImageBaseUrl] = useState(imageGenerationConfig?.baseUrl || '');
  const [imageApiKey, setImageApiKey] = useState(imageGenerationConfig?.apiKey || '');
  const [imageModel, setImageModel] = useState(imageGenerationConfig?.model || 'gpt-image-2');
  const [imageSize, setImageSize] = useState(imageGenerationConfig?.size || '1024x1024');
  const [imageQuality, setImageQuality] = useState(imageGenerationConfig?.quality || 'auto');
  const [models, setModels] = useState<string[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelPickerTarget, setModelPickerTarget] = useState<ModelPickerTarget>('chat');
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const promptCacheTtl: PromptCacheTtl = promptCacheConfig?.ttl === '1h' ? '1h' : '5m';

  useEffect(() => {
    if (_hydrated && apiConfigs.length > 0) {
      loadConfig(activeConfigIndex);
    }
  }, [_hydrated]);

  useEffect(() => {
    if (!_hydrated) return;
    setImageEnabled(imageGenerationConfig?.enabled ?? false);
    setImageBaseUrl(imageGenerationConfig?.baseUrl || '');
    setImageApiKey(imageGenerationConfig?.apiKey || '');
    setImageModel(imageGenerationConfig?.model || 'gpt-image-2');
    setImageSize(imageGenerationConfig?.size || '1024x1024');
    setImageQuality(imageGenerationConfig?.quality || 'auto');
  }, [_hydrated, imageGenerationConfig]);

  function loadConfig(index: number) {
    const config = apiConfigs[index];
    if (config) {
      setName(config.name);
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setModel(config.model);
      setTemperature(typeof config.temperature === 'number' ? String(config.temperature) : '');
      setGenerateThinking(!!config.generateThinking);
      setReturnNativeThinking(!!config.returnNativeThinking);
      setThinkingEffort(config.thinkingEffort || 'high');
      setThinkingCompatibility(config.thinkingCompatibility || 'standard');
      setPromptCacheCompatibility(config.promptCacheCompatibility || 'standard');
    }
  }

  function handleNew() {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setTemperature('');
    setGenerateThinking(false);
    setReturnNativeThinking(false);
    setThinkingEffort('high');
    setThinkingCompatibility('standard');
    setPromptCacheCompatibility('standard');
    setModels([]);
  }

  function resolveModelFetchCredentials(target: ModelPickerTarget) {
    if (target === 'chat') {
      return {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
      };
    }

    const activeConfig = apiConfigs[activeConfigIndex];
    return {
      baseUrl: imageBaseUrl.trim() || activeConfig?.baseUrl?.trim() || '',
      apiKey: imageApiKey.trim() || activeConfig?.apiKey?.trim() || '',
    };
  }

  function parseOptionalTemperature(value: string): number | undefined | null {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) return null;
    return parsed;
  }

  async function handleFetchModels(target: ModelPickerTarget = 'chat') {
    const credentials = resolveModelFetchCredentials(target);
    if (!credentials.baseUrl || !credentials.apiKey) {
      Alert.alert('提示', '请先填写 Base URL 和 API Key');
      return;
    }
    setFetching(true);
    try {
      const url = `${credentials.baseUrl.replace(/\/$/, '')}/models`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const ids: string[] = (data.data || []).map((m: any) => m.id).sort();
      if (ids.length === 0) {
        Alert.alert('提示', '未获取到模型列表');
      } else {
        setModels(ids);
        setModelPickerTarget(target);
        setShowModelPicker(true);
      }
    } catch (e: any) {
      Alert.alert('获取失败', e.message);
    } finally {
      setFetching(false);
    }
  }

  async function handleTest() {
    if (!baseUrl || !apiKey || !model) {
      Alert.alert('提示', '请填写完整配置');
      return;
    }
    setTesting(true);
    try {
      const parsedTemperature = parseOptionalTemperature(temperature);
      if (parsedTemperature === null) {
        Alert.alert('提示', 'temperature 必须是 0 到 2 之间的数字，或留空使用服务默认值');
        return;
      }
      const url = `${baseUrl.trim().replace(/\/$/, '')}/chat/completions`;
      const body: Record<string, any> = {
        model: model.trim(),
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: generateThinking ? 64 : 5,
        ...(parsedTemperature !== undefined ? { temperature: parsedTemperature } : {}),
      };
      applyThinkingConfig(body, generateThinking, thinkingCompatibility, thinkingEffort);
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 100)}`);
      }
      showToast('API 配置有效');
    } catch (e: any) {
      Alert.alert('连接失败', e.message);
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) { Alert.alert('提示', '请输入配置名称'); return; }
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      Alert.alert('提示', '请填写完整配置'); return;
    }
    const parsedTemperature = parseOptionalTemperature(temperature);
    if (parsedTemperature === null) {
      Alert.alert('提示', 'temperature 必须是 0 到 2 之间的数字，或留空使用服务默认值');
      return;
    }
    const config: NamedAPIConfig = {
      name: trimmedName, baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(),
      ...(parsedTemperature !== undefined ? { temperature: parsedTemperature } : {}),
      generateThinking,
      thinkingEffort,
      returnNativeThinking,
      thinkingCompatibility,
      promptCacheCompatibility,
    };
    saveAPIConfig(config);
    const newIndex = useSettingsStore.getState().apiConfigs.findIndex((c) => c.name === trimmedName);
    if (newIndex >= 0) setActiveConfig(newIndex);
    showToast(`配置「${trimmedName}」已保存`);
  }

  function handleUseCurrentChatAPIForImage() {
    const config = apiConfigs[activeConfigIndex];
    if (!config) {
      Alert.alert('提示', '请先保存一个聊天 API 配置');
      return;
    }
    setImageBaseUrl(config.baseUrl);
    setImageApiKey(config.apiKey);
    showToast('已填入当前聊天 API 的 Base URL 和 Key');
  }

  function handleSaveImageAPI() {
    setImageGenerationConfig({
      enabled: imageEnabled,
      baseUrl: imageBaseUrl.trim(),
      apiKey: imageApiKey.trim(),
      model: imageModel.trim() || 'gpt-image-2',
      size: imageSize || '1024x1024',
      quality: imageQuality || 'auto',
    });
    showToast(imageEnabled ? '生图 API 已保存并启用' : '生图 API 已保存');
  }

  function handleSelectModel(item: string) {
    if (modelPickerTarget === 'image') {
      setImageModel(item);
    } else {
      setModel(item);
    }
    setShowModelPicker(false);
  }

  function handleSelectConfig(index: number) {
    setActiveConfig(index);
    loadConfig(index);
  }

  function handleDeleteConfig(index: number) {
    const config = apiConfigs[index];
    Alert.alert('删除配置', `确定删除「${config.name}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: () => {
          removeAPIConfig(index);
          if (apiConfigs.length > 1) loadConfig(0);
          else handleNew();
        },
      },
    ]);
  }

  async function handleCreateBackup() {
    if (creatingBackup || restoringBackup) return;
    setCreatingBackup(true);
    try {
      const result = await createAndShareBackup();
      showToast(result.shared ? '备份包已创建，请选择 Google Drive 保存' : '备份包已创建');
      if (!result.shared) {
        Alert.alert('备份已创建', `文件已保存到本机：\n${result.uri}`);
      }
    } catch (error: any) {
      Alert.alert('创建备份失败', error?.message || '无法创建备份包');
    } finally {
      setCreatingBackup(false);
    }
  }

  async function handlePickRestoreBackup() {
    if (creatingBackup || restoringBackup) return;
    setRestoringBackup(true);
    try {
      const backup = await pickBackupFile();
      if (!backup) {
        setRestoringBackup(false);
        return;
      }
      Alert.alert(
        '覆盖恢复备份',
        [
          `文件：${backup.fileName}`,
          `创建时间：${formatBackupTime(backup.manifest.createdAt)}`,
          `App 版本：${backup.manifest.appVersion}`,
          '',
          '恢复会覆盖当前本地数据。继续前会自动保存一份恢复前快照。',
        ].join('\n'),
        [
          {
            text: '取消',
            style: 'cancel',
            onPress: () => setRestoringBackup(false),
          },
          {
            text: '覆盖恢复',
            style: 'destructive',
            onPress: () => confirmRestoreBackup(backup),
          },
        ]
      );
    } catch (error: any) {
      setRestoringBackup(false);
      Alert.alert('读取备份失败', error?.message || '无法读取备份包');
    }
  }

  async function confirmRestoreBackup(backup: PickedBackup) {
    try {
      const result = await restoreBackup(backup);
      Alert.alert(
        '恢复完成',
        [
          `已恢复 ${formatBackupTime(result.manifest.createdAt)} 创建的备份。`,
          `恢复前快照已保存在：\n${result.localSnapshotUri}`,
          '',
          '请完全关闭并重新打开 App，让设置和数据库重新加载。',
        ].join('\n')
      );
    } catch (error: any) {
      Alert.alert('恢复失败', error?.message || '无法覆盖恢复备份');
    } finally {
      setRestoringBackup(false);
    }
  }

  function formatBackupTime(value: string): string {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? formatFullTime(timestamp) : value;
  }

  if (!_hydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const content = (
    <>
      {(section === 'all' || section === 'chat') && (
        <>
      {apiConfigs.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>已保存配置</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
            {apiConfigs.map((c, i) => (
              <Pressable
                key={i}
                style={[styles.configChip, i === activeConfigIndex && styles.configChipActive]}
                onPress={() => handleSelectConfig(i)}
                onLongPress={() => handleDeleteConfig(i)}
              >
                <Text style={[styles.configChipText, i === activeConfigIndex && styles.configChipTextActive]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
            <Pressable style={styles.configChip} onPress={handleNew}>
              <Text style={styles.configChipText}>＋ 新建</Text>
            </Pressable>
          </ScrollView>
        </>
      )}

      <SettingsGroup header="API 配置">
        <TextEditRow
          label="配置名称"
          value={name}
          inputPlaceholder="例如：Claude 中转"
          onSave={(value) => setName(value)}
        />
        <TextEditRow
          label="Base URL"
          value={baseUrl}
          inputPlaceholder="https://api.openai.com/v1"
          onSave={(value) => setBaseUrl(value)}
        />
        <TextEditRow
          label="API Key"
          value={apiKey}
          secure
          inputPlaceholder="sk-..."
          onSave={(value) => setApiKey(value)}
        />
        <TextEditRow
          label="Model"
          value={model}
          inputPlaceholder="claude-sonnet-4-6"
          onSave={(value) => setModel(value)}
        />
        <ButtonRow
          label="拉取模型列表"
          onPress={() => handleFetchModels('chat')}
          loading={fetching && !showModelPicker}
          disabled={fetching}
        />
        <TextEditRow
          label="Temperature"
          value={temperature}
          placeholder="服务默认"
          keyboardType="decimal-pad"
          dialogDescription="0 到 2 之间的数字，留空使用服务默认值"
          validate={(text) => (parseOptionalTemperature(text) === null ? '必须是 0 到 2 之间的数字，或留空' : null)}
          onSave={(value) => setTemperature(value.trim())}
        />
      </SettingsGroup>

      <SettingsGroup
        header="思维链"
        footer="标准和 OpenRouter 使用 reasoning.effort；NanoGPT 额外发送 reasoning_effort。强度越高通常思考更充分，但可能更慢、消耗更多 reasoning tokens。"
      >
        <SwitchRow
          label="让 AI 生成思维链"
          sublabel="开启后，请求会按所选渠道附加 reasoning 参数"
          value={generateThinking}
          onValueChange={setGenerateThinking}
        />
        <SelectRow
          label="Thinking 强度"
          options={THINKING_EFFORT_OPTIONS}
          value={thinkingEffort}
          onSelect={(value) => setThinkingEffort(value as ThinkingEffort)}
        />
        <SelectRow
          label="Thinking 渠道"
          options={THINKING_COMPATIBILITY_OPTIONS}
          value={thinkingCompatibility}
          onSelect={(value) => setThinkingCompatibility(value as ThinkingCompatibility)}
        />
        <SwitchRow
          label="返回原生思维链"
          sublabel="开启后会显示兼容接口返回的 reasoning_content；关闭后忽略该字段"
          value={returnNativeThinking}
          onValueChange={setReturnNativeThinking}
        />
      </SettingsGroup>

      <SettingsGroup
        header="Prompt 缓存"
        footer="OpenRouter 直接透传 inline cache_control；NanoGPT 会额外发送 promptCaching 与 1h beta header。5min 使用 Claude 默认短缓存；1h 会在 cache_control 中附加 ttl，并可配合对话设置里的远程保活。"
      >
        <SelectRow
          label="缓存渠道"
          options={PROMPT_CACHE_COMPATIBILITY_OPTIONS}
          value={promptCacheCompatibility}
          onSelect={(value) => setPromptCacheCompatibility(value as PromptCacheCompatibility)}
        />
        <SwitchRow
          label="启用 cache_control"
          sublabel="开启后请求会透传 session_id，并在稳定 system prompt 与历史对话末尾添加 cache_control。仅在你的 API 中转支持该字段时开启。"
          value={!!promptCacheConfig?.enabled}
          onValueChange={(value) => {
            setPromptCacheConfig({ enabled: value });
            if (!value && conversationId) {
              disablePromptCacheRemoteKeepalive(conversationId).catch(() => undefined);
            }
            showToast(value ? 'Prompt 缓存已开启' : 'Prompt 缓存已关闭');
          }}
        />
        <SelectRow
          label="缓存时间"
          options={PROMPT_CACHE_TTL_OPTIONS}
          value={promptCacheTtl}
          onSelect={(value) => {
            setPromptCacheConfig({ ttl: value as PromptCacheTtl });
            if (value !== '1h' && conversationId) {
              disablePromptCacheRemoteKeepalive(conversationId).catch(() => undefined);
            }
            showToast(`Prompt 缓存时间已设为 ${value}`);
          }}
        />
      </SettingsGroup>

      <SettingsGroup>
        <ButtonRow label="测试连接" onPress={handleTest} loading={testing} />
        <ButtonRow label="保存配置" onPress={handleSave} />
      </SettingsGroup>
        </>
      )}

      {(section === 'all' || section === 'image') && <SettingsGroup
        header="AI 生图 API"
        footer="识别 AI 回复里的 [Pic:图片描述] 后调用 OpenAI 兼容生图接口；有参考图或锁脸图时会走 /images/edits。Base URL 和 Key 留空时会沿用当前聊天 API 配置。"
      >
        <SwitchRow
          label="启用 AI 生图"
          sublabel="关闭后 [Pic:...] 只按普通文本保留，不会生成图片"
          value={imageEnabled}
          onValueChange={setImageEnabled}
        />
        <TextEditRow
          label="Base URL"
          value={imageBaseUrl}
          placeholder="沿用聊天 API"
          onSave={(value) => setImageBaseUrl(value)}
        />
        <TextEditRow
          label="API Key"
          value={imageApiKey}
          secure
          placeholder="沿用聊天 API"
          onSave={(value) => setImageApiKey(value)}
        />
        <TextEditRow
          label="生图模型"
          value={imageModel}
          inputPlaceholder="gpt-image-2"
          onSave={(value) => setImageModel(value)}
        />
        <ButtonRow
          label="拉取生图模型列表"
          onPress={() => handleFetchModels('image')}
          disabled={fetching}
        />
        <SelectRow
          label="图片尺寸"
          options={IMAGE_SIZE_OPTIONS.map((item) => ({ value: item, label: item }))}
          value={imageSize}
          onSelect={(value) => setImageSize(value)}
        />
        <SelectRow
          label="图片质量"
          options={IMAGE_QUALITY_OPTIONS.map((item) => ({ value: item, label: item }))}
          value={imageQuality}
          onSelect={(value) => setImageQuality(value)}
        />
        <ButtonRow label="沿用当前聊天 API 的地址和 Key" onPress={handleUseCurrentChatAPIForImage} />
        <ButtonRow label="保存生图 API" onPress={handleSaveImageAPI} />
      </SettingsGroup>}

      {(section === 'all' || section === 'backup') && <SettingsGroup
        header="数据备份"
        footer="创建完整备份包后可分享到 Google Drive；恢复时从 Google Drive 选择备份 zip，并覆盖当前本地数据。"
      >
        <ButtonRow
          label="创建备份并分享"
          onPress={handleCreateBackup}
          loading={creatingBackup}
          disabled={creatingBackup || restoringBackup}
        />
        <ButtonRow
          label="从备份恢复"
          destructive
          onPress={handlePickRestoreBackup}
          loading={restoringBackup}
          disabled={creatingBackup || restoringBackup}
        />
        <ButtonRow label="打开聊天数据库诊断" onPress={() => router.push('/chat-diagnostics')} />
        <ButtonRow label="打开 API 使用日志" onPress={() => router.push('/api-usage')} />
        <ButtonRow label="打开 API 成就徽章" onPress={() => router.push('/api-achievements')} />
      </SettingsGroup>}

      {/* Model picker */}
      <OptionListDialog
        visible={showModelPicker}
        title={modelPickerTarget === 'image' ? '选择生图模型' : '选择聊天模型'}
        options={models.map((item) => ({ value: item, label: item }))}
        value={modelPickerTarget === 'image' ? imageModel : model}
        onCancel={() => setShowModelPicker(false)}
        onSelect={handleSelectModel}
      />
    </>
  );

  if (embedded) return <View>{content}</View>;

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {content}
    </ScrollView>
  );
}
