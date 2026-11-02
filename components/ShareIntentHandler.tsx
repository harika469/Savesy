import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRootNavigationState, useRouter } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import React, { PropsWithChildren, useEffect } from 'react';
import { Platform } from 'react-native';
import { extractUrl } from '@/utils/metadata';

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
    const text = shareIntent.text?.trim() ?? '';
    const url = shareIntent.webUrl ?? (text ? extractUrl(text) : undefined);
    const title = shareIntent.meta?.title?.trim();
    // Shared text that isn't just the link becomes the note ("Look at this! https://…").
    const leftover = url ? text.replace(url, '').trim() : text;
    const note = leftover && leftover !== title ? leftover : undefined;
    router.navigate({ pathname: '/add', params: { url, sharedTitle: title, sharedNote: note, shareId: String(Date.now()) } });
    resetShareIntent();
  }, [hasShareIntent, navigatorReady, shareIntent, resetShareIntent, router]);

  return null;
}
