/**
 * Sky detection and sun visibility analysis.
 *
 * Two-pass approach:
 *   Pass 1 — Gradient/edge scan from top to find the main skyline boundary.
 *   Pass 2 — Characterise the sky's colour profile from the region above the
 *            skyline, then scan the entire frame for pixels that match,
 *            producing a full sky mask that captures "continuing sky" visible
 *            through gaps (under overhangs, between buildings, through trees).
 *
 * Operates on a small downsampled frame (80×60) for performance.
 */

export interface SkyAnalysis {
  /** For each column, the row where the main sky boundary is (top-down). */
  skyline: number[];
  /** Full sky mask at analysis resolution — 1 = sky, 0 = not sky. */
  skyMask: Uint8Array;
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
  /** Whether the computed sun position is in the sky region. Set externally by the overlay. */
  sunInSky: boolean | null;
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

function lumRGB(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ---------------------------------------------------------------
// Pass 1 — gradient-based skyline
// ---------------------------------------------------------------

function findSkyBoundary(
  data: Uint8ClampedArray,
  x: number,
  w: number,
  h: number,
  avgLum: number,
): number {
  const WINDOW = 3;
  const gradients = new Float32Array(h);

  for (let y = 0; y < h - 1; y++) {
    let grad = 0;
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) {
      const cx = x + dx;
      if (cx < 0 || cx >= w) continue;
      const i0 = (y * w + cx) * 4;
      const i1 = ((y + 1) * w + cx) * 4;
      const l0 = lumRGB(data[i0], data[i0 + 1], data[i0 + 2]);
      const l1 = lumRGB(data[i1], data[i1 + 1], data[i1 + 2]);
      grad += Math.abs(l1 - l0);
      count++;
    }
    gradients[y] = count > 0 ? grad / count : 0;
  }

  const smooth = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let n = 0;
    for (let dy = -WINDOW; dy <= WINDOW; dy++) {
      const yy = y + dy;
      if (yy >= 0 && yy < h) { sum += gradients[yy]; n++; }
    }
    smooth[y] = sum / n;
  }

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
      variance += Math.abs(data[i0] - data[i1])
                + Math.abs(data[i0 + 1] - data[i1 + 1])
                + Math.abs(data[i0 + 2] - data[i1 + 2]);
      count++;
    }
    colourVar[y] = count > 0 ? variance / count : 0;
  }

  const gradThreshold = Math.max(4, 5 + (avgLum / 255) * 14);
  const colourThreshold = Math.max(5, 6 + (avgLum / 255) * 16);

  let boundary = 0;
  let consecutiveHigh = 0;
  const SUSTAIN = 3;

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

  if (consecutiveHigh < SUSTAIN && boundary >= h - 1) {
    boundary = h;
  }

  return boundary;
}

// ---------------------------------------------------------------
// Pass 2 — colour-profile sky mask
// ---------------------------------------------------------------

interface SkyProfile {
  meanR: number; meanG: number; meanB: number; meanL: number;
  stdR: number; stdG: number; stdB: number; stdL: number;
}

/** Compute the colour profile of the sky region above the skyline. */
function computeSkyProfile(
  data: Uint8ClampedArray,
  skyline: number[],
  w: number,
): SkyProfile | null {
  let sumR = 0, sumG = 0, sumB = 0, sumL = 0;
  let sumR2 = 0, sumG2 = 0, sumB2 = 0, sumL2 = 0;
  let count = 0;

  for (let x = 0; x < w; x++) {
    const bound = skyline[x];
    for (let y = 0; y < bound; y++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = lumRGB(r, g, b);
      sumR += r; sumG += g; sumB += b; sumL += l;
      sumR2 += r * r; sumG2 += g * g; sumB2 += b * b; sumL2 += l * l;
      count++;
    }
  }

  if (count < 20) return null; // not enough sky pixels to profile

  const n = count;
  const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n, meanL = sumL / n;
  const stdR = Math.sqrt(Math.max(0, sumR2 / n - meanR * meanR));
  const stdG = Math.sqrt(Math.max(0, sumG2 / n - meanG * meanG));
  const stdB = Math.sqrt(Math.max(0, sumB2 / n - meanB * meanB));
  const stdL = Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL));

  return { meanR, meanG, meanB, meanL, stdR, stdG, stdB, stdL };
}

/** Check if a pixel matches the sky colour profile. */
function matchesSkyProfile(
  r: number, g: number, b: number,
  profile: SkyProfile,
  tolerance: number, // number of std deviations
): boolean {
  // Add a minimum std of 12 so very uniform skies don't reject everything
  const tR = Math.max(12, profile.stdR) * tolerance;
  const tG = Math.max(12, profile.stdG) * tolerance;
  const tB = Math.max(12, profile.stdB) * tolerance;
  const tL = Math.max(12, profile.stdL) * tolerance;
  const l = lumRGB(r, g, b);

  return Math.abs(r - profile.meanR) < tR
      && Math.abs(g - profile.meanG) < tG
      && Math.abs(b - profile.meanB) < tB
      && Math.abs(l - profile.meanL) < tL;
}

