'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyTokenWithSwap, readApiErrorMessage } from '../client/session.js';

export type TokenResponse = { token: string; wsUrl?: string; [key: string]: unknown };

export interface UseLiveKitTokenOptions {
  /** Fetches a token from your backend. */
  fetchToken: () => Promise<TokenResponse>;
  /** Fallback server URL when the response has no wsUrl. Defaults to NEXT_PUBLIC_LIVEKIT_URL. */
  defaultWsUrl?: string;
  /** Fetch on mount. Default true. */
  auto?: boolean;
}

/**
 * Holds { token, wsUrl } for <LiveKitRoom>. `refresh()` mints a new token and swaps
 * it in safely; `isSwapping()` tells your onDisconnected handler to ignore the
 * CLIENT_INITIATED disconnect caused by the swap.
 */
export function useLiveKitToken({ fetchToken, defaultWsUrl, auto = true }: UseLiveKitTokenOptions) {
  const [token, setToken] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string>(
    defaultWsUrl ?? (process.env.NEXT_PUBLIC_LIVEKIT_URL || ''),
  );
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const swapping = useRef(false);
  const fetchRef = useRef(fetchToken);
  fetchRef.current = fetchToken;

  const refresh = useCallback(async () => {
    try {
      const res = await fetchRef.current();
      if (!res?.token) throw new Error('LiveKit token missing from response');
      await applyTokenWithSwap(
        {
          getToken: () => tokenRef.current,
          setToken: (t) => { tokenRef.current = t; setToken(t); },
          setWsUrl,
          setError,
        },
        res.token,
        res.wsUrl,
        (active) => { swapping.current = active; },
      );
    } catch (err) {
      setError(readApiErrorMessage(err, 'Failed to get LiveKit token'));
    }
  }, []);

  useEffect(() => {
    if (auto) void refresh();
  }, [auto, refresh]);

  return { token, wsUrl, error, refresh, isSwapping: () => swapping.current };
}
