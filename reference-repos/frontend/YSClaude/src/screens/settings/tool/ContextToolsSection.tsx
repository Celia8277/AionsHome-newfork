import { useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useSettingsStore, type SubAgentProfile } from '../../../stores/settings';
import { getToolLabel, getToolPoolDefinitions } from '../../../services/tools';
import { ButtonRow, MultiSelectDialog, OptionListDialog, SettingsGroup, SettingsRow, SwitchRow, TextEditRow } from '../ui';

type ModelTarget = { kind: 'compression' } | { kind: 'agent'; profileId: string };

export function ContextToolsSection() {
  const {
    apiConfigs,
    activeConfigIndex,
    subAgentConfig,
    toolResultCompressionConfig,
    setSubAgentConfig,
    setToolResultCompressionConfig,
  } = useSettingsStore();
  const [models, setModels] = useState<string[]>([]);
  const [modelTarget, setModelTarget] = useState<ModelTarget | null>(null);
  const [fetchingTarget, setFetchingTarget] = useState<string | null>(null);
  const [apiPickerProfileId, setApiPickerProfileId] = useState<string | null>(null);
  const [toolPickerTarget, setToolPickerTarget] = useState<{ kind: 'agent'; profileId: string } | { kind: 'compression' } | null>(null);

  const toolPool = useMemo(() => {
    const definitions = getToolPoolDefinitions();
    return [...new Map(definitions.map((definition) => [definition.function.name, {
      value: definition.function.name,
      label: getToolLabel(definition.function.name),
      sublabel: definition.function.name,
    }])).values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  }, [subAgentConfig, apiConfigs]);

  const updateProfile = (id: string, patch: Partial<SubAgentProfile>) => {
    setSubAgentConfig({ profiles: subAgentConfig.profiles.map((profile) => profile.id === id ? { ...profile, ...patch } : profile) });
  };

  const addProfile = () => {
    const activeApi = apiConfigs[activeConfigIndex];
    setSubAgentConfig({ profiles: [...subAgentConfig.profiles, {
      id: randomUUID(),
      name: `子 Agent ${subAgentConfig.profiles.length + 1}`,
      description: '',
      enabled: true,
      apiConfigName: activeApi?.name || '',
      model: activeApi?.model || '',
      systemPrompt: '你是一个专注执行委派任务的子 Agent。完成任务后返回准确、精炼的结果。',
      allowedToolNames: [],
      maxToolCalls: 12,
      maxOutputTokens: 2000,
      maxRuntimeMs: 120000,
      maxNestingDepth: 0,
    }] });
  };

  const fetchModels = async (target: ModelTarget) => {
    const profile = target.kind === 'agent' ? subAgentConfig.profiles.find((item) => item.id === target.profileId) : undefined;
    const api = profile ? apiConfigs.find((item) => item.name === profile.apiConfigName) : undefined;
    const baseUrl = target.kind === 'compression' ? toolResultCompressionConfig.baseUrl.trim() : api?.baseUrl.trim() || '';
    const apiKey = target.kind === 'compression' ? toolResultCompressionConfig.apiKey.trim() : api?.apiKey.trim() || '';
    if (!baseUrl || !apiKey) {
      Alert.alert('提示', target.kind === 'compression' ? '请先填写 API 地址和 API Key' : '请先选择有效的 API 配置');
      return;
    }
    const targetKey = target.kind === 'compression' ? 'compression' : target.profileId;
    setFetchingTarget(targetKey);
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const ids = Array.from(new Set<string>((data.data || []).map((item: any) => String(item.id || '')).filter(Boolean))).sort();
      if (ids.length === 0) return Alert.alert('提示', '未获取到模型列表');
      setModels(ids);
      setModelTarget(target);
    } catch (error: any) {
      Alert.alert('获取模型失败', error?.message || '无法获取模型列表');
    } finally {
      setFetchingTarget(null);
    }
  };

  return (
    <>
      <SettingsGroup header="子 Agent" footer="派发工具的总开关位于“内置工具 → 命令与自动化”。每个 Agent可使用独立 API 配置、模型、提示词和权限。">
        <SettingsRow label="已配置 Agent" value={`${subAgentConfig.profiles.length} 个`} />
        <ButtonRow label="添加子 Agent" onPress={addProfile} />
      </SettingsGroup>

      {subAgentConfig.profiles.map((profile) => (
        <SettingsGroup key={profile.id} header={profile.name} footer={`Agent ID：${profile.id}`}>
          <SwitchRow label="启用此 Agent" value={profile.enabled} onValueChange={(enabled) => updateProfile(profile.id, { enabled })} />
          <TextEditRow label="名称" value={profile.name} onSave={(name) => updateProfile(profile.id, { name: name.trim() || profile.name })} />
          <TextEditRow label="用途说明" value={profile.description} multiline onSave={(description) => updateProfile(profile.id, { description })} />
          <SettingsRow label="API 配置" value={profile.apiConfigName} placeholder="未选择" showChevron onPress={() => setApiPickerProfileId(profile.id)} />
          <TextEditRow label="模型" sublabel="留空则使用 API 配置的默认模型" value={profile.model} onSave={(model) => updateProfile(profile.id, { model: model.trim() })} autoCapitalize="none" />
          <ButtonRow label="拉取模型列表" loading={fetchingTarget === profile.id} onPress={() => fetchModels({ kind: 'agent', profileId: profile.id })} />
          <TextEditRow label="系统提示词" value={profile.systemPrompt} multiline onSave={(systemPrompt) => updateProfile(profile.id, { systemPrompt })} />
          <SettingsRow label="允许使用的工具" sublabel="从内置工具与已导入的 MCP 工具中选择" value={profile.allowedToolNames.length ? `${profile.allowedToolNames.length} 个` : '未选择'} showChevron onPress={() => setToolPickerTarget({ kind: 'agent', profileId: profile.id })} />
          <TextEditRow label="最大工具调用次数" value={String(profile.maxToolCalls)} displayValue={`${profile.maxToolCalls} 次`} keyboardType="number-pad" validate={(value) => Number(value) >= 1 ? null : '请输入大于 0 的整数'} onSave={(value) => updateProfile(profile.id, { maxToolCalls: Math.max(1, Number.parseInt(value, 10) || 1) })} />
          <TextEditRow label="最大输出 Tokens" value={String(profile.maxOutputTokens)} keyboardType="number-pad" validate={(value) => Number(value) >= 64 ? null : '最少为 64'} onSave={(value) => updateProfile(profile.id, { maxOutputTokens: Math.max(64, Number.parseInt(value, 10) || 64) })} />
          <TextEditRow label="运行超时" value={String(Math.round(profile.maxRuntimeMs / 1000))} displayValue={`${Math.round(profile.maxRuntimeMs / 1000)} 秒`} keyboardType="number-pad" validate={(value) => Number(value) >= 1 ? null : '请输入大于 0 的秒数'} onSave={(value) => updateProfile(profile.id, { maxRuntimeMs: Math.max(1, Number.parseInt(value, 10) || 1) * 1000 })} />
          <TextEditRow label="最大嵌套深度" sublabel="0 表示不能继续派发，允许范围 0–3" value={String(profile.maxNestingDepth)} displayValue={`${profile.maxNestingDepth} 层`} keyboardType="number-pad" validate={(value) => Number(value) >= 0 && Number(value) <= 3 ? null : '请输入 0 到 3'} onSave={(value) => updateProfile(profile.id, { maxNestingDepth: Math.max(0, Math.min(3, Number.parseInt(value, 10) || 0)) })} />
          <ButtonRow label="删除此子 Agent" destructive onPress={() => setSubAgentConfig({ profiles: subAgentConfig.profiles.filter((item) => item.id !== profile.id) })} />
        </SettingsGroup>
      ))}

      <SettingsGroup header="工具结果压缩" footer="当前回复保留完整结果；下一轮 Agent transcript 使用压缩结果。">
        <SwitchRow label="自动压缩工具结果" value={toolResultCompressionConfig.enabled} onValueChange={(enabled) => setToolResultCompressionConfig({ enabled })} />
        <TextEditRow label="API 地址" value={toolResultCompressionConfig.baseUrl} inputPlaceholder="https://api.openai.com/v1" autoCapitalize="none" onSave={(baseUrl) => setToolResultCompressionConfig({ baseUrl: baseUrl.trim() })} />
        <TextEditRow label="API Key" value={toolResultCompressionConfig.apiKey} secure autoCapitalize="none" onSave={(apiKey) => setToolResultCompressionConfig({ apiKey: apiKey.trim() })} />
        <TextEditRow label="模型" value={toolResultCompressionConfig.model} autoCapitalize="none" onSave={(model) => setToolResultCompressionConfig({ model: model.trim() })} />
        <ButtonRow label="拉取模型列表" loading={fetchingTarget === 'compression'} onPress={() => fetchModels({ kind: 'compression' })} />
        <TextEditRow label="触发压缩阈值" value={String(toolResultCompressionConfig.thresholdTokens)} displayValue={`${toolResultCompressionConfig.thresholdTokens} tokens`} keyboardType="number-pad" onSave={(value) => setToolResultCompressionConfig({ thresholdTokens: Math.max(1, Number.parseInt(value, 10) || 1) })} />
        <TextEditRow label="最大输出 Tokens" value={String(toolResultCompressionConfig.maxOutputTokens)} keyboardType="number-pad" onSave={(value) => setToolResultCompressionConfig({ maxOutputTokens: Math.max(64, Number.parseInt(value, 10) || 64) })} />
        <SettingsRow label="需要压缩的工具" sublabel="从内置工具与已导入的 MCP 工具中选择" value={toolResultCompressionConfig.toolNames.length ? `${toolResultCompressionConfig.toolNames.length} 个` : '未选择'} showChevron onPress={() => setToolPickerTarget({ kind: 'compression' })} />
        <TextEditRow label="自定义压缩提示词" value={toolResultCompressionConfig.prompt} multiline onSave={(prompt) => setToolResultCompressionConfig({ prompt })} />
      </SettingsGroup>

      <OptionListDialog visible={apiPickerProfileId !== null} title="选择 API 配置" options={apiConfigs.map((api) => ({ value: api.name, label: api.name, sublabel: `${api.model} · ${api.baseUrl}` }))} value={subAgentConfig.profiles.find((item) => item.id === apiPickerProfileId)?.apiConfigName} onSelect={(apiConfigName) => { if (apiPickerProfileId) updateProfile(apiPickerProfileId, { apiConfigName }); setApiPickerProfileId(null); }} onCancel={() => setApiPickerProfileId(null)} />
      <OptionListDialog visible={modelTarget !== null} title="选择模型" options={models.map((model) => ({ value: model, label: model }))} value={modelTarget?.kind === 'compression' ? toolResultCompressionConfig.model : subAgentConfig.profiles.find((item) => item.id === modelTarget?.profileId)?.model} onSelect={(model) => { if (modelTarget?.kind === 'compression') setToolResultCompressionConfig({ model }); else if (modelTarget?.kind === 'agent') updateProfile(modelTarget.profileId, { model }); setModelTarget(null); }} onCancel={() => setModelTarget(null)} />
      <MultiSelectDialog visible={toolPickerTarget !== null} title={toolPickerTarget?.kind === 'compression' ? '选择需要压缩的工具' : '选择 Agent 可用工具'} options={toolPool} values={toolPickerTarget?.kind === 'compression' ? toolResultCompressionConfig.toolNames : toolPickerTarget?.kind === 'agent' ? subAgentConfig.profiles.find((item) => item.id === toolPickerTarget.profileId)?.allowedToolNames || [] : []} onChange={(values) => { if (toolPickerTarget?.kind === 'compression') setToolResultCompressionConfig({ toolNames: values }); else if (toolPickerTarget?.kind === 'agent') updateProfile(toolPickerTarget.profileId, { allowedToolNames: values }); }} onCancel={() => setToolPickerTarget(null)} />
    </>
  );
}
