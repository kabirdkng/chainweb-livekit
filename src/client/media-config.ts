/**
 * Mobile-first LiveKit media defaults for low-end devices and weak networks.
 */

import { VideoPresets, type TrackPublishDefaults, type VideoCaptureOptions } from 'livekit-client';

export type MediaProfile = 'mobile' | 'standard' | 'hd';

/** User override: auto follows network/viewport; otherwise force a profile. */
export type MediaProfilePreference = 'auto' | MediaProfile;

let storagePrefix = 'livekit-kit';
/** Change the localStorage key prefix used for media preferences. */
export function setMediaStoragePrefix(prefix: string): void {
  storagePrefix = prefix;
}
const prefKey = () => `${storagePrefix}.mediaProfile`;
const dataSaverKey = () => `${storagePrefix}.dataSaver`;

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(max-width: 768px)').matches;
}

function prefersSaveData(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem(dataSaverKey()) === '1') return true;
  } catch {
    /* ignore */
  }
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (conn?.saveData) return true;
  const t = conn?.effectiveType;
  return t === '2g' || t === 'slow-2g' || t === '3g';
}

export function getStoredMediaProfilePreference(): MediaProfilePreference {
  if (typeof window === 'undefined') return 'auto';
  try {
    const v = localStorage.getItem(prefKey());
    if (v === 'mobile' || v === 'standard' || v === 'hd' || v === 'auto') return v;
  } catch {
    /* ignore */
  }
  return 'auto';
}

export function setStoredMediaProfilePreference(pref: MediaProfilePreference): void {
  try {
    localStorage.setItem(prefKey(), pref);
  } catch {
    /* ignore */
  }
}

export function getStoredDataSaver(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(dataSaverKey()) === '1';
  } catch {
    return false;
  }
}

export function setStoredDataSaver(on: boolean): void {
  try {
    localStorage.setItem(dataSaverKey(), on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Choose capture profile from preference + network/viewport heuristics. */
export function resolveMediaProfile(
  preference: MediaProfilePreference = getStoredMediaProfilePreference(),
): MediaProfile {
  if (preference !== 'auto') return preference;
  if (prefersSaveData() || isMobileViewport()) return 'mobile';
  return 'standard';
}

/** Camera capture constraints used when enabling the publisher camera. */
export function getVideoCaptureOptions(
  profile: MediaProfile = resolveMediaProfile(),
  facingMode: 'user' | 'environment' = 'user',
): VideoCaptureOptions {
  if (profile === 'mobile') {
    return {
      facingMode,
      resolution: {
        width: 640,
        height: 360,
        frameRate: 20,
      },
    };
  }
  if (profile === 'hd') {
    return {
      facingMode,
      resolution: {
        width: 1280,
        height: 720,
        frameRate: 30,
      },
    };
  }
  return {
    facingMode,
    resolution: {
      width: 960,
      height: 540,
      frameRate: 24,
    },
  };
}

/**
 * Publish defaults: simulcast ladder so viewers can downshift on weak networks.
 * LiveKit adaptiveStream/dynacast use these layers.
 */
export function getTrackPublishDefaults(
  profile: MediaProfile = resolveMediaProfile(),
): TrackPublishDefaults {
  if (profile === 'mobile') {
    return {
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      videoCodec: 'h264',
      dtx: true,
      red: true,
    };
  }
  if (profile === 'hd') {
    return {
      videoSimulcastLayers: [
        VideoPresets.h180,
        VideoPresets.h360,
        VideoPresets.h540,
        VideoPresets.h720,
      ],
      videoCodec: 'h264',
      dtx: true,
      red: true,
    };
  }
  return {
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h540],
    videoCodec: 'h264',
    dtx: true,
    red: true,
  };
}

export function nextMediaProfilePreference(
  current: MediaProfilePreference,
): MediaProfilePreference {
  const order: MediaProfilePreference[] = ['auto', 'mobile', 'standard', 'hd'];
  const i = order.indexOf(current);
  return order[(i + 1) % order.length];
}

export function mediaProfileLabel(pref: MediaProfilePreference): string {
  switch (pref) {
    case 'mobile':
      return 'Low';
    case 'standard':
      return 'Balanced';
    case 'hd':
      return 'HD';
    default:
      return 'Auto';
  }
}

/** LiveKitRoom `options` for both host and viewer. */
export function getLiveKitRoomOptions(reconnectPolicy: {
  nextRetryDelayInMs: (context: { retryCount: number }) => number | null;
}) {
  const profile = resolveMediaProfile();
  return {
    adaptiveStream: true,
    dynacast: true,
    reconnectPolicy,
    publishDefaults: getTrackPublishDefaults(profile),
    videoCaptureDefaults: getVideoCaptureOptions(profile),
  };
}
