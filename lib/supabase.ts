import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)?.trim();
export const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || undefined;

/** Clerk login is on when its key is in the build. */
export const authConfigured = !!clerkPublishableKey;
/**
 * Cloud sync is OFF unless EXPO_PUBLIC_CLOUD_SYNC_ENABLED is exactly "true" (and Supabase + Clerk are configured).
 * Off = the local-only beta: saving, collections, search, sharing and backups work on the phone; nothing syncs.
 * Turn it on only after the B1 migration is live and the B2/B3 checks pass (issue #1).
 */
export const cloudSyncFlag = (value: string | undefined) => value === 'true';
export const cloudConfigured = !!url && !!key && authConfigured && cloudSyncFlag(process.env.EXPO_PUBLIC_CLOUD_SYNC_ENABLED);

type TokenGetter = () => Promise<string | null>;
let getAccessToken: TokenGetter | null = null;

/** Called by the auth bridge so every Supabase request carries the signed-in user's Clerk session token. */
export function setAccessTokenGetter(getter: TokenGetter | null) { getAccessToken = getter; }

let client: SupabaseClient | null = null;

/** The Supabase client, or null when not configured or while rendering web pages on the server. */
export function getSupabase(): SupabaseClient | null {
  if (!cloudConfigured) return null;
  if (Platform.OS === 'web' && typeof window === 'undefined') return null;
  if (!client) {
    // Clerk is a Supabase third-party auth provider: Supabase verifies the Clerk token itself.
    client = createClient(url!, key!, { accessToken: async () => (await getAccessToken?.()) ?? null });
  }
  return client;
}
