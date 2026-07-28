import { type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

type BuiltInToolModalProps = {
  styles: any;
  selectedTool: any | null;
  renderEditor: (key: string) => ReactNode;
  onClose: () => void;
  onDisable: (key: string) => void;
  onSave: (key: string) => boolean | void;
};

type QqConversationModalProps = {
  styles: any;
  colors: any;
  conversationKey: string | null;
  platformLabel: string;
  messageCount: number;
  page: number;
  totalPages: number;
  loading: boolean;
  deleting: boolean;
  selectedIndexes: number[];
  messages: Array<{ index: number; role: string; content: string; preview: string }>;
  onClose: () => void;
  onOpenPage: (page: number) => void;
  onDeleteSelected: () => void;
  onClearConversation: () => void;
  onToggleMessage: (index: number) => void;
};

type McpServerModalProps = {
  styles: any;
  selectedServer: any | null;
  renderEditor: () => ReactNode;
  onClose: () => void;
  onRemove: (id: string) => void;
};

type McpToolModalProps = {
  styles: any;
  selectedTool: any | null;
  selectedServer: any | null;
  formatInputSchema: (tool: any) => string;
  onClose: () => void;
};

type McpResourceModalProps = {
  styles: any;
  selectedResource: any | null;
  selectedServer: any | null;
  onClose: () => void;
};

type McpPromptModalProps = {
  styles: any;
  colors: any;
  selectedPrompt: any | null;
  selectedServer: any | null;
  promptArgs: string;
  applying: boolean;
  formatArguments: (prompt: any) => string;
  onChangePromptArgs: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
};

export function BuiltInToolModal({
  styles,
  selectedTool,
  renderEditor,
  onClose,
  onDisable,
  onSave,
}: BuiltInToolModalProps) {
  return (
    <Modal visible={!!selectedTool} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modal, styles.toolModal]}>
          <View style={styles.toolModalHeader}>
            <View style={styles.switchText}>
              <Text style={styles.modalTitle}>{selectedTool?.name || '工具'}</Text>
              {!!selectedTool && <Text style={styles.hint}>{selectedTool.meta}</Text>}
            </View>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>关闭</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled">
            {!!selectedTool && renderEditor(selectedTool.key)}
          </ScrollView>
          {!!selectedTool && (
            <View style={styles.toolModalActions}>
              <Pressable style={styles.removeSmallButton} onPress={() => onDisable(selectedTool.key)}>
                <Text style={styles.removeSmallButtonText}>删除/关闭</Text>
              </Pressable>
              <Pressable
                style={styles.modalConfirm}
                onPress={() => {
                  const saved = onSave(selectedTool.key);
                  if (saved !== false) onClose();
                }}
              >
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function QqConversationModal({
  styles,
  colors,
  conversationKey,
  platformLabel,
  messageCount,
  page,
  totalPages,
  loading,
  deleting,
  selectedIndexes,
  messages,
  onClose,
  onOpenPage,
  onDeleteSelected,
  onClearConversation,
  onToggleMessage,
}: QqConversationModalProps) {
  return (
    <Modal visible={!!conversationKey} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modal, styles.toolModal]}>
          <View style={styles.toolModalHeader}>
            <View style={styles.switchText}>
              <Text style={styles.modalTitle}>{platformLabel} 上下文</Text>
              <Text style={styles.hint}>{messageCount} 条消息 · 第 {page}/{totalPages} 页</Text>
            </View>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>关闭</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>会话</Text>
            <Text selectable style={styles.toolDetailText}>{conversationKey || ''}</Text>
            <View style={styles.platformActions}>
              <Pressable
                style={[styles.platformActionButton, (loading || page <= 1) && styles.importButtonDisabled]}
                onPress={() => onOpenPage(page - 1)}
                disabled={loading || page <= 1}
              >
                <Text style={styles.platformActionText}>上一页</Text>
              </Pressable>
              <Pressable
                style={[styles.platformActionButton, (loading || page >= totalPages) && styles.importButtonDisabled]}
                onPress={() => onOpenPage(page + 1)}
                disabled={loading || page >= totalPages}
              >
                <Text style={styles.platformActionText}>下一页</Text>
              </Pressable>
            </View>
            <View style={styles.platformActions}>
              <Pressable
                style={[styles.platformActionButton, (deleting || selectedIndexes.length === 0) && styles.importButtonDisabled]}
                onPress={onDeleteSelected}
                disabled={deleting || selectedIndexes.length === 0}
              >
                <Text style={styles.platformActionText}>{deleting ? '删除中' : `删除选中 ${selectedIndexes.length} 条`}</Text>
              </Pressable>
              <Pressable
                style={[styles.platformActionButton, deleting && styles.importButtonDisabled]}
                onPress={onClearConversation}
                disabled={deleting}
              >
                <Text style={styles.platformActionText}>清除此会话</Text>
              </Pressable>
            </View>
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : messages.length === 0 ? (
              <Text style={styles.emptyText}>该页没有可管理的消息</Text>
            ) : (
              <View style={styles.toolListPreview}>
                {messages.map((message) => {
                  const selected = selectedIndexes.includes(message.index);
                  return (
                    <Pressable
                      key={`${conversationKey}-${message.index}`}
                      style={[styles.toolListPreviewItem, selected && styles.toolCardEnabled]}
                      onPress={() => onToggleMessage(message.index)}
                    >
                      <View style={styles.toolListPreviewText}>
                        <Text style={styles.toolListPreviewName}>#{message.index} · {message.role || 'unknown'}</Text>
                        <Text selectable style={styles.toolListPreviewDescription}>{message.content || message.preview || '空消息'}</Text>
                        <Text style={styles.toolListPreviewStatus}>{selected ? '已选中' : '点按选择'}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function McpServerModal({ styles, selectedServer, renderEditor, onClose, onRemove }: McpServerModalProps) {
  return (
    <Modal visible={!!selectedServer} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modal, styles.toolModal]}>
          <View style={styles.toolModalHeader}>
            <View style={styles.switchText}>
              <Text style={styles.modalTitle}>{selectedServer?.name || 'MCP 服务'}</Text>
              {!!selectedServer && <Text style={styles.hint}>{selectedServer.url}</Text>}
            </View>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>关闭</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled">{renderEditor()}</ScrollView>
          {!!selectedServer && (
            <View style={styles.toolModalActions}>
              <Pressable style={styles.removeSmallButton} onPress={() => onRemove(selectedServer.id)}>
                <Text style={styles.removeSmallButtonText}>删除</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function McpToolModal({ styles, selectedTool, selectedServer, formatInputSchema, onClose }: McpToolModalProps) {
  return (
    <Modal visible={!!selectedTool} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modal, styles.toolModal]}>
          <View style={styles.toolModalHeader}>
            <View style={styles.switchText}>
              <Text style={styles.modalTitle}>{selectedTool?.title || selectedTool?.name || 'MCP 工具'}</Text>
              {!!selectedServer && <Text style={styles.hint}>{selectedServer.name}</Text>}
            </View>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>关闭</Text>
            </Pressable>
          </View>
          {!!selectedTool && (
            <ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>工具名称</Text>
              <Text style={styles.toolDetailText}>{selectedTool.name}</Text>
              <Text style={styles.label}>启用状态</Text>
              <Text style={styles.toolDetailText}>{selectedTool.enabled !== false ? '已开启' : '已关闭'}</Text>
              <Text style={styles.label}>简介</Text>
              <Text style={styles.toolDetailText}>{selectedTool.description || '暂无简介'}</Text>
              <Text style={styles.label}>参数定义</Text>
              <Text selectable style={styles.toolSchemaText}>{formatInputSchema(selectedTool)}</Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function McpResourceModal({ styles, selectedResource, selectedServer, onClose }: McpResourceModalProps) {
  return (
    <Modal visible={!!selectedResource} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modal, styles.toolModal]}>
          <View style={styles.toolModalHeader}>
            <View style={styles.switchText}>
              <Text style={styles.modalTitle}>{selectedResource?.title || selectedResource?.name || 'MCP 资源'}</Text>
              {!!selectedServer && <Text style={styles.hint}>{selectedServer.name}</Text>}
            </View>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>关闭</Text>
            </Pressable>
          </View>
          {!!selectedResource && (
            <ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>URI</Text>
              <Text selectable style={styles.toolDetailText}>{selectedResource.uri}</Text>
              <Text style={styles.label}>MIME 类型</Text>
              <Text style={styles.toolDetailText}>{selectedResource.mimeType || '未知'}</Text>
              <Text style={styles.label}>状态</Text>
              <Text style={styles.toolDetailText}>{selectedResource.enabled !== false ? '允许读取' : '已关闭'} · {selectedResource.pinned ? '固定附加到上下文' : '不自动附加'}</Text>
              <Text style={styles.label}>简介</Text>
              <Text style={styles.toolDetailText}>{selectedResource.description || '暂无简介'}</Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function McpPromptModal({
  styles,
  colors,
  selectedPrompt,
  selectedServer,
  promptArgs,
  applying,
  formatArguments,
  onChangePromptArgs,
  onApply,
  onClose,
}: McpPromptModalProps) {
  return (
    <Modal visible={!!selectedPrompt} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modal, styles.toolModal]}>
          <View style={styles.toolModalHeader}>
            <View style={styles.switchText}>
              <Text style={styles.modalTitle}>{selectedPrompt?.title || selectedPrompt?.name || 'MCP 提示词'}</Text>
              {!!selectedServer && <Text style={styles.hint}>{selectedServer.name}</Text>}
            </View>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>关闭</Text>
            </Pressable>
          </View>
          {!!selectedPrompt && (
            <ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>提示词名称</Text>
              <Text style={styles.toolDetailText}>{selectedPrompt.name}</Text>
              <Text style={styles.label}>简介</Text>
              <Text style={styles.toolDetailText}>{selectedPrompt.description || '暂无简介'}</Text>
              <Text style={styles.label}>参数定义</Text>
              <Text selectable style={styles.toolSchemaText}>{formatArguments(selectedPrompt)}</Text>
              <Text style={styles.label}>调用参数 JSON</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={promptArgs}
                onChangeText={onChangePromptArgs}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                placeholder="{}"
                placeholderTextColor={colors.textTertiary}
              />
              <Pressable style={[styles.saveButton, applying && styles.importButtonDisabled]} onPress={onApply} disabled={applying}>
                <Text style={styles.saveButtonText}>{applying ? '应用中' : '应用到当前对话'}</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
