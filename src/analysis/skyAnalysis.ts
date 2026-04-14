/**
 * Sky detection and sun visibility analysis.
 *
 * Strategy: instead of absolute colour thresholds (which break at dusk/dawn/night),
 * we use a **gradient / edge-based** approach per column:
 *   1. Compute per-row luminance + colour variance (texture) for each column.
 *   2. Sky is the smooth, uniform region starting from the top of the frame.
 *   3. The skyline is where texture/gradient suddenly increases (= ground starts).
 *
 * Sun detection uses an adaptive threshold relative to the frame's own
 * brightness distribution.
 *
 * Operates on a small downsampled frame (80x60) for performance.
 */

export interface SkyAnalysis {
  /** For each column (0..width-1), the row where sky transitions to ground.
   *  0 means no sky in that column; height means entire column is sky. */
  skyline: number[];
  /** Width of the analysed frame. */
  width: number;
  /** Height of the analysed frame. */
  height: number;
  /** Fraction of the frame that is sky (0–1). */
  skyFraction: number;
  /** Whether a bright sun-like region was detected. */
  sunDetected: boolean;
  /** Center of the detected sun blob in normalised coords (0–1). Null if not detected. */
  sunCenter: { nx: number; ny: number } | null;
  /** Radius of the detected sun blob in normalised coords. */
  sunRadius: number;
}

const AW = 80;
const AH = 60;

let analysisCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let analysisCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function getAnalysisCanvas() {
  if (!analysisCanvas) {
    if (typeof OffscreenCanvas !== 'undefined') {
      analysisCanvas = new OffscreenCanvas(AW, AH);
    } else {
      analysisCanvas = document.createElement('canvas');
      analysisCanvas.width = AW;
      analysisCanvas.height = AH;
    }
    analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  }
  return { canvas: analysisCanvas, ctx: analysisCtx! };
}

/** Luminance of an RGB pixel. */
function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * For a single column, find the sky-ground boundary by scanning top-down
 * and detecting where the image becomes "textured" (high local gradient).
 *
 * The idea: sky (clear, overcast, sunset, twilight, night) is relatively
 * smooth with gentle gradients. Ground (trees, buildings, terrain) has
 * sharp edges and texture. We look for the row where the local vertical
 * gradient spikes.
 */
function findSkyBoundary(
  data: Uint8ClampedArray,
  x: number,
  w: number,
  h: number,
  avgLum: number,
): number {
  // Compute vertical gradient magnitude per row for this column.
  // gradient[y] = abs difference in luminance between row y and y+1,
  // averaged with the two neighbouring columns for noise reduction.
  const WINDOW = 3; // vertical smoothing window
  const gradients = new Float32Array(h);

  for (let y = 0; y < h - 1; y++) {
    let grad = 0;
    let count = 0;
    // Average over a few neighbouring columns for stability
    for (let dx = -1; dx <= 1; dx++) {
      const cx = x + dx;
      if (cx < 0 || cx >= w) continue;
      const i0 = (y * w + cx) * 4;
      const i1 = ((y + 1) * w + cx) * 4;
      const l0 = lum(data[i0], data[i0 + 1], data[i0 + 2]);
      const l1 = lum(data[i1], data[i1 + 1], data[i1 + 2]);
      grad += Math.abs(l1 - l0);
      count++;
    }
    gradients[y] = count > 0 ? grad / count : 0;
  }

  // Smooth the gradient signal with a small moving average
  const smooth = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let n = 0;
    for (let dy = -WINDOW; dy <= WINDOW; dy++) {
      const yy = y + dy;
      if (yy >= 0 && yy < h) {
        sum += gradients[yy];
        n++;
      }
    }
    smooth[y] = sum / n;
  }

  // Also compute a "colour variance" measure per row — sky is uniform,
  // ground is varied. Look at horizontal colour differences around this column.
  const colourVar = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let variance = 0;
    let count = 0;
    for (let dx = -2; dx <= 2; dx++) {
      const cx = x + dx;
      const nx = x + dx + 1;
      if (cx < 0 || nx >= w) continue;
      const i0 = (y * w + cx) * 4;
      const i1 = (y * w + nx) * 4;
      const dr = Math.abs(data[i0] - data[i1]);
      const dg = Math.abs(data[i0 + 1] - data[i1 + 1]);
      const db = Math.abs(data[i0 + 2] - data[i1 + 2]);
      variance += dr + dg + db;
      count++;
    }
    colourVar[y] = count > 0 ? variance / count : 0;
  }

  // Adaptive threshold: base it on the frame's average luminance.
  // Dimmer scenes need a lower gradient threshold.
  // Scale factor: at avgLum=200 (bright day), threshold ~12.
  // At avgLum=30 (dusk/night), threshold ~4.
  const gradThreshold = Math.max(3, 4 + (avgLum / 255) * 10);
  const colourThreshold = Math.max(4, 5 + (avgLum / 255) * 12);

  // Scan from top: find the first row where the combined texture signal
  // exceeds the threshold, sustained for a few rows.
  let boundary = 0;
  let consecutiveHigh = 0;
  const SUSTAIN = 2; // rows in a row needed to confirm boundary

  for (let y = 0; y < h; y++) {
    const isTextured =
      smooth[y] > gradThreshold || colourVar[y] > colourThreshold;

    if (isTextured) {
      consecutiveHigh++;
      if (consecutiveHigh >= SUSTAIN) {
        boundary = y - SUSTAIN + 1;
        break;
      }
    } else {
      consecutiveHigh = 0;
      boundary = y + 1;
    }
  }

  // If we scanned the whole column without finding texture, it's all sky
  if (consecutiveHigh < SUSTAIN && boundary >= h - 1) {
    boundary = h;
  }

  return boundary;
}

