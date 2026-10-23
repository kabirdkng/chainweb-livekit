/**
 * LiveKit audio recovery helpers.
 *
 * After an OS phone call / tab background, WebRTC often stays "connected"
 * while remote audio elements stay silent (AudioContext suspended, tracks
 * unsubscribed, or autoplay blocked). These helpers re-subscribe remote mics
 * and unlock playback without tearing down the whole room.
 */
import { Track, type RemoteParticipant, type Room } from 'livekit-client';

export type ResumeLiveMediaResult = {
  /** startAudio succeeded or was unnecessary */
  audioUnlocked: boolean;
  /** Remote mic publications we forced back to subscribed */
  resubscribed: number;
  /** LiveKit reports remote audio may play */
  canPlaybackAudio: boolean;
};

type MicPublication = {
  source?: Track.Source;
  isSubscribed?: boolean;
  setSubscribed?: (subscribed: boolean) => void;
};

/** Force-subscribe microphone publications of remotes matching `identityFilter`. */
export function ensureRemoteMicsSubscribed(
  room: Room,
  identityFilter: (identity: string) => boolean = () => true,
): number {
  let resubscribed = 0;
  room.remoteParticipants.forEach((participant: RemoteParticipant) => {
    if (!identityFilter(participant.identity)) return;
    participant.audioTrackPublications.forEach((pub: MicPublication) => {
      if (pub.source !== Track.Source.Microphone) return;
      if (!pub.isSubscribed && typeof pub.setSubscribed === 'function') {
        pub.setSubscribed(true);
        resubscribed += 1;
      }
    });
  });
  return resubscribed;
}

/**
 * Unlock browser audio and re-subscribe remote mics after phone-call /
 * background interruptions / autoplay loss.
 */
export async function resumeLiveMedia(
  room: Room,
  opts: {
    /** Set false to skip re-subscribing (e.g. while audio is intentionally muted). */
    allowSubscribe?: boolean;
    /** Restrict which remote identities get re-subscribed. Default: all. */
    identityFilter?: (identity: string) => boolean;
  } = {},
): Promise<ResumeLiveMediaResult> {
  let audioUnlocked = false;
  try {
    await room.startAudio();
    audioUnlocked = true;
  } catch {
    // iOS may still require a user gesture; show a "Tap to enable sound" button.
    audioUnlocked = room.canPlaybackAudio;
  }
  const resubscribed =
    opts.allowSubscribe === false ? 0 : ensureRemoteMicsSubscribed(room, opts.identityFilter);
  return { audioUnlocked, resubscribed, canPlaybackAudio: room.canPlaybackAudio };
}
