import { useEffect, useState } from 'react';
import { Keyboard, KeyboardEvent, Platform } from 'react-native';

/**
 * 返回当前软键盘高度（px）。键盘收起时为 0。
 *
 * 为什么不用 KeyboardAvoidingView：
 * Expo SDK 54+ 起 Android 强制 edge-to-edge，窗口绘制到键盘后面，
 * adjustResize 不再缩小 RN 根视图，KeyboardAvoidingView 也常常拿不到
 * 正确的键盘高度，导致输入框不被顶起。直接监听 Keyboard 事件、
 * 自己给容器加 paddingBottom 是最可靠、零原生改动的做法。
 *
 * Android 用 keyboardDidShow/Hide（didXxx 才带最终高度，willXxx 在 Android 不触发）；
 * iOS 用 keyboardWillShow/Hide，跟随系统动画更顺滑。
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => setHeight(e.endCoordinates.height);
    const onHide = () => setHeight(0);

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
