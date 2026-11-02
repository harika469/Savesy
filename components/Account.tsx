import { ClerkProvider, useAuth, useUser } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo } from 'react';
import { SavesProvider } from '@/context/SavesContext';
import { authConfigured, clerkPublishableKey, setAccessTokenGetter } from '@/lib/supabase';

export type Account = {
  /** Clerk login is available in this build. */
  configured: boolean;
  loaded: boolean;
  signedIn: boolean;
  email?: string;
  signOut: () => Promise<void>;
};

const signedOut: Account = { configured: false, loaded: true, signedIn: false, signOut: async () => undefined };
const AccountContext = createContext<Account>(signedOut);
export const useAccount = () => useContext(AccountContext);

/**
 * Wraps the app with Clerk (when its key is in the build) and hands the signed-in user to the
 * saves store, so the library syncs to that account. Without Clerk, Savesy stays local-only.
 */
export function AccountRoot({ children }: PropsWithChildren) {
  if (!authConfigured) {
    return <AccountContext.Provider value={signedOut}><SavesProvider userId={null}>{children}</SavesProvider></AccountContext.Provider>;
  }
  return <ClerkProvider publishableKey={clerkPublishableKey!} tokenCache={tokenCache}><ClerkBridge>{children}</ClerkBridge></ClerkProvider>;
}

function ClerkBridge({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth();
  const { user } = useUser();

  // Every Supabase request carries the Clerk session token; Supabase checks it and RLS scopes rows to its user.
  useEffect(() => {
    setAccessTokenGetter(isSignedIn ? () => getToken() : null);
    return () => setAccessTokenGetter(null);
  }, [isSignedIn, getToken]);

  const account = useMemo<Account>(() => ({
    configured: true,
    loaded: isLoaded,
    signedIn: !!isSignedIn,
    email: user?.primaryEmailAddress?.emailAddress,
    signOut: async () => { await signOut(); },
  }), [isLoaded, isSignedIn, user, signOut]);

  return <AccountContext.Provider value={account}>
    <SavesProvider userId={!isLoaded ? undefined : isSignedIn ? userId : null}>{children}</SavesProvider>
  </AccountContext.Provider>;
}
