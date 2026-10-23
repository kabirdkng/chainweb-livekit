/**
 * Framework-agnostic LiveKit server helpers (works in Next.js route handlers,
 * Express, NestJS, workers). Role-based tokens, live permission changes,
 * moderation, S3 egress recording and webhook verification.
 */
import {
  AccessToken,
  EgressClient,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  RoomServiceClient,
  S3Upload,
  TrackSource,
  WebhookReceiver,
  type EgressInfo,
  type VideoGrant,
  type WebhookEvent,
} from 'livekit-server-sdk';
import { egressFileInfo } from './recording-location.js';

export * from './recording-location.js';

/** host = full publish + room admin; speaker = publish; viewer = subscribe + data; guest = subscribe only. */
export type Role = 'host' | 'speaker' | 'viewer' | 'guest';
export type MediaMode = 'chat' | 'audio' | 'video';

export interface S3Config {
  accessKey: string;
  secret: string;
  region: string;
  endpoint?: string;
  bucket: string;
  forcePathStyle?: boolean;
}

export interface LiveKitServerConfig {
  apiKey: string;
  apiSecret: string;
  /** wss:// or https:// LiveKit URL. */
  url: string;
  /** Default token TTL in seconds. Default 3600. */
  tokenTtlSeconds?: number;
  /** Identity prefixes per role. Default host_, user_, user_, guest_. */
  identityPrefix?: Partial<Record<Role, string>>;
  s3?: S3Config;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/** Read config from LIVEKIT_* / LIVEKIT_S3_* env vars. */
export function configFromEnv(env: Record<string, string | undefined> = process.env): LiveKitServerConfig {
  const s3 =
    env.LIVEKIT_S3_ACCESS_KEY && env.LIVEKIT_S3_SECRET && env.LIVEKIT_S3_BUCKET
      ? {
          accessKey: env.LIVEKIT_S3_ACCESS_KEY,
          secret: env.LIVEKIT_S3_SECRET,
          bucket: env.LIVEKIT_S3_BUCKET,
          region: env.LIVEKIT_S3_REGION || 'us-east-1',
          endpoint: env.LIVEKIT_S3_ENDPOINT || undefined,
          forcePathStyle: env.LIVEKIT_S3_FORCE_PATH_STYLE !== 'false',
        }
      : undefined;
  return {
    apiKey: env.LIVEKIT_API_KEY || '',
    apiSecret: env.LIVEKIT_API_SECRET || '',
    url: env.LIVEKIT_URL || '',
    tokenTtlSeconds: env.LIVEKIT_TOKEN_TTL ? Number(env.LIVEKIT_TOKEN_TTL) : undefined,
    s3,
  };
}

/** Room timeouts that let a network blip rejoin the same room instead of finding it deleted. */
export function roomTimeouts(bookedSeconds: number): { emptyTimeout: number; departureTimeout: number } {
  const booked = Number.isFinite(bookedSeconds) && bookedSeconds > 0 ? Math.floor(bookedSeconds) : 0;
  return {
    departureTimeout: 180,
    emptyTimeout: Math.min(4 * 60 * 60, Math.max(10 * 60, booked + 5 * 60)),
  };
}

function publishSources(mode: MediaMode): TrackSource[] | undefined {
  if (mode === 'chat') return undefined;
  if (mode === 'audio') return [TrackSource.MICROPHONE];
  return [TrackSource.CAMERA, TrackSource.MICROPHONE];
}

const VIEWER_PERMISSION = {
  canPublish: false,
  canPublishData: true,
  canSubscribe: true,
  canUpdateMetadata: false,
  hidden: false,
};

export class LiveKitServer {
  readonly room: RoomServiceClient | null;
  readonly egress: EgressClient | null;
  private webhook: WebhookReceiver | null = null;
  private readonly log: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly prefix: Record<Role, string>;

