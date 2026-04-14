import { useEffect, useRef } from 'react';
import type { OrientationState } from '../hooks/useDeviceOrientation';
import type { SunPosition } from '../hooks/useSunPosition';
import { analyseSky } from '../analysis/skyAnalysis';
import type { SkyAnalysis } from '../analysis/skyAnalysis';

interface Props {
  stream: MediaStream | null;
  orientation: OrientationState;
  sun: SunPosition | null;
  fovH: number; // horizontal field of view in degrees
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  onSkyAnalysis?: (analysis: SkyAnalysis | null) => void;
}

const TWO_PI = Math.PI * 2;

/** Normalize an angle difference to [-180, 180]. */
function angleDiff(a: number, b: number): number {
  const d = ((a - b) + 540) % 360 - 180;
  return d;
}

/** How many frames to skip between sky analyses. */
const ANALYSIS_INTERVAL = 6;

export function SunOverlay({ stream, orientation, sun, fovH, videoRef, overlayRef, onSkyAnalysis }: Props) {
  const rafRef = useRef<number>(0);
  const frameCount = useRef(0);
  const lastAnalysis = useRef<SkyAnalysis | null>(null);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (stream) {
      video.srcObject = stream;
      video.play().catch(() => {/* autoplay may be blocked */});
    } else {
      video.srcObject = null;
    }
  }, [stream, videoRef]);

  // Draw loop
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    function draw() {
      rafRef.current = requestAnimationFrame(draw);

      const ctx = canvas!.getContext('2d');
      if (!ctx) return;

      const W = canvas!.offsetWidth;
      const H = canvas!.offsetHeight;
      if (canvas!.width !== W || canvas!.height !== H) {
        canvas!.width = W;
        canvas!.height = H;
      }

      ctx.clearRect(0, 0, W, H);

      // --- Sky analysis (throttled) ---
      const video = videoRef.current;
      frameCount.current++;
      if (video && frameCount.current % ANALYSIS_INTERVAL === 0) {
        const result = analyseSky(video);
        lastAnalysis.current = result;
        onSkyAnalysis?.(result);
      }

      const sky = lastAnalysis.current;

      // --- Draw skyline ---
      if (sky) {
        drawSkyline(ctx, sky, W, H);
      }

      // --- Draw detected sun blob ---
      if (sky?.sunDetected && sky.sunCenter) {
        drawDetectedSun(ctx, sky.sunCenter.nx * W, sky.sunCenter.ny * H);
      }

      // --- Computed sun position overlay ---
      const hasData =
        sun != null &&
        orientation.absolute &&
        orientation.heading != null &&
        orientation.tilt != null;

      if (!hasData) return;

      const heading = orientation.heading!;
      const tilt = orientation.tilt!;
      const roll = orientation.roll ?? 0;
      const sunAz = sun!.azimuth;
      const sunEl = sun!.altitude;

      const videoW = video?.videoWidth || 1920;
      const videoH = video?.videoHeight || 1080;
      const nativeFovV = fovH * (videoH / videoW);
      const scale = Math.max(W / videoW, H / videoH);
      const visibleVideoW = W / scale;
      const visibleVideoH = H / scale;
      const visibleFovH = fovH * (visibleVideoW / videoW);
      const visibleFovV = nativeFovV * (visibleVideoH / videoH);

      const dAz = angleDiff(sunAz, heading);
      const dEl = sunEl - tilt;

      const rollRad = (roll * Math.PI) / 180;
      const dAzRot = dAz * Math.cos(rollRad) + dEl * Math.sin(rollRad);
      const dElRot = -dAz * Math.sin(rollRad) + dEl * Math.cos(rollRad);

      const px = W / 2 + (dAzRot / (visibleFovH / 2)) * (W / 2);
      const py = H / 2 - (dElRot / (visibleFovV / 2)) * (H / 2);

      const inFrame =
        px >= -40 && px <= W + 40 && py >= -40 && py <= H + 40;

      if (inFrame) {
        drawSunDot(ctx, px, py);
      } else {
        drawEdgeArrow(ctx, W, H, dAzRot, dElRot, visibleFovH, visibleFovV);
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [orientation, sun, fovH, overlayRef, videoRef, onSkyAnalysis]);

  return (
    <div className="sun-overlay">
      <video
        ref={videoRef as React.RefObject<HTMLVideoElement>}
        className="sun-overlay__video"
        playsInline
        muted
        autoPlay
      />
      <canvas
        ref={overlayRef as React.RefObject<HTMLCanvasElement>}
        className="sun-overlay__canvas"
      />
    </div>
  );
}

