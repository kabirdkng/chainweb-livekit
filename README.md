# chainweb-livekit

Reusable [LiveKit](https://livekit.io) building blocks for real-time audio/video apps:

- **server**: role-based tokens (host / speaker / viewer / guest), room pre-creation with
  reconnect-friendly timeouts, live promote/demote, private mode, mute/kick/end, MP4
  recording to any S3-compatible bucket, webhook verification. Framework-agnostic
  (Next.js route handlers, Express, NestJS, workers).
- **client**: reconnect policies, disconnect/auth-failure classification, safe token
  swap, audio unlock + mic re-subscribe after phone calls/backgrounding, mobile-first
  capture and simulcast profiles, waveform math.
- **react**: `useLiveKitToken` hook and an `AudioMicWaveform` canvas component.

## Install

```bash
npm install github:kabirdkng/chainweb-livekit livekit-server-sdk livekit-client @livekit/components-react
```

## Configure

Copy `.env.example`. Server: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`
(optional `LIVEKIT_S3_*` for recordings). Browser: `NEXT_PUBLIC_LIVEKIT_URL`.
Or pass a config object: `new LiveKitServer({ apiKey, apiSecret, url, s3, identityPrefix })`.

## Server

```ts
import { LiveKitServer } from '@chainweb/livekit-kit/server';
const lk = new LiveKitServer();                       // from env

await lk.ensureRoom('room-1', { bookedSeconds: 1800 });
const token = await lk.createToken({ roomName: 'room-1', role: 'speaker', id: user.id, name: user.name, mode: 'audio' });

await lk.promote('room-1', 'user_42', 'video');       // viewer -> speaker, no reconnect
await lk.startPrivateMode('room-1', ['host_1', 'user_42']); // everyone else silenced, guests removed
await lk.demote('room-1', 'user_42');

const egressId = await lk.startRecording('room-1', `recordings/room-1-${Date.now()}`);
const { location } = await lk.stopRecording(egressId!);

const event = await lk.verifyWebhook(rawBody, req.headers.authorization);
```

Without keys the server runs in stub mode (returns `stub_` tokens, no-ops) for local dev.

| Role | Publish | Data | Room admin |
|---|---|---|---|
| host | camera + mic | yes | yes |
| speaker | by `mode`: chat (none) / audio (mic) / video (camera + mic) | yes | no |
| viewer | no | yes | no |
| guest | no | no | no |

## Client / React

```tsx
import { useLiveKitToken } from '@chainweb/livekit-kit/react';
import { LIVEKIT_RECONNECT_POLICY, getLiveKitRoomOptions, isRecoverableDisconnect, resumeLiveMedia } from '@chainweb/livekit-kit/client';
```

See `examples/nextjs-token-route/` for a complete token route and room page.

## Develop

```bash
npm install && npm run build && npm test
```

MIT licensed.
