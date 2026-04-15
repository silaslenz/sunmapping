import { useEffect, useRef } from 'react';
import type { OrientationState } from '../hooks/useDeviceOrientation';
import type { SunPosition } from '../hooks/useSunPosition';
import { analyseSky, isPointInSky } from '../analysis/skyAnalysis';
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

      // --- Compute the video rect within the screen (object-fit: contain) ---
      // With contain the full video is visible, letterboxed with black bars.
      const video = videoRef.current;
      const videoW = video?.videoWidth || 640;
      const videoH = video?.videoHeight || 480;
      const containScale = Math.min(W / videoW, H / videoH);
      const vidW = videoW * containScale;  // displayed video width
      const vidH = videoH * containScale;  // displayed video height
      const vidX = (W - vidW) / 2;         // left offset of video rect
      const vidY = (H - vidH) / 2;         // top offset of video rect

      // --- Sky analysis (throttled) ---
      frameCount.current++;
      if (video && frameCount.current % ANALYSIS_INTERVAL === 0) {
        lastAnalysis.current = analyseSky(video);
      }

      const sky = lastAnalysis.current;

      // --- Draw skyline (mapped to video rect, not full canvas) ---
      if (sky) {
        drawSkyline(ctx, sky, vidW, vidH, vidX, vidY);
      }

      // --- Draw detected sun blob ---
      if (sky?.sunDetected && sky.sunCenter) {
        drawDetectedSun(ctx, vidX + sky.sunCenter.nx * vidW, vidY + sky.sunCenter.ny * vidH);
      }

      // --- Computed sun position overlay ---
      const hasData =
        sun != null &&
        orientation.absolute &&
        orientation.heading != null &&
        orientation.tilt != null;

      if (!hasData) {
        if (sky && frameCount.current % ANALYSIS_INTERVAL === 0) {
          sky.sunInSky = null;
          onSkyAnalysis?.(sky);
        }
        return;
      }

      const heading = orientation.heading!;
      const tilt = orientation.tilt!;
      const roll = orientation.roll ?? 0;
      const sunAz = sun!.azimuth;
      const sunEl = sun!.altitude;

      // With object-fit: contain, the full video is visible.
      // fovH is the *landscape* (sensor) horizontal FoV from the phone spec.
      // In portrait the sensor is rotated 90°, so:
      //   portrait vertical FoV = fovH (the sensor's wide dimension)
      //   portrait horizontal FoV = derived from aspect ratio
      // Video dimensions are already in portrait orientation (videoW < videoH for 3:4).
      const portraitFovV = fovH;
      const halfVRad = (portraitFovV / 2) * Math.PI / 180;
      const portraitFovH = 2 * Math.atan(Math.tan(halfVRad) * (videoW / videoH)) * 180 / Math.PI;

      const dAz = angleDiff(sunAz, heading);
      const dEl = sunEl - tilt;

      const rollRad = (roll * Math.PI) / 180;
      const dAzRot = dAz * Math.cos(rollRad) + dEl * Math.sin(rollRad);
      const dElRot = -dAz * Math.sin(rollRad) + dEl * Math.cos(rollRad);

      // Project onto the video rect (not the full canvas)
      const px = vidX + vidW / 2 + (dAzRot / (portraitFovH / 2)) * (vidW / 2);
      const py = vidY + vidH / 2 - (dElRot / (portraitFovV / 2)) * (vidH / 2);

      // --- Determine if the computed sun is in the sky region ---
      if (sky && frameCount.current % ANALYSIS_INTERVAL === 0) {
        const inVideo = px >= vidX && px <= vidX + vidW && py >= vidY && py <= vidY + vidH;
        // isPointInSky expects coords relative to the video rect
        sky.sunInSky = inVideo
          ? isPointInSky(px - vidX, py - vidY, vidW, vidH, sky)
          : null;
        onSkyAnalysis?.(sky);
      }

      const inFrame =
        px >= -40 && px <= W + 40 && py >= -40 && py <= H + 40;

      if (inFrame) {
        drawSunDot(ctx, px, py);
      } else {
        drawEdgeArrow(ctx, W, H, dAzRot, dElRot, portraitFovH, portraitFovV);
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

/** Draw the skyline boundary and the full sky mask. */
function drawSkyline(
  ctx: CanvasRenderingContext2D,
  sky: SkyAnalysis,
  vidW: number,
  vidH: number,
  offsetX: number,
  offsetY: number,
) {
  const { skyline, skyMask, width, height } = sky;
  if (skyline.length === 0) return;

  const xScale = vidW / width;
  const yScale = vidH / height;

  // --- Tint above-skyline sky (subtle blue) ---
  ctx.beginPath();
  ctx.moveTo(offsetX, offsetY + skyline[0] * yScale);
  for (let x = 1; x < width; x++) {
    ctx.lineTo(offsetX + x * xScale, offsetY + skyline[x] * yScale);
  }
  ctx.lineTo(offsetX + vidW, offsetY);
  ctx.lineTo(offsetX, offsetY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(100, 180, 255, 0.08)';
  ctx.fill();

  // --- Tint continuing-sky pixels below the skyline (green-ish) ---
  // Draw each sky-mask pixel below the skyline as a small rect
  ctx.fillStyle = 'rgba(100, 255, 180, 0.3)';
  for (let ay = 0; ay < height; ay++) {
    for (let ax = 0; ax < width; ax++) {
      if (skyMask[ay * width + ax] === 1 && ay >= skyline[ax]) {
        ctx.fillRect(
          offsetX + ax * xScale,
          offsetY + ay * yScale,
          Math.ceil(xScale),
          Math.ceil(yScale),
        );
      }
    }
  }

  // --- Stroke the skyline ---
  ctx.beginPath();
  ctx.moveTo(offsetX, offsetY + skyline[0] * yScale);
  for (let x = 1; x < width; x++) {
    ctx.lineTo(offsetX + x * xScale, offsetY + skyline[x] * yScale);
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
