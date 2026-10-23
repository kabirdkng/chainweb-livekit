/**
 * Helpers for egress output: LiveKit often reports the file on the deprecated
 * EgressInfo.file oneof and percent-encodes S3 URLs. These recover a stable
 * storage key and build public URLs (Supabase-style or any S3 public base).
 */

type FileBits = { location?: string; filename?: string };

function asFileBits(value: unknown): FileBits | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const location = typeof rec.location === 'string' ? rec.location : undefined;
  const filename = typeof rec.filename === 'string' ? rec.filename : undefined;
  if (!location && !filename) return null;
  return { location, filename };
}

export function decodeRecordingLocation(raw: string): string {
  let value = raw.trim();
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      break;
    }
  }
  return value;
}

export function egressFileInfo(info: unknown): FileBits {
  if (!info || typeof info !== 'object') return {};
  const rec = info as Record<string, unknown>;

  if (Array.isArray(rec.fileResults)) {
    for (const entry of rec.fileResults) {
      const bits = asFileBits(entry);
      if (bits) return bits;
    }
  }

  const result = rec.result as { case?: string; value?: unknown } | undefined;
  if (result?.case === 'file') {
    const bits = asFileBits(result.value);
    if (bits) return bits;
  }

  const deprecated = asFileBits(rec.file);
  if (deprecated) return deprecated;

  return {};
}

export function extractManagedStorageKey(
  raw: string,
  bucket = 'uploads',
): string | null {
  const trimmed = decodeRecordingLocation(raw);
  if (!trimmed) return null;

  if (!trimmed.includes('://') && !trimmed.startsWith('/')) {
    return trimmed.replace(/^\/+/, '') || null;
  }

  if (trimmed.startsWith('s3://')) {
    const withoutScheme = trimmed.slice('s3://'.length);
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex <= 0 || slashIndex + 1 >= withoutScheme.length) return null;
    return withoutScheme.slice(slashIndex + 1);
  }

  const tryPath = (pathname: string): string | null => {
    const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/${bucket}/`,
      `/storage/v1/s3/${bucket}/`,
      `/api/uploads/`,
      `/${bucket}/`,
    ];
    for (const marker of markers) {
      const idx = path.indexOf(marker);
      if (idx >= 0) {
        const key = path.slice(idx + marker.length).replace(/^\/+/, '');
        if (key) return key;
      }
    }
    return null;
  };

  try {
    return tryPath(new URL(trimmed).pathname);
  } catch {
    return tryPath(trimmed);
  }
}

export function toPublicRecordingUrl(
  storageBaseUrl: string,
  bucket: string,
  key: string,
): string {
  const base = storageBaseUrl.replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${bucket}/${key}`;
}
