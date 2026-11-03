// Test seam: the legacy client's getSupabase() returns whatever fake the rollout test installs.
import type { SupabaseClient } from '@supabase/supabase-js';
let client: unknown = null;
export function setLegacySupabase(c: unknown) { client = c; }
export function getSupabase(): SupabaseClient | null { return client as SupabaseClient | null; }
export const cloudConfigured = true;
