import { useEffect, useRef } from 'react';
import type { OrientationState } from '../hooks/useDeviceOrientation';
import type { SunPosition } from '../hooks/useSunPosition';
import { analyseSky, isPointInSky } from '../analysis/skyAnalysis';
import type { SkyAnalysis } from '../analysis/skyAnalysis';

interface Props {
  stream: MediaStream | null;
  orientation: OrientationState;
  sun: SunPosition | null;
  fovH: number; // landscape (sensor) horizontal FoV in degrees
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  onSkyAnalysis?: (analysis: SkyAnalysis | null) => void;
}

const ANALYSIS_INTERVAL = 6;

export function SunOverlay({ stream, orientation, sun, fovH, videoRef, overlayRef, onSkyAnalysis }: Props) {
  const rafRef = useRef<number>(0);
  const frameCount = useRef(0);
  const skyRef = useRef<SkyAnalysis | null>(null);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    } else {
      video.srcObject = null;
    }
  }, [stream, videoRef]);

  // Draw loop
  useEffect(() => {
    function draw() {
      rafRef.current = requestAnimationFrame(draw);

      const canvas = overlayRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }

      ctx.clearRect(0, 0, W, H);

      // Compute the video rect within the screen (object-fit: contain letterboxing)
      const video = videoRef.current;
      const videoW = video?.videoWidth || 640;
      const videoH = video?.videoHeight || 480;
      const containScale = Math.min(W / videoW, H / videoH);
      const vidW = videoW * containScale;
      const vidH = videoH * containScale;
      const vidX = (W - vidW) / 2;
      const vidY = (H - vidH) / 2;

      // Sky analysis (throttled)
      frameCount.current++;
      if (video && frameCount.current % ANALYSIS_INTERVAL === 0) {
        skyRef.current = analyseSky(video);
      }

      const sky = skyRef.current;
      if (sky) drawSkyline(ctx, sky, vidW, vidH, vidX, vidY);

      // fovH is the landscape (sensor) horizontal FoV. In portrait the sensor
      // rotates 90°, so fovH becomes the portrait vertical FoV.
      const portraitFovV = fovH;
      const halfVRad = (portraitFovV / 2) * Math.PI / 180;
      const portraitFovH = 2 * Math.atan(Math.tan(halfVRad) * (videoW / videoH)) * 180 / Math.PI;

      const hasData =
        sun != null &&
        orientation.absolute &&
        orientation.cameraAxes != null;

      if (!hasData) {
        if (sky && frameCount.current % ANALYSIS_INTERVAL === 0) {
          sky.sunInSky = null;
          onSkyAnalysis?.(sky);
        }
        return;
      }

      const axes = orientation.cameraAxes!;

      // Sun unit vector in ENU world space
      const sunAzRad = sun!.azimuth * Math.PI / 180;
      const sunElRad = sun!.altitude * Math.PI / 180;
      const cosEl = Math.cos(sunElRad);
      const sE = Math.sin(sunAzRad) * cosEl;  // East
      const sN = Math.cos(sunAzRad) * cosEl;  // North
      const sU = Math.sin(sunElRad);           // Up

      // Project sun onto camera axes (right, up, look) stored in cameraAxes
      const camX = sE * axes[0] + sN * axes[1] + sU * axes[2];  // right
      const camY = sE * axes[3] + sN * axes[4] + sU * axes[5];  // up
      const camZ = sE * axes[6] + sN * axes[7] + sU * axes[8];  // look (depth)

      // FoV → focal length in normalised image coords
      const fH = 1 / Math.tan((portraitFovH / 2) * Math.PI / 180);
      const fV = 1 / Math.tan((portraitFovV / 2) * Math.PI / 180);

      // Perspective projection
      let px: number, py: number;
      if (camZ > 0.001) {
        px = vidX + vidW / 2 + (camX / camZ) * fH * (vidW / 2);
        py = vidY + vidH / 2 - (camY / camZ) * fV * (vidH / 2);
      } else {
        // Sun is behind camera — push far offscreen for edge arrow
        px = camX >= 0 ? W * 10 : -W * 10;
        py = camY >= 0 ? H * 10 : -H * 10;
      }

      // Angular offset for edge arrow direction
      const dAzRot = camZ > 0.001 ? (camX / camZ) * (180 / Math.PI) : camX * 1000;
      const dElRot = camZ > 0.001 ? (camY / camZ) * (180 / Math.PI) : camY * 1000;

      if (sky && frameCount.current % ANALYSIS_INTERVAL === 0) {
        const inVideo = px >= vidX && px <= vidX + vidW && py >= vidY && py <= vidY + vidH;
        sky.sunInSky = inVideo
          ? isPointInSky(px - vidX, py - vidY, vidW, vidH, sky)
          : null;
        onSkyAnalysis?.(sky);
      }

      const inFrame = px >= -40 && px <= W + 40 && py >= -40 && py <= H + 40;
      if (inFrame) {
        drawSunDot(ctx, px, py);
      } else {
        drawEdgeArrow(ctx, W, H, dAzRot, dElRot, portraitFovH, portraitFovV);
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [orientation, sun, fovH, onSkyAnalysis]);

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

  // Tint above-skyline sky (subtle blue)
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

  // Tint continuing-sky pixels below skyline (green), batched per column
  ctx.fillStyle = 'rgba(100, 255, 180, 0.3)';
  const colW = Math.ceil(xScale);
  const colH = Math.ceil(yScale);
  for (let ax = 0; ax < width; ax++) {
    const startY = skyline[ax];
    for (let ay = startY; ay < height; ay++) {
      if (skyMask[ay * width + ax] === 1) {
        ctx.fillRect(offsetX + ax * xScale, offsetY + ay * yScale, colW, colH);
      }
    }
  }

  // Stroke the skyline
  ctx.beginPath();
  ctx.moveTo(offsetX, offsetY + skyline[0] * yScale);
  for (let x = 1; x < width; x++) {
    ctx.lineTo(offsetX + x * xScale, offsetY + skyline[x] * yScale);
  }
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawSunDot(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const r = 22;

  const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.5);
  glow.addColorStop(0, 'rgba(255, 220, 50, 0.55)');
  glow.addColorStop(1, 'rgba(255, 180, 0, 0)');
  ctx.beginPath();
  ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  const core = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  core.addColorStop(0, '#fff9c4');
  core.addColorStop(0.5, '#ffe600');
  core.addColorStop(1, '#ff9800');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = core;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const armLen = r + 12;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
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
  const tx = Math.max(margin, Math.min(W - margin, cx + cos * t));
  const ty = Math.max(margin, Math.min(H - margin, cy + sin * t));

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
