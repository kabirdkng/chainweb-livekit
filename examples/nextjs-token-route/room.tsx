'use client';
// Minimal room page using the kit's token hook and resilient room options.
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import { useLiveKitToken } from '@chainweb/livekit-kit/react';
import { LIVEKIT_RECONNECT_POLICY, getLiveKitRoomOptions, isRecoverableDisconnect } from '@chainweb/livekit-kit/client';

export default function Room({ room, userId }: { room: string; userId: string }) {
  const { token, wsUrl, error, refresh, isSwapping } = useLiveKitToken({
    fetchToken: () =>
      fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, userId, role: 'speaker' }),
      }).then((r) => r.json()),
  });

  if (error) return <p>{error}</p>;
  if (!token) return <p>Connecting…</p>;
  return (
    <LiveKitRoom
      token={token}
      serverUrl={wsUrl}
      connect
      options={getLiveKitRoomOptions(LIVEKIT_RECONNECT_POLICY)}
      onDisconnected={(reason) => {
        if (!isSwapping() && isRecoverableDisconnect(reason)) setTimeout(refresh, 1000);
      }}
    >
      <VideoConference />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}
