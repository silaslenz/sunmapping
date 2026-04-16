/**
 * Orientation utilities for computing camera axes from compass headings.
 */

/**
 * Compute camera axes for a given compass heading with the phone held
 * upright in portrait mode, looking straight at the horizon.
 *
 * In W3C DeviceOrientation terms this corresponds to:
 *   alpha = heading (converted to CCW), beta = 90°, gamma = 0°
 *
 * @param heading Compass heading in degrees, clockwise from north (0–360)
 * @returns Camera axes Float64Array [rightE,N,U, upE,N,U, lookE,N,U]
 */
export function headingToCameraAxes(heading: number): Float64Array {
  const d2r = Math.PI / 180;

  // W3C alpha is CCW from north; compass heading is CW from north
  const a = -(heading * d2r);
  const b = 90 * d2r; // Phone upright — looking at horizon
  const g = 0;

  const sa = Math.sin(a), ca = Math.cos(a);
  const sb = Math.sin(b), cb = Math.cos(b);
  const sg = Math.sin(g), cg = Math.cos(g);

  // R = Rz(a) · Rx(b) · Ry(g)
  // Camera right (R column 0)
  const rightE = ca * cg - sa * sb * sg;
  const rightN = sa * cg + ca * sb * sg;
  const rightU = -cb * sg;

  // Camera up (R column 1)
  const upE = -sa * cb;
  const upN = ca * cb;
  const upU = sb;

  // Camera look = -(R column 2)
  const lookE = -(ca * sg + sa * sb * cg);
  const lookN = -(sa * sg - ca * sb * cg);
  const lookU = -(cb * cg);

  const axes = new Float64Array(9);
  axes[0] = rightE;
  axes[1] = rightN;
  axes[2] = rightU;
  axes[3] = upE;
  axes[4] = upN;
  axes[5] = upU;
  axes[6] = lookE;
  axes[7] = lookN;
  axes[8] = lookU;

  return axes;
}

/**
 * Convert a heading to a compass direction name.
 */
export function headingToDirection(heading: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((heading % 360 + 360) % 360) / 45) % 8;
  return dirs[idx];
}