  constructor(private readonly cfg: LiveKitServerConfig = configFromEnv()) {
    this.log = cfg.logger ?? console;
    this.prefix = { host: 'host_', speaker: 'user_', viewer: 'user_', guest: 'guest_', ...cfg.identityPrefix };
    if (cfg.apiKey && cfg.apiSecret && cfg.url) {
      const http = cfg.url.replace(/^wss?/, 'https');
      this.room = new RoomServiceClient(http, cfg.apiKey, cfg.apiSecret);
      this.egress = new EgressClient(http, cfg.apiKey, cfg.apiSecret);
    } else {
      this.room = null;
      this.egress = null;
      this.log.warn('[livekit] LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL not set: stub mode');
    }
  }

  get configured(): boolean {
    return !!this.room;
  }
  get url(): string {
    return this.cfg.url;
  }

  identity(role: Role, id: string, override?: string): string {
    return override?.trim() || `${this.prefix[role]}${id}`;
  }

  grantFor(role: Role, roomName: string, mode: MediaMode = 'video'): VideoGrant {
    const base: VideoGrant = { roomJoin: true, room: roomName, canSubscribe: true };
    switch (role) {
      case 'host':
        return { ...base, canPublish: true, canPublishData: true, canUpdateOwnMetadata: true, roomAdmin: true,
          canPublishSources: publishSources(mode === 'chat' ? 'video' : mode) };
      case 'speaker': {
        const sources = publishSources(mode);
        return { ...base, canPublish: mode !== 'chat', canPublishData: true, canUpdateOwnMetadata: true,
          ...(sources ? { canPublishSources: sources } : {}) };
      }
      case 'viewer':
        return { ...base, canPublish: false, canPublishData: true, canUpdateOwnMetadata: false };
      case 'guest':
        return { ...base, canPublish: false, canPublishData: false, canUpdateOwnMetadata: false };
    }
  }

  /** Mint a JWT. Returns a `stub_` token when keys aren't configured (local dev). */
  async createToken(opts: {
    roomName: string;
    role: Role;
    id: string;
    name?: string;
    mode?: MediaMode;
    ttlSeconds?: number;
    identityOverride?: string;
    metadata?: string;
  }): Promise<string> {
    const identity = this.identity(opts.role, opts.id, opts.identityOverride);
    if (!this.cfg.apiKey || !this.cfg.apiSecret) return `stub_${identity}_${opts.roomName}_${Date.now()}`;
    const at = new AccessToken(this.cfg.apiKey, this.cfg.apiSecret, {
      identity,
      name: opts.name ?? identity,
      ttl: opts.ttlSeconds ?? this.cfg.tokenTtlSeconds ?? 3600,
      metadata: opts.metadata,
    });
    at.addGrant(this.grantFor(opts.role, opts.roomName, opts.mode));
    return at.toJwt();
  }

