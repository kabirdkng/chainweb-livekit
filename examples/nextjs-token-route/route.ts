// app/api/livekit/token/route.ts (Next.js App Router)
// Authenticate the caller with YOUR auth before minting a token.
import { NextResponse } from 'next/server';
import { LiveKitServer } from '@chainweb/livekit-kit/server';

const lk = new LiveKitServer(); // reads LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL

export async function POST(req: Request) {
  const { room, userId, name, role } = await req.json();
  // TODO: verify the session and that `userId` may join `room` with `role`.
  await lk.ensureRoom(room);
  const token = await lk.createToken({ roomName: room, role: role ?? 'viewer', id: userId, name });
  return NextResponse.json({ token, wsUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? lk.url });
}
