import { useEffect, useRef } from 'react';
import type { OrientationState } from '../hooks/useDeviceOrientation';
import type { SunPosition } from '../hooks/useSunPosition';

interface Props {
  stream: MediaStream | null;
  orientation: OrientationState;
  sun: SunPosition | null;
  fovH: number; // horizontal field of view in degrees
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
}

const TWO_PI = Math.PI * 2;

/** Normalize an angle difference to [-180, 180]. */
function angleDiff(a: number, b: number): number {
  let d = ((a - b) + 540) % 360 - 180;
  return d;
}

export function SunOverlay({ stream, orientation, sun, fovH, videoRef, overlayRef }: Props) {
  const rafRef = useRef<number>(0);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (stream) {
      video.srcObject = stream;
      video.play().catch(() => {/* autoplay may be blocked, user interaction unblocks it */});
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

      // Horizontal FoV given; derive vertical FoV from aspect ratio
      const fovV = fovH * (H / W);

      // Angular offset from where the camera is pointing
      const dAz = angleDiff(sunAz, heading);   // positive = sun is to the right
      const dEl = sunEl - tilt;                 // positive = sun is above center

      // Account for roll: rotate the (dAz, dEl) vector by -roll
      const rollRad = (roll * Math.PI) / 180;
      const dAzRot = dAz * Math.cos(rollRad) + dEl * Math.sin(rollRad);
      const dElRot = -dAz * Math.sin(rollRad) + dEl * Math.cos(rollRad);

      // Convert angular offsets to pixel positions
      const px = W / 2 + (dAzRot / (fovH / 2)) * (W / 2);
      const py = H / 2 - (dElRot / (fovV / 2)) * (H / 2);

      const inFrame =
        px >= -40 && px <= W + 40 && py >= -40 && py <= H + 40;

      if (inFrame) {
        drawSunDot(ctx, px, py);
      } else {
        drawEdgeArrow(ctx, W, H, dAzRot, dElRot, fovH, fovV);
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [orientation, sun, fovH, overlayRef]);

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

function drawEdgeArrow(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  dAz: number,
  dEl: number,
  fovH: number,
  fovV: number
) {
  // Angle of the sun relative to screen center
  const angleRad = Math.atan2(-dEl / fovV, dAz / fovH); // screen angle
  const margin = 44;
  const cx = W / 2;
  const cy = H / 2;

  // Find where the ray from center hits the screen edge
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  let tx: number, ty: number;
  // Clip to rectangle
  const xEdge = cos > 0 ? W - margin : margin;
  const yEdge = sin < 0 ? margin : H - margin;
  const tx1 = cos !== 0 ? (xEdge - cx) / cos : Infinity;
  const ty1 = sin !== 0 ? (yEdge - cy) / sin : Infinity;
  const t = Math.min(Math.abs(tx1), Math.abs(ty1));
  tx = cx + cos * t;
  ty = cy + sin * t;
  tx = Math.max(margin, Math.min(W - margin, tx));
  ty = Math.max(margin, Math.min(H - margin, ty));

  // Arrow
  const arrowLen = 28;
  const arrowWidth = 10;

  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(angleRad);

  // Arrow body
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

  // Label "SUN" near the arrow
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
