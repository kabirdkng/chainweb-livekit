/**
 * Framework-agnostic LiveKit session helpers: reconnect policies, disconnect
 * classification, auth-failure detection and a safe token-swap protocol.
 */
import { DisconnectReason } from 'livekit-client';

export type ReconnectPolicy = {
  nextRetryDelayInMs: (context: { retryCount: number }) => number | null;
};

/** Gives up after ~12 retries so the app can do a hard rejoin with a fresh token. */
export const LIVEKIT_RECONNECT_POLICY: ReconnectPolicy = {
  nextRetryDelayInMs: (context) => {
    if (context.retryCount > 12) return null;
    return Math.min(800 * Math.pow(1.5, context.retryCount), 10_000);
  },
};

/** Never stops retrying (backoff capped at 10s). Good for 1:1 calls that must survive outages. */
export const PERSISTENT_RECONNECT_POLICY: ReconnectPolicy = {
  nextRetryDelayInMs: (context) => {
    const step = Math.min(Math.max(0, context.retryCount), 12);
    return Math.min(800 * Math.pow(1.5, step), 10_000);
  },
};

/** True when a disconnect is worth an automatic hard rejoin. */
export function isRecoverableDisconnect(reason?: DisconnectReason | number): boolean {
  const code = reason as DisconnectReason | undefined;
  return !(
    code === DisconnectReason.CLIENT_INITIATED ||
    code === DisconnectReason.DUPLICATE_IDENTITY ||
    code === DisconnectReason.PARTICIPANT_REMOVED ||
    code === DisconnectReason.ROOM_DELETED ||
    code === DisconnectReason.ROOM_CLOSED ||
    code === DisconnectReason.USER_REJECTED
  );
}

/**
 * For rooms where a drop must never end the call: only ignore a client-initiated
 * disconnect (token swap / refresh) or a duplicate identity; rejoin otherwise.
 */
export function persistentDisconnectAction(reason?: DisconnectReason | number): 'ignore' | 'rejoin' {
  const code = reason as DisconnectReason | undefined;
  return code === DisconnectReason.CLIENT_INITIATED || code === DisconnectReason.DUPLICATE_IDENTITY
    ? 'ignore'
    : 'rejoin';
}

/** Extract a readable message from an axios/fetch-style error or plain Error. */
export function readApiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: { message?: unknown; error?: unknown } } }).response?.data;
    const raw = data?.message ?? data?.error;
    if (typeof raw === 'string' && raw.trim()) return raw;
    if (Array.isArray(raw)) {
      const text = raw.filter((item) => typeof item === 'string').join(' ');
      if (text.trim()) return text;
    }
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

/** LiveKit auth failures mean the JWT is dead: mint a fresh token, don't retry the same one. */
export function isLiveKitAuthFailure(error?: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message ?? '')
          : String(error ?? '');
  const lower = message.toLowerCase();
  return (
    lower.includes('invalid token') ||
    lower.includes('token: revoked') ||
    lower.includes('token revoked') ||
    (lower.includes('revoked') && lower.includes('token')) ||
    lower.includes('authentication failed') ||
    lower.includes('no valid credentials') ||
    lower.includes('unauthorized') ||
    (lower.includes('could not establish signal connection') &&
      (lower.includes('token') || lower.includes('auth') || lower.includes('401')))
  );
}

/** Keep a freshly applied token while the first handshake runs; re-minting rotates identity. */
export const FIRST_TOKEN_HOLD_MS = 20_000;
export function shouldHoldFirstToken(tokenAppliedAtMs: number, nowMs: number): boolean {
  return !!tokenAppliedAtMs && nowMs - tokenAppliedAtMs < FIRST_TOKEN_HOLD_MS;
}

/** Delay before app-level hard rejoin. */
export function hardRejoinDelayMs(attempt: number): number {
  return Math.min(1_000 * Math.max(1, attempt), 6_000);
}
/** Reconnecting longer than this (after a prior connect) → hard rejoin. */
export const RECONNECTING_WATCHDOG_MS = 15_000;
/** Disconnected longer than this (after a prior connect) → hard rejoin. */
export const DISCONNECTED_WATCHDOG_MS = 8_000;
/** Never reached Connected within this window → hard rejoin. */
export const FIRST_CONNECT_WATCHDOG_MS = 12_000;

export interface TokenSink {
  getToken(): string | null;
  setToken(token: string | null): void;
  setWsUrl?(url: string): void;
  setError?(message: string | null): void;
}

/**
 * Apply a new token with a null-swap so <LiveKitRoom> remounts cleanly.
 * `markTokenSwap(true)` lets your disconnect handler ignore the CLIENT_INITIATED
 * disconnect that the swap causes.
 */
export async function applyTokenWithSwap(
  sink: TokenSink,
  token: string,
  wsUrl?: string,
  markTokenSwap?: (active: boolean) => void,
): Promise<void> {
  const hadToken = !!sink.getToken();
  markTokenSwap?.(true);
  if (wsUrl) sink.setWsUrl?.(wsUrl);
  const finish = () => {
    sink.setToken(token);
    sink.setError?.(null);
    setTimeout(() => markTokenSwap?.(false), 1_200);
  };
  if (hadToken) {
    sink.setToken(null);
    await new Promise<void>((resolve) => queueMicrotask(() => { finish(); resolve(); }));
  } else {
    finish();
  }
}
