'use client';

import { useEffect, useRef } from 'react';
import {
  createAudioAnalyser,
  isAudioTrack,
  type LocalAudioTrack,
  type RemoteAudioTrack,
} from 'livekit-client';
const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
import {
  downsampleTimeDomain,
  rmsFromTimeDomain,
  syntheticWavePoints,
  timeDomainToWavePoints,
} from '../client/audio-waveform.js';

type AnalyserPack = ReturnType<typeof createAudioAnalyser>;

export function AudioMicWaveform({
  track,
  micOn,
  getAudioLevel,
  className,
}: {
  track?: unknown;
  micOn: boolean;
  /** LiveKit participant.audioLevel (0-1), read each frame. */
  getAudioLevel?: () => number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const getAudioLevelRef = useRef(getAudioLevel);
  getAudioLevelRef.current = getAudioLevel;
  const trackSid =
    track && typeof track === 'object' && track !== null && 'sid' in track
      ? String((track as { sid?: string }).sid ?? '')
      : '';

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const audioTrack = isAudioTrack(track as LocalAudioTrack | RemoteAudioTrack)
      ? (track as LocalAudioTrack | RemoteAudioTrack)
      : null;

    let analyserPack: AnalyserPack | null = null;
    if (micOn && audioTrack) {
      try {
        analyserPack = createAudioAnalyser(audioTrack, {
          cloneTrack: false,
          fftSize: 512,
          smoothingTimeConstant: 0.55,
          minDecibels: -90,
          maxDecibels: -25,
        });
      } catch {
        analyserPack = null;
      }
    }

    const timeData = new Uint8Array(analyserPack?.analyser.fftSize ?? 512);
    let raf = 0;
    let phase = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = () => {
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      ctx.clearRect(0, 0, width, height);
      if (width <= 0 || height <= 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      let points: Array<{ x: number; y: number }>;
      let rms = 0;
      if (micOn && analyserPack) {
        analyserPack.analyser.getByteTimeDomainData(timeData);
        const samples = downsampleTimeDomain(timeData, 128);
        rms = rmsFromTimeDomain(samples);
        points = timeDomainToWavePoints(samples, width, height, 1);
      } else {
        const level = micOn ? Math.max(0, getAudioLevelRef.current?.() ?? 0) : 0;
        rms = level;
        phase += 0.12 + level * 0.25;
        points = syntheticWavePoints(level, width, height, phase, 96);
      }

      const glow = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.08,
        width / 2,
        height / 2,
        Math.min(width, height) * 0.55,
      );
      glow.addColorStop(0, `rgba(196, 181, 253, ${0.08 + rms * 0.38})`);
      glow.addColorStop(1, 'rgba(196, 181, 253, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      if (points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(0, height);
        ctx.lineTo(points[0]!.x, points[0]!.y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i]!.x, points[i]!.y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, 0, 0, height);
        fill.addColorStop(0, `rgba(167, 139, 250, ${0.16 + rms * 0.28})`);
        fill.addColorStop(1, 'rgba(167, 139, 250, 0.02)');
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(points[0]!.x, points[0]!.y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i]!.x, points[i]!.y);
        }
        ctx.strokeStyle = `rgba(237, 233, 254, ${0.55 + rms * 0.4})`;
        ctx.lineWidth = 2 + rms * 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      void analyserPack?.cleanup();
    };
  }, [micOn, track, trackSid]);

  return (
    <div ref={wrapRef} className={cn('absolute inset-0 z-[1] pointer-events-none', className)}>
      <canvas
        ref={canvasRef}
        data-testid="audio-mic-wave"
        className="h-full w-full"
        aria-hidden
      />
    </div>
  );
}
