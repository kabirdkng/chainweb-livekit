/** Map 8-bit PCM time-domain samples (center 128) to canvas polyline points. */
export function timeDomainToWavePoints(
  samples: Uint8Array,
  width: number,
  height: number,
  amplitude = 1,
): Array<{ x: number; y: number }> {
  const mid = height / 2;
  const maxAmp = (height / 2) * 0.88 * clamp01(amplitude);
  const len = samples.length;
  if (len === 0 || width <= 0 || height <= 0) return [];
  const last = Math.max(1, len - 1);
  const points = new Array<{ x: number; y: number }>(len);
  for (let i = 0; i < len; i++) {
    const v = ((samples[i] ?? 128) - 128) / 128;
    points[i] = {
      x: (i / last) * width,
      y: mid + v * maxAmp,
    };
  }
  return points;
}

export function rmsFromTimeDomain(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = ((samples[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 2.2);
}

export function downsampleTimeDomain(
  samples: Uint8Array,
  targetCount: number,
): Uint8Array {
  if (targetCount <= 0) return new Uint8Array(0);
  if (samples.length <= targetCount) return samples;
  const out = new Uint8Array(targetCount);
  const step = samples.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    out[i] = samples[Math.floor(i * step)] ?? 128;
  }
  return out;
}

/**
 * Fallback oscilloscope when LiveKit audioLevel is the only real signal
 * (no AnalyserNode / no attached MediaStreamTrack yet).
 */
export function syntheticWavePoints(
  audioLevel: number,
  width: number,
  height: number,
  phase: number,
  sampleCount = 96,
): Array<{ x: number; y: number }> {
  const mid = height / 2;
  const amp = (height / 2) * 0.8 * clamp01(audioLevel);
  const last = Math.max(1, sampleCount - 1);
  const points = new Array<{ x: number; y: number }>(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / last;
    points[i] = {
      x: t * width,
      y:
        mid +
        Math.sin(t * Math.PI * 4 + phase) * amp * 0.72 +
        Math.sin(t * Math.PI * 8 + phase * 1.4) * amp * 0.28,
    };
  }
  return points;
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}
