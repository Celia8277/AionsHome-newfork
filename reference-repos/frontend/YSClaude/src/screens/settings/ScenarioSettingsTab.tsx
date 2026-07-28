import { useMemo } from 'react';
import { ScrollView } from 'react-native';
import { useSettingsPageColors } from '../../theme/colors';
import { createSettingsStyles } from './styles';
import { APIConfigTab } from './APIConfigTab';
import { ChatSettingsTab } from './ChatSettingsTab';

type ScenarioSettingsTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
  scenario: 'chat' | 'image';
};

export function ScenarioSettingsTab({
  showToast,
  keyboardBottomInset,
  scenario,
}: ScenarioSettingsTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <APIConfigTab
        showToast={showToast}
        keyboardBottomInset={0}
        section={scenario}
        embedded
      />
      <ChatSettingsTab
        showToast={showToast}
        keyboardBottomInset={0}
        section={scenario}
        embedded
      />
      {scenario === 'chat' && (
        <APIConfigTab
          showToast={showToast}
          keyboardBottomInset={0}
          section="backup"
          embedded
        />
      )}
    </ScrollView>
  );
}