export function analyseSky(video: HTMLVideoElement): SkyAnalysis | null {
  if (!video.videoWidth || !video.videoHeight) return null;

  const { ctx } = getAnalysisCanvas();
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, AW, AH);
  const imageData = ctx.getImageData(0, 0, AW, AH);
  const d = imageData.data;

  // --- Compute frame average luminance for adaptive thresholds ---
  let lumSum = 0;
  for (let i = 0; i < d.length; i += 4) {
    lumSum += lum(d[i], d[i + 1], d[i + 2]);
  }
  const avgLum = lumSum / (AW * AH);

  // --- Per-column skyline detection ---
  const skyline = new Array<number>(AW);
  let skyPixelCount = 0;

  for (let x = 0; x < AW; x++) {
    skyline[x] = findSkyBoundary(d, x, AW, AH, avgLum);
    skyPixelCount += skyline[x];
  }

  // --- Smooth the skyline to reduce jitter ---
  // Median filter across columns (window = 5)
  const smoothed = new Array<number>(AW);
  for (let x = 0; x < AW; x++) {
    const vals: number[] = [];
    for (let dx = -2; dx <= 2; dx++) {
      const cx = x + dx;
      if (cx >= 0 && cx < AW) vals.push(skyline[cx]);
    }
    vals.sort((a, b) => a - b);
    smoothed[x] = vals[Math.floor(vals.length / 2)];
  }
  for (let x = 0; x < AW; x++) skyline[x] = smoothed[x];

  // --- Sun detection ---
  // Adaptive: find pixels significantly brighter than the frame average.
  // The sun (even at dusk) is the brightest thing in the sky.
  // Use a threshold relative to the max luminance in the frame.
  let maxLum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = lum(d[i], d[i + 1], d[i + 2]);
    if (l > maxLum) maxLum = l;
  }

  // Sun threshold: must be close to the brightest pixels AND substantially
  // brighter than the average. At evening the overall frame is dim but the
  // sun (if visible) still saturates or nearly saturates.
  const sunThresh = Math.max(
    maxLum * 0.85,          // within 15% of the brightest pixel
    avgLum + (maxLum - avgLum) * 0.7, // well above average
    avgLum + 30,            // absolute minimum gap above average
  );

  let brightCount = 0;
  let bxSum = 0;
  let bySum = 0;

  for (let y = 0; y < AH; y++) {
    for (let x = 0; x < AW; x++) {
      const i = (y * AW + x) * 4;
      const l = lum(d[i], d[i + 1], d[i + 2]);
      if (l >= sunThresh) {
        brightCount++;
        bxSum += x;
        bySum += y;
      }
    }
  }

  const totalPixels = AW * AH;
  const brightFrac = brightCount / totalPixels;
  let sunDetected = false;
  let sunCenter: { nx: number; ny: number } | null = null;
  let sunRadius = 0;

  // Require:
  //  - at least 2 bright pixels (not noise)
  //  - less than 25% of frame (not a uniformly bright scene)
  //  - the bright region must have meaningful contrast above average
  //    (maxLum - avgLum > 20 prevents flat, uniformly lit scenes triggering)
  if (brightCount >= 2 && brightFrac < 0.25 && (maxLum - avgLum) > 20) {
    const cx = bxSum / brightCount;
    const cy = bySum / brightCount;

    // Check if the bright cluster center is in the sky region
    const col = Math.round(cx);
    const inSky = col >= 0 && col < AW && cy < skyline[col];

    if (inSky) {
      sunDetected = true;
      sunCenter = { nx: cx / AW, ny: cy / AH };
      sunRadius = Math.sqrt(brightCount / Math.PI) / Math.max(AW, AH);
    }
  }

  return {
    skyline,
    width: AW,
    height: AH,
    skyFraction: skyPixelCount / totalPixels,
    sunDetected,
    sunCenter,
    sunRadius,
  };
}
