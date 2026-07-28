import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { lightColors, useThemeColors, type ThemeColors } from '../../src/theme/colors';
import { useChatStore } from '../../src/stores/chat';

let colors = lightColors;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

export default function ChatDeepLinkScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const conversationId = decodeURIComponent(firstParam(params.id)).trim();
    if (!conversationId) {
      setError('缺少对话 ID');
      return;
    }

    let cancelled = false;
    const openConversation = async () => {
      try {
        const chat = useChatStore.getState();
        await chat.loadConversation(conversationId);
        if (!cancelled) {
          useChatStore.getState().syncPromptCacheRemoteInbox({
            preferredConversationId: conversationId,
            showLoading: true,
          }).catch(() => undefined);
          router.replace('/');
        }
      } catch (openError: any) {
        if (!cancelled) {
          setError(openError?.message || '无法打开对话');
        }
      }
    };

    openConversation();
    return () => {
      cancelled = true;
    };
  }, [params.id, router]);

  return (
    <View style={styles.container}>
      {error ? (
        <Text style={styles.text}>{error}</Text>
      ) : (
        <>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.text}>正在打开对话...</Text>
        </>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.background,
    padding: 24,
  },
  text: {
    color: colors.text,
    fontSize: 15,
    textAlign: 'center',
  },
});

let styles = createStyles(colors);