// ===================================================================
// Drawing helpers
// ===================================================================

/** Draw the skyline boundary as a smooth translucent line. */
function drawSkyline(
  ctx: CanvasRenderingContext2D,
  sky: SkyAnalysis,
  W: number,
  H: number,
) {
  const { skyline, width, height } = sky;
  if (skyline.length === 0) return;

  const xScale = W / width;
  const yScale = H / height;

  ctx.beginPath();
  ctx.moveTo(0, skyline[0] * yScale);

  for (let x = 1; x < width; x++) {
    ctx.lineTo(x * xScale, skyline[x] * yScale);
  }

  // Fill sky region (above the line) with a subtle tint
  ctx.lineTo(W, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(100, 180, 255, 0.08)';
  ctx.fill();

  // Stroke the skyline
  ctx.beginPath();
  ctx.moveTo(0, skyline[0] * yScale);
  for (let x = 1; x < width; x++) {
    ctx.lineTo(x * xScale, skyline[x] * yScale);
  }
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Draw a marker where the sun was detected in the image. */
function drawDetectedSun(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const r = 30;

  // Dashed ring around detected position
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText('DETECTED', x + 1, y + r + 5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.fillText('DETECTED', x, y + r + 4);
}

/** Draw the computed sun position as a glowing dot. */
function drawSunDot(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const r = 22;

  // Outer glow
  const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.5);
  glow.addColorStop(0, 'rgba(255, 220, 50, 0.55)');
  glow.addColorStop(1, 'rgba(255, 180, 0, 0)');
  ctx.beginPath();
  ctx.arc(x, y, r * 2.5, 0, TWO_PI);
  ctx.fillStyle = glow;
  ctx.fill();

  // Core circle
  const core = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  core.addColorStop(0, '#fff9c4');
  core.addColorStop(0.5, '#ffe600');
  core.addColorStop(1, '#ff9800');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fillStyle = core;
  ctx.fill();

  // Thin border
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Crosshair lines
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  const armLen = r + 12;
  ctx.beginPath();
  ctx.moveTo(x - armLen, y); ctx.lineTo(x + armLen, y);
  ctx.moveTo(x, y - armLen); ctx.lineTo(x, y + armLen);
  ctx.stroke();
}

/** Draw an edge arrow pointing toward the sun when it's offscreen. */
function drawEdgeArrow(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  dAz: number,
  dEl: number,
  fovH: number,
  fovV: number,
) {
  const angleRad = Math.atan2(-dEl / fovV, dAz / fovH);
  const margin = 44;
  const cx = W / 2;
  const cy = H / 2;

  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const xEdge = cos > 0 ? W - margin : margin;
  const yEdge = sin < 0 ? margin : H - margin;
  const tx1 = cos !== 0 ? (xEdge - cx) / cos : Infinity;
  const ty1 = sin !== 0 ? (yEdge - cy) / sin : Infinity;
  const t = Math.min(Math.abs(tx1), Math.abs(ty1));
  let tx = cx + cos * t;
  let ty = cy + sin * t;
  tx = Math.max(margin, Math.min(W - margin, tx));
  ty = Math.max(margin, Math.min(H - margin, ty));

  const arrowLen = 28;
  const arrowWidth = 10;

  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(angleRad);

  ctx.beginPath();
  ctx.moveTo(arrowLen / 2, 0);
  ctx.lineTo(-arrowLen / 2, arrowWidth / 2);
  ctx.lineTo(-arrowLen / 2, -arrowWidth / 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 220, 50, 0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();

  const labelOffset = 18;
  const lx = Math.max(30, Math.min(W - 30, tx + cos * labelOffset));
  const ly = Math.max(20, Math.min(H - 20, ty + sin * labelOffset));
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText('SUN', lx + 1, ly + 1);
  ctx.fillStyle = '#ffe600';
  ctx.fillText('SUN', lx, ly);
}
