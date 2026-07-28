import { Pressable, Switch, Text, TextInput, View } from 'react-native';

type McpServerEditorProps = {
  styles: any;
  colors: any;
  selectedMcpServer: any | null;
  mcpResourceToolsEnabled: boolean;
  setMcpResourceToolsEnabled: (value: boolean) => void;
  mcpSyncingServerId: string | null;
  getEnabledMcpToolCount: (server: any) => number;
  getEnabledMcpResourceCount: (server: any) => number;
  getPinnedMcpResourceCount: (server: any) => number;
  handleUpdateMcpServer: (serverId: string, patch: any) => void;
  handleUpdateMcpServerToolEnabled: (serverId: string, toolName: string, enabled: boolean) => void;
  handleUpdateMcpServerResource: (serverId: string, uri: string, patch: any) => void;
  setSelectedMcpToolRef: (ref: { serverId: string; toolName: string } | null) => void;
  setSelectedMcpResourceRef: (ref: { serverId: string; uri: string } | null) => void;
  setSelectedMcpPromptRef: (ref: { serverId: string; promptName: string } | null) => void;
  handleSyncMcpServer: (serverId: string) => void;
};

export function McpServerEditor({
styles,
colors,
selectedMcpServer,
mcpResourceToolsEnabled,
setMcpResourceToolsEnabled,
mcpSyncingServerId,
getEnabledMcpToolCount,
getEnabledMcpResourceCount,
getPinnedMcpResourceCount,
handleUpdateMcpServer,
handleUpdateMcpServerToolEnabled,
handleUpdateMcpServerResource,
setSelectedMcpToolRef,
setSelectedMcpResourceRef,
setSelectedMcpPromptRef,
handleSyncMcpServer,
}: McpServerEditorProps) {
  if (!selectedMcpServer) return null;
  const enabledToolCount = getEnabledMcpToolCount(selectedMcpServer);
  const enabledResourceCount = getEnabledMcpResourceCount(selectedMcpServer);
  const pinnedResourceCount = getPinnedMcpResourceCount(selectedMcpServer);
  return (
    <>
      <Text style={styles.toolModalDescription}>远程 HTTP MCP 服务。同步会读取并缓存 Tools、Resources 和 Prompts。</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>启用此服务</Text>
          <Text style={styles.hint}>
            {enabledToolCount} / {selectedMcpServer.tools.length} 个工具已开启 | {enabledResourceCount} / {(selectedMcpServer.resources || []).length} 个资源可用 | {pinnedResourceCount} 个固定附加
          </Text>
        </View>
        <Switch
          value={selectedMcpServer.enabled}
          onValueChange={(value) => handleUpdateMcpServer(selectedMcpServer.id, { enabled: value })}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>服务名称</Text>
        <TextInput
          style={styles.input}
          value={selectedMcpServer.name}
          onChangeText={(value) => handleUpdateMcpServer(selectedMcpServer.id, { name: value })}
          placeholder="我的 MCP 服务"
          placeholderTextColor={colors.textTertiary}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>服务地址</Text>
        <TextInput
          style={styles.input}
          value={selectedMcpServer.url}
          onChangeText={(value) => handleUpdateMcpServer(selectedMcpServer.id, { url: value })}
          placeholder="https://example.com/mcp"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>授权信息</Text>
        <TextInput
          style={styles.input}
          value={selectedMcpServer.authorization}
          onChangeText={(value) => handleUpdateMcpServer(selectedMcpServer.id, { authorization: value })}
          placeholder="Bearer 令牌"
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          autoCapitalize="none"
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>允许 AI 主动读取资源</Text>
          <Text style={styles.hint}>开启后会为每个有资源的 MCP 服务提供一个读取资源的通用工具；不会把所有资源全文自动塞进上下文。</Text>
        </View>
        <Switch
          value={mcpResourceToolsEnabled}
          onValueChange={setMcpResourceToolsEnabled}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>
      <Text style={styles.sectionTitle}>Tools</Text>
      <View style={styles.toolListPreview}>
        {selectedMcpServer.tools.length === 0 ? (
          <Text style={styles.emptyText}>尚未同步工具</Text>
        ) : (
          selectedMcpServer.tools.map((tool: any) => (
            <View key={tool.name} style={styles.toolListPreviewItem}>
              <Pressable
                style={styles.toolListPreviewText}
                onPress={() => setSelectedMcpToolRef({ serverId: selectedMcpServer.id, toolName: tool.name })}
              >
                <Text style={styles.toolListPreviewName}>{tool.title || tool.name}</Text>
                {!!tool.description && (
                  <Text style={styles.toolListPreviewDescription} numberOfLines={2}>
                    {tool.description}
                  </Text>
                )}
                <Text style={styles.toolListPreviewStatus}>查看详情</Text>
              </Pressable>
              <Switch
                value={tool.enabled !== false}
                onValueChange={(value) =>
                  handleUpdateMcpServerToolEnabled(selectedMcpServer.id, tool.name, value)
                }
                trackColor={{ false: colors.inputBorder, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>
          ))
        )}
      </View>
      <Text style={styles.sectionTitle}>Resources</Text>
      <View style={styles.toolListPreview}>
        {(selectedMcpServer.resources || []).length === 0 ? (
          <Text style={styles.emptyText}>尚未同步资源</Text>
        ) : (
          (selectedMcpServer.resources || []).map((resource: any) => (
            <View key={resource.uri} style={styles.toolListPreviewItem}>
              <Pressable
                style={styles.toolListPreviewText}
                onPress={() => setSelectedMcpResourceRef({ serverId: selectedMcpServer.id, uri: resource.uri })}
              >
                <Text style={styles.toolListPreviewName}>{resource.title || resource.name || resource.uri}</Text>
                {!!resource.description && (
                  <Text style={styles.toolListPreviewDescription} numberOfLines={2}>
                    {resource.description}
                  </Text>
                )}
                <Text style={styles.toolListPreviewDescription} numberOfLines={1}>{resource.uri}</Text>
                <Text style={styles.toolListPreviewStatus}>查看详情</Text>
              </Pressable>
              <View style={styles.mcpResourceSwitches}>
                <View style={styles.mcpResourceSwitchRow}>
                  <Text style={styles.mcpResourceSwitchLabel}>可读</Text>
                  <Switch
                    value={resource.enabled !== false}
                    onValueChange={(value) =>
                      handleUpdateMcpServerResource(selectedMcpServer.id, resource.uri, { enabled: value })
                    }
                    trackColor={{ false: colors.inputBorder, true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>
                <View style={styles.mcpResourceSwitchRow}>
                  <Text style={styles.mcpResourceSwitchLabel}>固定</Text>
                  <Switch
                    value={resource.pinned === true}
                    onValueChange={(value) =>
                      handleUpdateMcpServerResource(selectedMcpServer.id, resource.uri, { pinned: value })
                    }
                    trackColor={{ false: colors.inputBorder, true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>
            </View>
          ))
        )}
      </View>
      {(selectedMcpServer.resourceTemplates || []).length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Resource Templates</Text>
          <View style={styles.toolListPreview}>
            {(selectedMcpServer.resourceTemplates || []).map((template: any) => (
              <View key={template.uriTemplate} style={styles.toolListPreviewItem}>
                <View style={styles.toolListPreviewText}>
                  <Text style={styles.toolListPreviewName}>{template.title || template.name || template.uriTemplate}</Text>
                  {!!template.description && (
                    <Text style={styles.toolListPreviewDescription} numberOfLines={2}>
                      {template.description}
                    </Text>
                  )}
                  <Text style={styles.toolListPreviewDescription} numberOfLines={1}>{template.uriTemplate}</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}
      <Text style={styles.sectionTitle}>Prompts</Text>
      <View style={styles.toolListPreview}>
        {(selectedMcpServer.prompts || []).length === 0 ? (
          <Text style={styles.emptyText}>尚未同步提示词</Text>
        ) : (
          (selectedMcpServer.prompts || []).map((prompt: any) => (
            <View key={prompt.name} style={styles.toolListPreviewItem}>
              <Pressable
                style={styles.toolListPreviewText}
                onPress={() => setSelectedMcpPromptRef({ serverId: selectedMcpServer.id, promptName: prompt.name })}
              >
                <Text style={styles.toolListPreviewName}>{prompt.title || prompt.name}</Text>
                {!!prompt.description && (
                  <Text style={styles.toolListPreviewDescription} numberOfLines={2}>
                    {prompt.description}
                  </Text>
                )}
                <Text style={styles.toolListPreviewStatus}>查看并应用</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>
      <Pressable
        style={styles.testButton}
        onPress={() => handleSyncMcpServer(selectedMcpServer.id)}
        disabled={mcpSyncingServerId === selectedMcpServer.id}
      >
        <Text style={styles.testButtonText}>
          {mcpSyncingServerId === selectedMcpServer.id ? '同步中' : '同步 MCP 能力'}
        </Text>
      </Pressable>
    </>
  );
}
