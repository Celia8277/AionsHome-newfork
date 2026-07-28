import { NativeModules, Platform } from 'react-native';

interface IncomingCallRingtoneModule {
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
}

const nativeModule = NativeModules.IncomingCallRingtone as IncomingCallRingtoneModule | undefined;

export async function startIncomingCallRingtone(): Promise<void> {
  if (Platform.OS === 'android' && nativeModule) await nativeModule.start();
}

export async function stopIncomingCallRingtone(): Promise<void> {
  if (Platform.OS === 'android' && nativeModule) await nativeModule.stop();
}
