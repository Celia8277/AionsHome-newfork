import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';
import { fonts } from '../src/theme/fonts';
import {
  clearChatDiagnosticsEmptyAssistantIssues,
  deleteChatDiagnosticsMessage,
  getChatDiagnosticsConversation,
  getChatDiagnosticsConversations,
  setChatDiagnosticsMessageHidden,
  updateChatDiagnosticsMessageContent,
  type ChatDiagnosticsConversation,
  type ChatDiagnosticsDetail,
  type ChatDiagnosticsMessage,
} from '../src/db/operations';
import { formatFullTime } from '../src/utils/time';
import { useChatStore } from '../src/stores/chat';

let colors = lightColors;

type IssueJumpTarget = {
  messageId: string;
  databaseIndex: number;
  floorNumber: number | null;
  issues: string[];
};

const DETAIL_FLOORS_PER_PAGE = 50;

export default function ChatDiagnosticsScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const router = useRouter();
  const [query, setQuery] = useState('');
  const [messageQuery, setMessageQuery] = useState('');
  const [floorPage, setFloorPage] = useState(1);
  const [conversations, setConversations] = useState<ChatDiagnosticsConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatDiagnosticsDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatDiagnosticsMessage | null>(null);
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [hidingMessageId, setHidingMessageId] = useState<string | null>(null);
  const [clearingEmptyIssues, setClearingEmptyIssues] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const messageListRef = useRef<FlatList<ChatDiagnosticsMessage>>(null);
  const pendingJumpMessageIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getChatDiagnosticsConversations();
      setConversations(rows);
    } catch (err: any) {
      setError(err?.message || '无法读取聊天诊断数据');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (conversationId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const nextDetail = await getChatDiagnosticsConversation(conversationId);
      setDetail(nextDetail);
      setSelectedId(nextDetail ? conversationId : null);
    } catch (err: any) {
      setError(err?.message || '无法读取对话明细');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadConversations().catch(() => undefined);
    }, [loadConversations])
  );

  const filteredConversations = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((conversation) =>
      [conversation.title, conversation.id, conversation.model]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    );
  }, [conversations, query]);

  const totals = useMemo(() => {
    return conversations.reduce(
      (acc, conversation) => {
        acc.conversations += 1;
        acc.messages += conversation.totalMessageCount;
        acc.floorMessages += conversation.floorMessageCount;
        acc.issues += conversation.issueCount;
        acc.emptyAssistantMessages += conversation.emptyAssistantCount;
        acc.duplicateGroups += conversation.duplicateTimestampGroupCount;
        return acc;
      },
      {
        conversations: 0,
        messages: 0,
        floorMessages: 0,
        issues: 0,
        emptyAssistantMessages: 0,
        duplicateGroups: 0,
      }
    );
  }, [conversations]);

  const refresh = useCallback(async () => {
    await loadConversations();
    if (selectedId) {
      await loadDetail(selectedId);
    }
  }, [loadConversations, loadDetail, selectedId]);

  const openConversation = useCallback(
    (conversationId: string) => {
      setFloorPage(1);
      setMessageQuery('');
      setSelectedId(conversationId);
      loadDetail(conversationId).catch(() => undefined);
    },
    [loadDetail]
  );

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    setMessageQuery('');
    setFloorPage(1);
    setHighlightedMessageId(null);
  }, []);

  const filteredMessages = useMemo(() => {
    const messages = detail?.messages ?? [];
    const keyword = messageQuery.trim().toLowerCase();
    if (!keyword) return messages;
    return messages.filter((message) =>
      buildMessageSearchText(message).includes(keyword)
    );
  }, [detail, messageQuery]);

  const messagePageMap = useMemo(() => {
    const pageMap = new Map<string, number>();
    let currentFloor = 0;
    for (const message of detail?.messages ?? []) {
      if (message.floorNumber !== null) currentFloor = message.floorNumber;
      pageMap.set(
        message.id,
        Math.max(1, Math.ceil(Math.max(1, currentFloor) / DETAIL_FLOORS_PER_PAGE))
      );
    }
    return pageMap;
  }, [detail]);

  const floorPageCount = Math.max(
    1,
    Math.ceil((detail?.floorMessageCount ?? 0) / DETAIL_FLOORS_PER_PAGE)
  );
  const pageFloorFrom = (floorPage - 1) * DETAIL_FLOORS_PER_PAGE + 1;
  const pageFloorTo = Math.min(
    Math.max(detail?.floorMessageCount ?? 0, 1),
    floorPage * DETAIL_FLOORS_PER_PAGE
  );
  const pagedMessages = useMemo(
    () => filteredMessages.filter((message) => messagePageMap.get(message.id) === floorPage),
    [filteredMessages, floorPage, messagePageMap]
  );

  useEffect(() => {
    setFloorPage((page) => Math.min(Math.max(1, page), floorPageCount));
  }, [floorPageCount]);

  useEffect(() => {
    if (!messageQuery.trim() || filteredMessages.length === 0) return;
    const firstMatchPage = messagePageMap.get(filteredMessages[0].id);
    if (firstMatchPage) setFloorPage(firstMatchPage);
  }, [filteredMessages, messagePageMap, messageQuery]);

  const changeFloorPage = useCallback((page: number) => {
    pendingJumpMessageIdRef.current = null;
    setHighlightedMessageId(null);
    setFloorPage(Math.min(floorPageCount, Math.max(1, page)));
    setTimeout(() => {
      messageListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, 0);
  }, [floorPageCount]);

  const issueJumpTargets = useMemo<IssueJumpTarget[]>(() => {
    return (detail?.messages ?? [])
      .map((message) => ({
        messageId: message.id,
        databaseIndex: message.databaseIndex,
        floorNumber: message.floorNumber,
        issues: message.issues.filter(isActionableIssue),
      }))
      .filter((target) => target.issues.length > 0);
  }, [detail]);

  const scrollToMessage = useCallback((messageId: string) => {
    const targetPage = messagePageMap.get(messageId);
    if (targetPage && targetPage !== floorPage) {
      pendingJumpMessageIdRef.current = messageId;
      setFloorPage(targetPage);
      return;
    }
    const index = pagedMessages.findIndex((message) => message.id === messageId);
    if (index < 0) {
      pendingJumpMessageIdRef.current = messageId;
      if (messageQuery.trim()) {
        setMessageQuery('');
      }
      return;
    }

    setHighlightedMessageId(messageId);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimerRef.current = null;
    }, 1800);

    messageListRef.current?.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0.14,
    });
  }, [floorPage, messagePageMap, messageQuery, pagedMessages]);

  useEffect(() => {
    const messageId = pendingJumpMessageIdRef.current;
    if (!messageId) return;
    if (!filteredMessages.some((message) => message.id === messageId)) return;

    pendingJumpMessageIdRef.current = null;
    const timer = setTimeout(() => scrollToMessage(messageId), 0);
    return () => clearTimeout(timer);
  }, [filteredMessages, pagedMessages, scrollToMessage]);

  const jumpToIssue = useCallback((target: IssueJumpTarget) => {
    pendingJumpMessageIdRef.current = target.messageId;
    if (messageQuery.trim()) {
      setMessageQuery('');
      return;
    }
    scrollToMessage(target.messageId);
  }, [messageQuery, scrollToMessage]);

  const openEditMessage = useCallback((message: ChatDiagnosticsMessage) => {
    setEditingMessage(message);
    setEditContent(message.content);
  }, []);

  const closeEditMessage = useCallback(() => {
    if (savingEdit) return;
    setEditingMessage(null);
    setEditContent('');
  }, [savingEdit]);

  const saveMessageEdit = useCallback(async () => {
    if (!selectedId || !editingMessage || savingEdit) return;
    setSavingEdit(true);
    setError(null);
    try {
      await updateChatDiagnosticsMessageContent(selectedId, editingMessage.id, editContent);
      setEditingMessage(null);
      setEditContent('');
      await loadConversations();
      await loadDetail(selectedId);
    } catch (err: any) {
      setError(err?.message || 'Failed to update message');
    } finally {
      setSavingEdit(false);
    }
  }, [editContent, editingMessage, loadConversations, loadDetail, savingEdit, selectedId]);

  const confirmDeleteMessage = useCallback((message: ChatDiagnosticsMessage) => {
    if (!selectedId || deletingMessageId) return;
    const floorText = message.floorNumber === null ? 'no floor' : `#${message.floorNumber}`;
    Alert.alert(
      'Delete message',
      `Delete DB ${message.databaseIndex} (${floorText}, ${message.role})?\n\n${previewContent(message.content)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!selectedId) return;
            setDeletingMessageId(message.id);
            setError(null);
            try {
              await deleteChatDiagnosticsMessage(selectedId, message.id);
              await loadConversations();
              await loadDetail(selectedId);
            } catch (err: any) {
              setError(err?.message || 'Failed to delete message');
            } finally {
              setDeletingMessageId(null);
            }
          },
        },
      ]
    );
  }, [deletingMessageId, loadConversations, loadDetail, selectedId]);

  const toggleMessageHidden = useCallback(async (message: ChatDiagnosticsMessage) => {
    if (!selectedId || hidingMessageId) return;
    setHidingMessageId(message.id);
    setError(null);
    try {
      const nextHidden = !message.isHiddenByMessageId;
      const chatState = useChatStore.getState();
      if (chatState.conversationId === selectedId) {
        await chatState.setMessageHidden(message.id, nextHidden);
      } else {
        await setChatDiagnosticsMessageHidden(selectedId, message.id, nextHidden);
      }
      await loadConversations();
      await loadDetail(selectedId);
    } catch (err: any) {
      setError(err?.message || 'Failed to update hidden state');
    } finally {
      setHidingMessageId(null);
    }
  }, [hidingMessageId, loadConversations, loadDetail, selectedId]);

  const confirmClearEmptyIssues = useCallback((targetConversationId?: string, emptyCount?: number) => {
    if (clearingEmptyIssues) return;
    const scoped = !!targetConversationId;
    const countText = typeof emptyCount === 'number' ? `${emptyCount} 条` : '所有';
    Alert.alert(
      scoped ? '清除当前对话空楼层' : '清除全部空楼层',
      `将删除${scoped ? '当前对话中' : '所有对话中'}的 ${countText}空助手消息，并自动修正隐藏楼层范围。\n\n这个操作不可撤销。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除',
          style: 'destructive',
          onPress: async () => {
            setClearingEmptyIssues(true);
            setError(null);
            try {
              const deleted = await clearChatDiagnosticsEmptyAssistantIssues(targetConversationId);
              await loadConversations();
              const detailId = selectedId;
              if (detailId) {
                await loadDetail(detailId);
              }
              Alert.alert('已清除', `已删除 ${deleted} 条空助手消息。`);
            } catch (err: any) {
              setError(err?.message || 'Failed to clear empty issues');
            } finally {
              setClearingEmptyIssues(false);
            }
          },
        },
      ]
    );
  }, [clearingEmptyIssues, loadConversations, loadDetail, selectedId]);

  const renderConversation = useCallback(
    ({ item }: { item: ChatDiagnosticsConversation }) => (
      <Pressable style={styles.conversationRow} onPress={() => openConversation(item.id)}>
        <View style={styles.rowHeader}>
          <Text style={styles.conversationTitle} numberOfLines={1}>
            {item.title || 'Untitled conversation'}
          </Text>
          <IssueBadge count={item.issueCount} />
        </View>
        <Text style={styles.metaLine} numberOfLines={1}>
          {item.model || 'no model'} · {formatMaybeTime(item.updatedAt)}
        </Text>
        <View style={styles.statRow}>
          <StatChip label="DB" value={item.totalMessageCount} />
          <StatChip label="Floors" value={item.floorMessageCount} />
          <StatChip label="System" value={item.systemMessageCount} />
          <StatChip label="Tool" value={item.toolMessageCount} />
        </View>
        <View style={styles.flagsRow}>
          {item.duplicateTimestampGroupCount > 0 && (
            <Text style={styles.warningText}>
              same timestamp groups: {item.duplicateTimestampGroupCount}
            </Text>
          )}
          {item.emptyAssistantCount > 0 && (
            <Text style={styles.warningText}>empty assistant: {item.emptyAssistantCount}</Text>
          )}
          {item.hiddenRanges.length > 0 && (
            <Text style={styles.mutedText}>hidden: {formatHiddenRanges(item.hiddenRanges)}</Text>
          )}
          {item.hiddenMessageIds.length > 0 && (
            <Text style={styles.warningText}>hidden message ids: {item.hiddenMessageIds.length}</Text>
          )}
        </View>
        <Text style={styles.idText} numberOfLines={1}>{item.id}</Text>
      </Pressable>
    ),
    [openConversation]
  );

  const renderMessage = useCallback(
    ({ item }: { item: ChatDiagnosticsMessage }) => (
      <View style={[styles.messageRow, highlightedMessageId === item.id && styles.messageRowHighlighted]}>
        <View style={styles.messageTop}>
          <Text style={styles.messageIndex}>DB {item.databaseIndex}</Text>
          <Text style={styles.floorPill}>
            {item.floorNumber === null ? 'no floor' : `#${item.floorNumber}`}
          </Text>
          <Text style={[styles.rolePill, roleStyle(item.role)]}>{item.role}</Text>
          <Text style={[styles.aiPill, aiVisibilityStyle(item.aiVisibility)]}>
            {aiVisibilityText(item.aiVisibility)}
          </Text>
          {item.isHiddenFromAi && <Text style={styles.hiddenPill}>Hidden from AI</Text>}
        </View>
        <Text style={styles.metaLine}>{item.aiVisibilityLabel}</Text>
        {item.isHiddenByMessageId && (
          <Text style={styles.warningText}>Hidden by message id. This applies to any role, including AI context messages.</Text>
        )}
        {item.isHidden && !item.isHiddenByMessageId && (
          <Text style={styles.warningText}>Hidden by floor range.</Text>
        )}
        <Text style={styles.metaLine}>{formatMaybeTime(item.createdAt)}</Text>
        <Text style={styles.idText} numberOfLines={1}>{item.id}</Text>
        {item.issues.length > 0 && (
          <View style={styles.issueRow}>
            {item.issues.map((issue) => (
              <Text key={issue} style={styles.issueChip}>{formatMarkerLabel(issue)}</Text>
            ))}
          </View>
        )}
        {item.imageUri && <Text style={styles.mutedText} numberOfLines={1}>image: {item.imageUri}</Text>}
        {item.toolCallId && <Text style={styles.mutedText} numberOfLines={1}>tool call id: {item.toolCallId}</Text>}
        <Text style={styles.contentPreview}>
          {previewContent(item.content)}
        </Text>
        <View style={styles.messageActions}>
          <Pressable
            style={[styles.actionButton, hidingMessageId === item.id && styles.disabledButton]}
            onPress={() => toggleMessageHidden(item)}
            disabled={hidingMessageId === item.id}
          >
            <Text style={styles.actionButtonText}>
              {hidingMessageId === item.id
                ? 'Saving...'
                : item.isHiddenByMessageId
                  ? 'Show to AI'
                  : 'Hide from AI'}
            </Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => openEditMessage(item)}>
            <Text style={styles.actionButtonText}>Edit</Text>
          </Pressable>
          <Pressable
            style={[styles.deleteButton, deletingMessageId === item.id && styles.disabledButton]}
            onPress={() => confirmDeleteMessage(item)}
            disabled={deletingMessageId === item.id}
          >
            <Text style={styles.deleteButtonText}>
              {deletingMessageId === item.id ? 'Deleting...' : 'Delete'}
            </Text>
          </Pressable>
        </View>
      </View>
    ),
    [confirmDeleteMessage, deletingMessageId, highlightedMessageId, hidingMessageId, openEditMessage, toggleMessageHidden]
  );

  const listHeader = selectedId ? (
    <DetailHeader
      detail={detail}
      loading={detailLoading}
      onBack={closeDetail}
      messageQuery={messageQuery}
      onMessageQueryChange={setMessageQuery}
      filteredMessageCount={filteredMessages.length}
      pageMessageCount={pagedMessages.length}
      floorPage={floorPage}
      floorPageCount={floorPageCount}
      pageFloorFrom={pageFloorFrom}
      pageFloorTo={pageFloorTo}
      onFloorPageChange={changeFloorPage}
      issueJumpTargets={issueJumpTargets}
      onJumpToIssue={jumpToIssue}
      clearingEmptyIssues={clearingEmptyIssues}
      onClearEmptyIssues={() => confirmClearEmptyIssues(selectedId || undefined, detail?.emptyAssistantCount ?? 0)}
    />
  ) : (
    <View>
      <View style={styles.summaryPanel}>
        <View style={styles.summaryGrid}>
          <SummaryMetric label="Conversations" value={totals.conversations} />
          <SummaryMetric label="DB messages" value={totals.messages} />
          <SummaryMetric label="Floors" value={totals.floorMessages} />
          <SummaryMetric label="Issues" value={totals.issues} danger={totals.issues > 0} />
        </View>
        {totals.duplicateGroups > 0 && (
          <Text style={styles.warningText}>
            Found {totals.duplicateGroups} timestamp groups that can affect floor offsets.
          </Text>
        )}
        {totals.emptyAssistantMessages > 0 && (
          <Pressable
            style={[styles.clearIssuesButton, clearingEmptyIssues && styles.disabledButton]}
            onPress={() => confirmClearEmptyIssues(undefined, totals.emptyAssistantMessages)}
            disabled={clearingEmptyIssues}
          >
            <Text style={styles.clearIssuesButtonText}>
              {clearingEmptyIssues ? 'Clearing...' : `Clear empty floors (${totals.emptyAssistantMessages})`}
            </Text>
          </Pressable>
        )}
      </View>
      <DiagnosticsLegend />
      <TextInput
        style={styles.searchInput}
        value={query}
        onChangeText={setQuery}
        placeholder="Search title, model, or conversation id"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Chat Diagnostics</Text>
        <Pressable style={styles.headerButton} onPress={refresh} disabled={loading || detailLoading}>
          <Text style={styles.headerButtonText}>{loading || detailLoading ? '...' : 'Refresh'}</Text>
        </Pressable>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading && !selectedId ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : selectedId ? (
        <FlatList
          ref={messageListRef}
          data={pagedMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          extraData={highlightedMessageId}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            detailLoading
              ? <ActivityIndicator color={colors.primary} />
              : <Text style={styles.emptyText}>{messageQuery.trim() ? 'No messages match this search.' : 'No messages.'}</Text>
          }
          onScrollToIndexFailed={(info) => {
            messageListRef.current?.scrollToOffset({
              offset: Math.max(0, info.averageItemLength * info.index),
              animated: true,
            });
            const target = pagedMessages[info.index];
            if (target) {
              setTimeout(() => scrollToMessage(target.id), 120);
            }
          }}
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <FlatList
          data={filteredConversations}
          keyExtractor={(item) => item.id}
          renderItem={renderConversation}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={<Text style={styles.emptyText}>No conversations found.</Text>}
          contentContainerStyle={styles.listContent}
        />
      )}

      <Modal visible={!!editingMessage} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.editModal}>
            <Text style={styles.modalTitle}>Edit Message</Text>
            {editingMessage && (
              <Text style={styles.metaLine}>
                DB {editingMessage.databaseIndex} · {editingMessage.floorNumber === null ? 'no floor' : `#${editingMessage.floorNumber}`} · {editingMessage.role}
              </Text>
            )}
            <ScrollView style={styles.editScroll} keyboardShouldPersistTaps="handled">
              <TextInput
                style={styles.editInput}
                value={editContent}
                onChangeText={setEditContent}
                multiline
                textAlignVertical="top"
                placeholder="Message content"
                placeholderTextColor={colors.textTertiary}
              />
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={closeEditMessage} disabled={savingEdit}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalSaveButton, savingEdit && styles.disabledButton]} onPress={saveMessageEdit} disabled={savingEdit}>
                {savingEdit ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSaveText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailHeader({
  detail,
  loading,
  onBack,
  messageQuery,
  onMessageQueryChange,
  filteredMessageCount,
  pageMessageCount,
  floorPage,
  floorPageCount,
  pageFloorFrom,
  pageFloorTo,
  onFloorPageChange,
  issueJumpTargets,
  onJumpToIssue,
  clearingEmptyIssues,
  onClearEmptyIssues,
}: {
  detail: ChatDiagnosticsDetail | null;
  loading: boolean;
  onBack: () => void;
  messageQuery: string;
  onMessageQueryChange: (value: string) => void;
  filteredMessageCount: number;
  pageMessageCount: number;
  floorPage: number;
  floorPageCount: number;
  pageFloorFrom: number;
  pageFloorTo: number;
  onFloorPageChange: (page: number) => void;
  issueJumpTargets: IssueJumpTarget[];
  onJumpToIssue: (target: IssueJumpTarget) => void;
  clearingEmptyIssues: boolean;
  onClearEmptyIssues: () => void;
}) {
  if (loading && !detail) {
    return (
      <View style={styles.detailPanel}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.detailPanel}>
        <Pressable style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Back to list</Text>
        </Pressable>
        <Text style={styles.emptyText}>Conversation not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.detailPanel}>
      <Pressable style={styles.secondaryButton} onPress={onBack}>
        <Text style={styles.secondaryButtonText}>Back to list</Text>
      </Pressable>
      <Text style={styles.detailTitle}>{detail.title || 'Untitled conversation'}</Text>
      <Text style={styles.idText} numberOfLines={2}>{detail.id}</Text>
      <View style={styles.summaryGrid}>
        <SummaryMetric label="DB" value={detail.totalMessageCount} />
        <SummaryMetric label="Floors" value={detail.floorMessageCount} />
        <SummaryMetric label="System" value={detail.systemMessageCount} />
        <SummaryMetric label="Tool" value={detail.toolMessageCount} />
        <SummaryMetric label="Empty" value={detail.emptyAssistantCount} danger={detail.emptyAssistantCount > 0} />
        <SummaryMetric label="Dup groups" value={detail.duplicateTimestampGroupCount} danger={detail.duplicateTimestampGroupCount > 0} />
      </View>
      <Text style={styles.metaLine}>updated: {formatMaybeTime(detail.updatedAt)}</Text>
      <Text style={styles.metaLine}>hidden ranges: {formatHiddenRanges(detail.hiddenRanges) || 'none'}</Text>
      <Text style={styles.metaLine}>hidden message ids: {detail.hiddenMessageIds.length}</Text>
      <Text style={styles.metaLine}>
        pending boundary: {detail.pendingResponseBoundaryMessageId === undefined ? 'unset' : detail.pendingResponseBoundaryMessageId || 'start'}
      </Text>
      {detail.emptyAssistantCount > 0 && (
        <Pressable
          style={[styles.clearIssuesButton, clearingEmptyIssues && styles.disabledButton]}
          onPress={onClearEmptyIssues}
          disabled={clearingEmptyIssues}
        >
          <Text style={styles.clearIssuesButtonText}>
            {clearingEmptyIssues ? 'Clearing...' : `Clear empty floors (${detail.emptyAssistantCount})`}
          </Text>
        </Pressable>
      )}
      {issueJumpTargets.length > 0 && (
        <View style={styles.issueJumpPanel}>
          <Text style={styles.warningText}>问题跳转</Text>
          <View style={styles.issueJumpGrid}>
            {issueJumpTargets.map((target) => (
              <Pressable
                key={target.messageId}
                style={styles.issueJumpButton}
                onPress={() => onJumpToIssue(target)}
              >
                <Text style={styles.issueJumpButtonText}>
                  {formatIssueJumpTarget(target)}
                </Text>
                <Text style={styles.issueJumpDescription} numberOfLines={1}>
                  {target.issues.map(formatMarkerLabel).join(' / ')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      <TextInput
        style={styles.searchInput}
        value={messageQuery}
        onChangeText={onMessageQueryChange}
        placeholder="Search messages: content, id, role, marker, issue"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
      />
      <View style={styles.paginationRow}>
        <Pressable
          style={[styles.pageButton, floorPage <= 1 && styles.disabledButton]}
          onPress={() => onFloorPageChange(1)}
          disabled={floorPage <= 1}
        >
          <Text style={styles.pageButtonText}>首页</Text>
        </Pressable>
        <Pressable
          style={[styles.pageButton, floorPage <= 1 && styles.disabledButton]}
          onPress={() => onFloorPageChange(Math.max(1, floorPage - 1))}
          disabled={floorPage <= 1}
        >
          <Text style={styles.pageButtonText}>上一页</Text>
        </Pressable>
        <View style={styles.pageStatus}>
          <Text style={styles.pageStatusTitle}>{floorPage} / {floorPageCount}</Text>
          <Text style={styles.pageStatusText}>楼层 {pageFloorFrom}-{pageFloorTo}</Text>
        </View>
        <Pressable
          style={[styles.pageButton, floorPage >= floorPageCount && styles.disabledButton]}
          onPress={() => onFloorPageChange(Math.min(floorPageCount, floorPage + 1))}
          disabled={floorPage >= floorPageCount}
        >
          <Text style={styles.pageButtonText}>下一页</Text>
        </Pressable>
        <Pressable
          style={[styles.pageButton, floorPage >= floorPageCount && styles.disabledButton]}
          onPress={() => onFloorPageChange(floorPageCount)}
          disabled={floorPage >= floorPageCount}
        >
          <Text style={styles.pageButtonText}>末页</Text>
        </Pressable>
      </View>
      <Text style={styles.metaLine}>
        当前页显示 {pageMessageCount} 条 · 全部匹配 {filteredMessageCount} / {detail.messages.length} 条
      </Text>
      {detail.duplicateTimestampGroups.length > 0 && (
        <View style={styles.duplicatePanel}>
          <Text style={styles.warningText}>Timestamp groups</Text>
          {detail.duplicateTimestampGroups.slice(0, 8).map((group) => (
            <Text key={`${group.createdAt}-${group.count}`} style={styles.metaLine} numberOfLines={2}>
              {formatMaybeTime(group.createdAt)} · x{group.count} · {group.ids.join(', ')}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function SummaryMetric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <View style={[styles.summaryMetric, danger && styles.summaryMetricDanger]}>
      <Text style={[styles.summaryValue, danger && styles.dangerText]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <Text style={styles.statChip}>{label} {value}</Text>
  );
}

function DiagnosticsLegend({ compact = false }: { compact?: boolean }) {
  const rows: Array<[string, string]> = [
    ['AI 历史', '用户和助手消息会作为普通历史发送给模型，除非被隐藏。'],
    ['AI 上下文', '系统标记消息，用来附加运行时上下文，不算普通聊天历史。'],
    ['仅 UI', '只在本地存储或展示，普通聊天请求不会发送给模型。'],
    ['已对 AI 隐藏', '这条消息 ID 被屏蔽，后续请求不会发送给 AI，任意角色都适用。'],
    ['隐藏楼层', '命中了隐藏楼层范围，只影响用户和助手这类有楼层的消息。'],
    ['空助手消息', '助手占位消息没有正文或工具结果，通常可以检查后删除。'],
    ['同时间戳', '多条数据库记录共享同一个 created_at，可能影响分页和楼层偏移。'],
    ['无楼层', '角色不是 user/assistant，因此不会分配楼层号。'],
  ];

  return (
    <View style={[styles.legendPanel, compact && styles.legendPanelCompact]}>
      <Text style={styles.legendTitle}>Markers 标记说明</Text>
      {rows.map(([label, description]) => (
        <View key={label} style={styles.legendRow}>
          <Text style={styles.legendLabel}>{label}</Text>
          <Text style={styles.legendDescription}>{description}</Text>
        </View>
      ))}
    </View>
  );
}

function IssueBadge({ count }: { count: number }) {
  if (count <= 0) return <Text style={styles.okBadge}>OK</Text>;
  return <Text style={styles.issueBadge}>{count} issue{count === 1 ? '' : 's'}</Text>;
}

function previewContent(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty)';
  return normalized.length > 280 ? `${normalized.slice(0, 280)}...` : normalized;
}

function buildMessageSearchText(message: ChatDiagnosticsMessage): string {
  return [
    message.id,
    message.role,
    message.content,
    `db ${message.databaseIndex}`,
    message.floorNumber === null ? 'no floor' : `#${message.floorNumber}`,
    message.floorNumber === null ? '' : `floor ${message.floorNumber}`,
    aiVisibilityText(message.aiVisibility),
    message.aiVisibilityLabel,
    message.isHiddenFromAi ? 'hidden hidden from ai' : '',
    message.isHiddenByMessageId ? 'hidden message id show to ai' : '',
    message.isHidden ? 'hidden floor' : '',
    message.isPendingResponseBoundary ? 'pending boundary' : '',
    message.imageUri ? `image ${message.imageUri}` : '',
    message.toolCallId ? `tool call ${message.toolCallId}` : '',
    message.issues.join(' '),
    message.issues.map(formatMarkerLabel).join(' '),
    String(message.createdAt),
  ]
    .join(' ')
    .toLowerCase();
}

function formatHiddenRanges(ranges: Array<{ from: number; to: number }>): string {
  return ranges.map((range) => (range.from === range.to ? `#${range.from}` : `#${range.from}-${range.to}`)).join(', ');
}

function formatMaybeTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'none';
  return `${formatFullTime(value)} (${value})`;
}

function roleStyle(role: string) {
  if (role === 'user') return styles.roleUser;
  if (role === 'assistant') return styles.roleAssistant;
  return styles.roleMuted;
}

function aiVisibilityText(visibility: ChatDiagnosticsMessage['aiVisibility']): string {
  if (visibility === 'history') return 'AI 历史';
  if (visibility === 'runtime-context') return 'AI 上下文';
  return '仅 UI';
}

function isActionableIssue(issue: string): boolean {
  return issue !== 'no floor' && issue !== 'hidden floor';
}

function formatIssueJumpTarget(target: IssueJumpTarget): string {
  if (target.floorNumber === null) return `DB ${target.databaseIndex}`;
  return `#${target.floorNumber} · DB ${target.databaseIndex}`;
}

function formatMarkerLabel(marker: string): string {
  if (marker.startsWith('same timestamp x')) {
    return marker.replace('same timestamp', '同时间戳');
  }
  const labels: Record<string, string> = {
    'no floor': '无楼层',
    'hidden floor': '隐藏楼层',
    'empty assistant': '空助手消息',
    'invalid tool_calls JSON': 'tool_calls JSON 无效',
    'invalid tool_invocations JSON': 'tool_invocations JSON 无效',
    'invalid created_at': 'created_at 无效',
    'AI history': 'AI 历史',
    'AI context': 'AI 上下文',
    'UI only': '仅 UI',
    'Hidden from AI': '已对 AI 隐藏',
  };
  return labels[marker] ?? marker;
}

function aiVisibilityStyle(visibility: ChatDiagnosticsMessage['aiVisibility']) {
  if (visibility === 'history') return styles.aiHistory;
  if (visibility === 'runtime-context') return styles.aiContext;
  return styles.aiUiOnly;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerButton: {
    width: 76,
    minHeight: 36,
    justifyContent: 'center',
  },
  headerButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryPanel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryMetric: {
    minWidth: '31%',
    flexGrow: 1,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  summaryMetricDanger: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  summaryLabel: {
    marginTop: 2,
    color: colors.textTertiary,
    fontSize: 11,
  },
  searchInput: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 14,
    marginBottom: 12,
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  pageButton: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  pageStatus: {
    minWidth: 78,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageStatusTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  pageStatusText: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  conversationRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  conversationTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  statChip: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.inputBackground,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  flagsRow: {
    gap: 4,
    marginTop: 8,
  },
  okBadge: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.inputBackground,
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
  },
  issueBadge: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.dangerSurface,
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  detailPanel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  clearIssuesButton: {
    alignSelf: 'flex-start',
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 2,
  },
  clearIssuesButtonText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
  },
  detailTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  duplicatePanel: {
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  issueJumpPanel: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  issueJumpGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  issueJumpButton: {
    minWidth: 92,
    maxWidth: '48%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  issueJumpButtonText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
  },
  issueJumpDescription: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  messageRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 7,
  },
  messageRowHighlighted: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
  },
  messageTop: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  messageIndex: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  floorPill: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.inputBackground,
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  rolePill: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '700',
  },
  roleUser: {
    backgroundColor: colors.primaryLight,
    color: colors.primary,
  },
  roleAssistant: {
    backgroundColor: colors.inputBackground,
    color: colors.text,
  },
  roleMuted: {
    backgroundColor: colors.inputBackground,
    color: colors.textTertiary,
  },
  aiPill: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '700',
  },
  aiHistory: {
    backgroundColor: colors.primaryLight,
    color: colors.primary,
  },
  aiContext: {
    backgroundColor: colors.inputBackground,
    color: colors.success,
  },
  aiUiOnly: {
    backgroundColor: colors.inputBackground,
    color: colors.textTertiary,
  },
  hiddenPill: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.dangerSurface,
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  legendPanel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 7,
  },
  legendPanelCompact: {
    marginBottom: 0,
  },
  legendTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  legendRow: {
    gap: 2,
  },
  legendLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  legendDescription: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  issueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  issueChip: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.dangerSurface,
    color: colors.danger,
    fontSize: 11,
    fontWeight: '700',
  },
  contentPreview: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  messageActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  actionButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  deleteButton: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  deleteButtonText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
  metaLine: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  mutedText: {
    color: colors.textTertiary,
    fontSize: 12,
    lineHeight: 17,
  },
  idText: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 16,
  },
  warningText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  dangerText: {
    color: colors.danger,
  },
  errorText: {
    margin: 16,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.dangerSurface,
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  editModal: {
    width: '100%',
    maxHeight: '82%',
    borderRadius: 8,
    backgroundColor: colors.background,
    padding: 16,
    gap: 10,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  editScroll: {
    maxHeight: 420,
  },
  editInput: {
    minHeight: 260,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  modalSaveButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSaveText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});

let styles = createStyles(colors);
