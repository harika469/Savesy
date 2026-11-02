import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRootNavigationState, useRouter } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import React, { PropsWithChildren, useEffect } from 'react';
import { Platform } from 'react-native';
import { shareToSaveParams } from '@/utils/share';

// Expo Go and the web preview have no share extension, so the native module stays off there.
export const shareIntentDisabled = Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Receives links shared from other apps ("Share → Savesy") and opens them on the Save screen. */
export function ShareIntentRoot({ children }: PropsWithChildren) {
  return <ShareIntentProvider options={{ disabled: shareIntentDisabled, resetOnBackground: true }}><ShareIntentRouter />{children}</ShareIntentProvider>;
}

function ShareIntentRouter() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  // On a cold start the share can arrive before the navigator exists; wait for it.
  const navigatorReady = !!useRootNavigationState()?.key;

  useEffect(() => {
    if (!hasShareIntent || !navigatorReady) return;
    const prefill = shareToSaveParams(shareIntent);
    if (prefill) router.navigate({ pathname: '/add', params: { ...prefill, shareId: String(Date.now()) } });
    resetShareIntent();
  }, [hasShareIntent, navigatorReady, shareIntent, resetShareIntent, router]);

  return null;
}
