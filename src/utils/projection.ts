/**
 * Project a sun position (azimuth/elevation) onto camera pixel coordinates
 * using the device's camera axes and field of view.
 */

export interface ProjectionResult {
  /** Pixel X in the video rect coordinate space (relative to vidX). */
  x: number;
  /** Pixel Y in the video rect coordinate space (relative to vidY). */
  y: number;
  /** Whether the sun is in front of the camera (camZ > 0). */
  inFront: boolean;
  /** Camera-space X (right) for edge arrow direction. */
  camX: number;
  /** Camera-space Y (up) for edge arrow direction. */
  camY: number;
  /** Camera-space Z (depth). */
  camZ: number;
}

/**
 * Project the sun's azimuth/elevation onto pixel coordinates within the video rect.
 *
 * @param sunAz   Sun azimuth in degrees (CW from north)
 * @param sunEl   Sun elevation in degrees above horizon
 * @param axes    Camera axes Float64Array [rightE,N,U, upE,N,U, lookE,N,U]
 * @param fovH    Portrait horizontal FoV in degrees
 * @param fovV    Portrait vertical FoV in degrees
 * @param vidW    Displayed video width in pixels
 * @param vidH    Displayed video height in pixels
 */
export function projectSun(
  sunAz: number,
  sunEl: number,
  axes: Float64Array,
  fovH: number,
  fovV: number,
  vidW: number,
  vidH: number,
): ProjectionResult {
  const d2r = Math.PI / 180;
  const sunAzRad = sunAz * d2r;
  const sunElRad = sunEl * d2r;
  const cosEl = Math.cos(sunElRad);

  // Sun unit vector in ENU world space
  const sE = Math.sin(sunAzRad) * cosEl;
  const sN = Math.cos(sunAzRad) * cosEl;
  const sU = Math.sin(sunElRad);

  // Project onto camera axes
  const camX = sE * axes[0] + sN * axes[1] + sU * axes[2];
  const camY = sE * axes[3] + sN * axes[4] + sU * axes[5];
  const camZ = sE * axes[6] + sN * axes[7] + sU * axes[8];

  // FoV → focal length in normalised image coords
  const fH = 1 / Math.tan((fovH / 2) * d2r);
  const fV = 1 / Math.tan((fovV / 2) * d2r);

  const inFront = camZ > 0.001;

  let x: number, y: number;
  if (inFront) {
    x = vidW / 2 + (camX / camZ) * fH * (vidW / 2);
    y = vidH / 2 - (camY / camZ) * fV * (vidH / 2);
  } else {
    x = camX >= 0 ? vidW * 10 : -vidW * 10;
    y = camY >= 0 ? vidH * 10 : -vidH * 10;
  }

  return { x, y, inFront, camX, camY, camZ };
}
