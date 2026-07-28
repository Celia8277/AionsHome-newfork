import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ArrowUp, X } from 'lucide-react-native';
import { useThemeColors } from '../theme/colors';
import type { AskUserRequest } from '../utils/askUser';
import { formatAskUserAnswers } from '../utils/askUser';

interface Props {
  request: AskUserRequest;
  disabled?: boolean;
  onSubmit: (content: string) => void | Promise<void>;
  onDismiss: () => void;
}

export function AskUserCard({ request, disabled, onSubmit, onDismiss }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [customAnswer, setCustomAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setQuestionIndex(0);
    setAnswers([]);
    setCustomAnswer('');
    setSubmitting(false);
  }, [request.messageId, request.callId]);

  const question = request.questions[questionIndex];
  if (!question) return null;

  const commitAnswer = async (answer: string) => {
    const value = answer.trim();
    if (!value || disabled || submitting) return;
    const nextAnswers = [...answers, value];
    if (questionIndex < request.questions.length - 1) {
      setAnswers(nextAnswers);
      setQuestionIndex((index) => index + 1);
      setCustomAnswer('');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(formatAskUserAnswers(request.questions, nextAnswers));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.progress}>
          {request.questions.length > 1
            ? `${questionIndex + 1} / ${request.questions.length}`
            : '补充信息'}
        </Text>
        <Pressable hitSlop={10} onPress={onDismiss} disabled={submitting}>
          <X size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
      <Text style={styles.question}>{question.question}</Text>
      <ScrollView style={styles.options} bounces={false}>
        {question.options.map((option, index) => (
          <Pressable
            key={`${index}-${option}`}
            style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            onPress={() => void commitAnswer(option)}
            disabled={disabled || submitting}
          >
            <View style={styles.optionNumber}>
              <Text style={styles.optionNumberText}>{index + 1}</Text>
            </View>
            <Text style={styles.optionText}>{option}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.customRow}>
        <TextInput
          style={styles.input}
          value={customAnswer}
          onChangeText={setCustomAnswer}
          placeholder="输入其他回答…"
          placeholderTextColor={colors.textSecondary}
          editable={!disabled && !submitting}
          returnKeyType="send"
          onSubmitEditing={() => void commitAnswer(customAnswer)}
        />
        <Pressable
          style={[styles.send, !customAnswer.trim() && styles.sendDisabled]}
          onPress={() => void commitAnswer(customAnswer)}
          disabled={!customAnswer.trim() || disabled || submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <ArrowUp size={19} color={customAnswer.trim() ? colors.background : colors.textSecondary} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    card: {
      marginHorizontal: 12,
      marginBottom: 8,
      padding: 18,
      maxHeight: 440,
      borderRadius: 28,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    progress: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    question: { color: colors.text, fontSize: 18, lineHeight: 26, fontWeight: '600', marginBottom: 12 },
    options: { flexGrow: 0 },
    option: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingVertical: 10,
    },
    optionPressed: { opacity: 0.55 },
    optionNumber: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 17,
      backgroundColor: colors.background,
    },
    optionNumberText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    optionText: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 22 },
    customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14 },
    input: { flex: 1, minHeight: 44, color: colors.text, fontSize: 16, paddingHorizontal: 4 },
    send: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.text,
    },
    sendDisabled: { backgroundColor: colors.background },
  });
}
