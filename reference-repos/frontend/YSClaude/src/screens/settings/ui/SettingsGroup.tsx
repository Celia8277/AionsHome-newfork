import { type ReactNode, Children, Fragment, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSettingsPageColors, type ThemeColors } from '../../../theme/colors';

type SettingsGroupProps = {
  header?: string;
  footer?: string;
  children: ReactNode;
  /** 额外底部间距控制，默认 20 */
  marginBottom?: number;
};

/**
 * iOS Settings 风格分组卡片：
 * - 上方可选组标题（小字灰色）
 * - 白色圆角卡片，子行之间自动插入 hairline 分隔线
 * - 下方可选说明 footer
 */
export function SettingsGroup({ header, footer, children, marginBottom = 20 }: SettingsGroupProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const items = Children.toArray(children).filter(Boolean);

  return (
    <View style={[styles.wrapper, { marginBottom }]}>
      {header ? <Text style={styles.header}>{header}</Text> : null}
      <View style={styles.card}>
        {items.map((child, index) => (
          <Fragment key={index}>
            {index > 0 && <View style={styles.separatorRow}><View style={styles.separator} /></View>}
            {child}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrapper: {},
    header: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 7,
      marginLeft: 16,
    },
    card: {
      backgroundColor: colors.inputBackground,
      borderRadius: 10,
      overflow: 'hidden',
    },
    separatorRow: {
      backgroundColor: colors.inputBackground,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: 16,
    },
    footer: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.textTertiary,
      marginTop: 7,
      marginHorizontal: 16,
    },
  });