  /** Pre-create a room with long empty/departure timeouts. Errors are logged, not thrown. */
  async ensureRoom(roomName: string, opts: { bookedSeconds?: number; maxParticipants?: number } = {}) {
    if (!this.room) return;
    const t = roomTimeouts(opts.bookedSeconds ?? 0);
    try {
      await this.room.createRoom({ name: roomName, ...t, maxParticipants: opts.maxParticipants ?? 0 });
    } catch (err) {
      this.log.warn(`[livekit] ensureRoom ${roomName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Promote a connected participant to speaker without reconnecting. */
  async promote(roomName: string, identity: string, mode: MediaMode = 'video'): Promise<void> {
    if (!this.room) return;
    const sources = publishSources(mode);
    await this.room.updateParticipant(roomName, identity, undefined, {
      canPublish: mode !== 'chat', canPublishData: true, canSubscribe: true,
      ...(sources ? { canPublishSources: sources } : {}), canUpdateMetadata: false, hidden: false,
    } as any);
  }

  /** Return a participant to viewer (subscribe + data only). */
  async demote(roomName: string, identity: string): Promise<void> {
    if (!this.room) return;
    await this.room.updateParticipant(roomName, identity, undefined, VIEWER_PERMISSION as any);
  }

  /**
   * Private mode: only `keepIdentities` may publish; everyone else becomes a viewer.
   * Guests (by identity prefix) are optionally removed.
   */
  async startPrivateMode(roomName: string, keepIdentities: string[], opts: { removeGuests?: boolean; mode?: MediaMode } = {}) {
    if (!this.room) return;
    const parts = await this.room.listParticipants(roomName);
    const guestPrefix = this.prefix.guest;
    await Promise.all(
      parts.map(async (p) => {
        if (!p.identity) return;
        if (opts.removeGuests !== false && p.identity.startsWith(guestPrefix)) {
          try { await this.room!.removeParticipant(roomName, p.identity); } catch (e) { this.log.warn(`[livekit] remove guest ${p.identity}: ${e}`); }
          return;
        }
        if (keepIdentities.includes(p.identity)) return;
        await this.room!.updateParticipant(roomName, p.identity, undefined, VIEWER_PERMISSION as any);
      }),
    );
  }

  async muteParticipant(roomName: string, identity: string): Promise<void> {
    if (!this.room) return;
    const p = await this.room.getParticipant(roomName, identity);
    await Promise.all(
      (p.tracks ?? []).filter((t) => t.sid && !t.muted).map((t) => this.room!.mutePublishedTrack(roomName, identity, t.sid, true)),
    );
  }
  async kickParticipant(roomName: string, identity: string) {
    if (this.room) await this.room.removeParticipant(roomName, identity);
  }
  async endRoom(roomName: string) {
    if (this.room) await this.room.deleteRoom(roomName);
  }
  async listParticipants(roomName: string) {
    if (!this.room) return [];
    try { return await this.room.listParticipants(roomName); } catch { return []; }
  }
  async listRooms() {
    if (!this.room) return [];
    try { return await this.room.listRooms(); } catch { return []; }
  }

  /** Start an MP4 room-composite recording to S3. Returns egressId or null. */
  async startRecording(roomName: string, filepath: string): Promise<string | null> {
    if (!this.egress || !this.cfg.s3) {
      this.log.warn('[livekit] recording skipped: egress or S3 config missing');
      return null;
    }
    const s3 = this.cfg.s3;
    const info = await this.egress.startRoomCompositeEgress(
      roomName,
      new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath,
        output: {
          case: 's3',
          value: new S3Upload({
            accessKey: s3.accessKey, secret: s3.secret, region: s3.region,
            endpoint: s3.endpoint ?? '', bucket: s3.bucket, forcePathStyle: s3.forcePathStyle ?? true,
          }),
        },
      }),
      { audioOnly: false, videoOnly: false },
    );
    return info.egressId || null;
  }

  /** Stop a recording and wait (up to ~30s) for its final file location. */
  async stopRecording(egressId: string): Promise<{ location?: string; status?: string }> {
    if (!this.egress) return {};
    try { await this.egress.stopEgress(egressId); } catch (e) { this.log.warn(`[livekit] stopEgress ${egressId}: ${e}`); }
    const info = await this.waitForEgress(egressId, 15, 2000);
    if (!info) return { status: 'UNKNOWN' };
    const file = egressFileInfo(info);
    return { location: file.location || file.filename || undefined, status: EgressStatus[info.status] || String(info.status) };
  }

  private async waitForEgress(egressId: string, attempts: number, delayMs: number): Promise<EgressInfo | null> {
    const done = [EgressStatus.EGRESS_COMPLETE, EgressStatus.EGRESS_FAILED, EgressStatus.EGRESS_ABORTED, EgressStatus.EGRESS_LIMIT_REACHED];
    for (let i = 0; i < attempts; i += 1) {
      const [info] = await this.egress!.listEgress({ egressId });
      if (info && done.includes(info.status)) return info;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    const [info] = await this.egress!.listEgress({ egressId });
    return info || null;
  }

  /** Verify the Authorization header and decode a LiveKit webhook body. */
  async verifyWebhook(rawBody: string, authHeader?: string): Promise<WebhookEvent> {
    if (!this.cfg.apiKey || !this.cfg.apiSecret) throw new Error('LiveKit API key/secret not configured');
    this.webhook ??= new WebhookReceiver(this.cfg.apiKey, this.cfg.apiSecret);
    return this.webhook.receive(rawBody, authHeader);
  }
}
