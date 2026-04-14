/**
 * Sky detection and sun visibility analysis.
 *
 * Operates on a small downsampled frame (e.g. 80x60) for performance.
 * Returns a sky mask (boolean per column indicating sky boundary row),
 * and sun detection results.
 */

/** Per-column sky boundary: the row index where sky ends (0 = top). */
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

// Analysis resolution — small for speed.
const AW = 80;
const AH = 60;

// Reusable offscreen canvas (created once).
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

/**
 * Classify a single pixel as "sky" based on its RGB values and vertical position.
 *
 * Heuristics (intentionally loose to handle various sky conditions):
 *  - Blue sky:    high brightness, blue > red, moderate+ saturation
 *  - Overcast:    high brightness, low saturation (grey/white)
 *  - Sunset:      high brightness, warm colours but still bright
 *  - Night:       dark but uniform low-saturation
 *
 * A vertical bias makes upper pixels more likely to be classified as sky.
 */
function isSkyPixel(r: number, g: number, b: number, row: number, height: number): boolean {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b; // 0–255
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max; // 0–1

  // Vertical bias: pixels near the top get a boost; bottom pixels get penalised.
  // yNorm: 0 = top, 1 = bottom
  const yNorm = row / height;
  const verticalBoost = 1.0 - yNorm * 0.6; // 1.0 at top → 0.4 at bottom

  // Sky score — higher = more likely sky
  let score = 0;

  // Bright pixels are more likely sky
  if (lum > 120) score += 0.3;
  if (lum > 180) score += 0.2;

  // Blue-dominant pixels
  if (b > r && b > g * 0.85) score += 0.35;

  // Low saturation + bright = overcast sky
  if (sat < 0.2 && lum > 150) score += 0.3;

  // Moderate saturation + blue = clear sky
  if (sat > 0.15 && sat < 0.7 && b > r) score += 0.2;

  // Warm but bright = sunset sky
  if (lum > 160 && r > b && sat < 0.6) score += 0.15;

  // Dark uniform = night sky (low lum, low sat)
  if (lum < 60 && sat < 0.15) score += 0.25;

  // Very dark and very green/brown → definitely not sky (vegetation)
  if (lum < 100 && g > b && g > r && sat > 0.2) score -= 0.3;

  // Very saturated non-blue → not sky (foliage, buildings)
  if (sat > 0.4 && b < r) score -= 0.2;

  return score * verticalBoost > 0.45;
}

/**
 * Analyse a video frame for sky regions and sun visibility.
 *
 * @param video The HTMLVideoElement to capture a frame from.
 * @returns SkyAnalysis result, or null if the video isn't ready.
 */
export function analyseSky(video: HTMLVideoElement): SkyAnalysis | null {
  if (!video.videoWidth || !video.videoHeight) return null;

  const { ctx } = getAnalysisCanvas();
  if (!ctx) return null;

  // Draw downsampled frame
  ctx.drawImage(video, 0, 0, AW, AH);
  const imageData = ctx.getImageData(0, 0, AW, AH);
  const d = imageData.data; // RGBA flat array

  // ---- Sky mask: per-pixel boolean ----
  const skyMask = new Uint8Array(AW * AH);
  let skyPixelCount = 0;

  for (let y = 0; y < AH; y++) {
    for (let x = 0; x < AW; x++) {
      const i = (y * AW + x) * 4;
      if (isSkyPixel(d[i], d[i + 1], d[i + 2], y, AH)) {
        skyMask[y * AW + x] = 1;
        skyPixelCount++;
      }
    }
  }

  // ---- Skyline: per-column, find the lowest contiguous sky run from the top ----
  const skyline = new Array<number>(AW);
  for (let x = 0; x < AW; x++) {
    let boundary = 0;
    for (let y = 0; y < AH; y++) {
      if (skyMask[y * AW + x]) {
        boundary = y + 1;
      } else {
        // Allow small gaps (up to 3 rows) to handle noise
        let gapEnd = y;
        while (gapEnd < AH && gapEnd - y < 3 && !skyMask[gapEnd * AW + x]) {
          gapEnd++;
        }
        if (gapEnd < AH && skyMask[gapEnd * AW + x]) {
          y = gapEnd - 1; // continue past the gap
        } else {
          break;
        }
      }
    }
    skyline[x] = boundary;
  }

  // ---- Sun detection: find the brightest cluster of pixels ----
  // The sun appears as a cluster of very bright (near-white) pixels.
  const BRIGHT_THRESH = 230; // near-white
  let brightCount = 0;
  let bxSum = 0;
  let bySum = 0;
  let maxBright = 0;

  for (let y = 0; y < AH; y++) {
    for (let x = 0; x < AW; x++) {
      const i = (y * AW + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (lum > maxBright) maxBright = lum;

      if (lum > BRIGHT_THRESH && r > 200 && g > 180) {
        brightCount++;
        bxSum += x;
        bySum += y;
      }
    }
  }

  // Sun detected if there's a meaningful cluster of bright pixels (not too few, not too many)
  // and the cluster center is in a sky region.
  const totalPixels = AW * AH;
  const brightFrac = brightCount / totalPixels;
  let sunDetected = false;
  let sunCenter: { nx: number; ny: number } | null = null;
  let sunRadius = 0;

  if (brightCount >= 3 && brightFrac < 0.3) {
    const cx = bxSum / brightCount;
    const cy = bySum / brightCount;

    // Check if the bright cluster center is in the sky region
    const col = Math.round(cx);
    const inSky = col >= 0 && col < AW && cy < skyline[col];

    if (inSky) {
      sunDetected = true;
      sunCenter = { nx: cx / AW, ny: cy / AH };
      // Approximate radius from cluster size
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