/** Compute local texture (horizontal gradient magnitude) for a pixel. */
function localTexture(data: Uint8ClampedArray, x: number, y: number, w: number, h: number): number {
  let sum = 0;
  let count = 0;
  for (let dx = -1; dx <= 1; dx++) {
    const cx = x + dx;
    const nx = cx + 1;
    if (cx < 0 || nx >= w) continue;
    const i0 = (y * w + cx) * 4;
    const i1 = (y * w + nx) * 4;
    sum += Math.abs(data[i0] - data[i1])
         + Math.abs(data[i0 + 1] - data[i1 + 1])
         + Math.abs(data[i0 + 2] - data[i1 + 2]);
    count++;
  }
  // Also vertical gradient
  if (y > 0 && y < h - 1) {
    const iUp = ((y - 1) * w + x) * 4;
    const iDn = ((y + 1) * w + x) * 4;
    sum += Math.abs(data[iUp] - data[iDn])
         + Math.abs(data[iUp + 1] - data[iDn + 1])
         + Math.abs(data[iUp + 2] - data[iDn + 2]);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

// ---------------------------------------------------------------
// Public API
// ---------------------------------------------------------------

/**
 * Check whether a screen-space pixel coordinate falls within the sky region.
 * Uses the full sky mask, so it detects continuing sky below the main skyline.
 */
export function isPointInSky(
  px: number,
  py: number,
  screenW: number,
  screenH: number,
  sky: SkyAnalysis,
): boolean {
  const ax = Math.round((px / screenW) * (sky.width - 1));
  const ay = Math.round((py / screenH) * (sky.height - 1));
  if (ax < 0 || ax >= sky.width || ay < 0 || ay >= sky.height) return false;
  return sky.skyMask[ay * sky.width + ax] === 1;
}

export function analyseSky(video: HTMLVideoElement): SkyAnalysis | null {
  if (!video.videoWidth || !video.videoHeight) return null;

  const { ctx } = getAnalysisCanvas();
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, AW, AH);
  const imageData = ctx.getImageData(0, 0, AW, AH);
  const d = imageData.data;

  // --- Frame average luminance ---
  let lumSum = 0;
  for (let i = 0; i < d.length; i += 4) {
    lumSum += lumRGB(d[i], d[i + 1], d[i + 2]);
  }
  const avgLum = lumSum / (AW * AH);

  // --- Pass 1: per-column skyline ---
  const skyline = new Array<number>(AW);
  for (let x = 0; x < AW; x++) {
    skyline[x] = findSkyBoundary(d, x, AW, AH, avgLum);
  }

  // Median-filter the skyline (window = 5) to smooth jitter
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

  // --- Pass 2: full sky mask ---
  const skyMask = new Uint8Array(AW * AH);

  // Fill everything above the skyline
  for (let x = 0; x < AW; x++) {
    for (let y = 0; y < skyline[x]; y++) {
      skyMask[y * AW + x] = 1;
    }
  }

  // Compute sky colour profile from the known sky region
  const profile = computeSkyProfile(d, skyline, AW);

  if (profile) {
    // Compute average texture in the sky region for comparison
    let skyTexSum = 0;
    let skyTexCount = 0;
    for (let x = 0; x < AW; x++) {
      for (let y = 0; y < skyline[x]; y++) {
        skyTexSum += localTexture(d, x, y, AW, AH);
        skyTexCount++;
      }
    }
    const avgSkyTexture = skyTexCount > 0 ? skyTexSum / skyTexCount : 0;
    // Below-skyline pixels must have low texture to qualify as sky
    const textureLimit = Math.max(avgSkyTexture * 1.8, 12);

    // Scan below skyline for pixels matching the sky profile (tight tolerance)
    for (let x = 0; x < AW; x++) {
      for (let y = skyline[x]; y < AH; y++) {
        const i = (y * AW + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];

        if (matchesSkyProfile(r, g, b, profile, 1.8)
            && localTexture(d, x, y, AW, AH) < textureLimit) {
          skyMask[y * AW + x] = 1;
        }
      }
    }
  }

  // Count total sky pixels
  let skyPixelCount = 0;
  for (let i = 0; i < skyMask.length; i++) {
    if (skyMask[i]) skyPixelCount++;
  }

  // --- Sun detection ---
  let maxLum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = lumRGB(d[i], d[i + 1], d[i + 2]);
    if (l > maxLum) maxLum = l;
  }

  const sunThresh = Math.max(
    maxLum * 0.85,
    avgLum + (maxLum - avgLum) * 0.7,
    avgLum + 30,
  );

  let brightCount = 0;
  let bxSum = 0;
  let bySum = 0;

  for (let y = 0; y < AH; y++) {
    for (let x = 0; x < AW; x++) {
      const i = (y * AW + x) * 4;
      const l = lumRGB(d[i], d[i + 1], d[i + 2]);
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

  if (brightCount >= 2 && brightFrac < 0.25 && (maxLum - avgLum) > 20) {
    const cx = bxSum / brightCount;
    const cy = bySum / brightCount;
    // Check sky mask instead of just skyline
    const mi = Math.round(cy) * AW + Math.round(cx);
    if (mi >= 0 && mi < skyMask.length && skyMask[mi]) {
      sunDetected = true;
      sunCenter = { nx: cx / AW, ny: cy / AH };
      sunRadius = Math.sqrt(brightCount / Math.PI) / Math.max(AW, AH);
    }
  }

  return {
    skyline,
    skyMask,
    width: AW,
    height: AH,
    skyFraction: skyPixelCount / totalPixels,
    sunDetected,
    sunCenter,
    sunRadius,
    sunInSky: null,
  };
}
