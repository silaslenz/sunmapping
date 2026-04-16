import { useState, useEffect, useRef } from 'react';

export interface OrientationState {
  /** Compass heading in degrees, clockwise from north (0–360). Null if unavailable. */
  heading: number | null;
  /** Vertical tilt in degrees. 0 = camera pointing at horizon, +90 = pointing up, -90 = pointing down. */
  tilt: number | null;
  /** Roll in degrees. 0 = phone upright, positive = tilted right. */
  roll: number | null;
  /** True if we have an absolute (north-referenced) heading source. */
  absolute: boolean;
  /** Whether the browser has any orientation support at all. */
  supported: boolean;
  /**
   * Camera axes in ENU world-space, computed from the W3C rotation matrix.
   * 9 floats: [rightE, rightN, rightU, upE, upN, upU, lookE, lookN, lookU].
   * Null if orientation is unavailable.
   */
  cameraAxes: Float64Array | null;
}

/**
 * Build the W3C rotation matrix R = Rz(alpha) · Rx(beta) · Ry(gamma).
 *
 * Per the spec, R maps device-frame → world-frame (ENU).
 * Alpha is CCW from north (opposite of compass heading).
 *
 * Camera axes in world coords:
 *   right = R · (1,0,0) = R column 0
 *   up    = R · (0,1,0) = R column 1
 *   look  = R · (0,0,-1) = -(R column 2)
 */
function computeOrientation(alpha: number, beta: number, gamma: number) {
  const d2r = Math.PI / 180;
  const a = alpha * d2r;
  const b = beta  * d2r;
  const g = gamma * d2r;

  const sa = Math.sin(a), ca = Math.cos(a);
  const sb = Math.sin(b), cb = Math.cos(b);
  const sg = Math.sin(g), cg = Math.cos(g);

  // R = Rz(a) · Rx(b) · Ry(g), row-major:
  // Row 0: [ca*cg - sa*sb*sg,  -sa*cb,  ca*sg + sa*sb*cg]
  // Row 1: [sa*cg + ca*sb*sg,   ca*cb,  sa*sg - ca*sb*cg]
  // Row 2: [-cb*sg,              sb,      cb*cg          ]

  // Camera right (R column 0):
  const rightE = ca * cg - sa * sb * sg;
  const rightN = sa * cg + ca * sb * sg;
  const rightU = -cb * sg;

  // Camera up (R column 1):
  const upE = -sa * cb;
  const upN = ca * cb;
  const upU = sb;

  // Camera look = -(R column 2):
  const lookE = -(ca * sg + sa * sb * cg);
  const lookN = -(sa * sg - ca * sb * cg);
  const lookU = -(cb * cg);

  const axes = new Float64Array(9);
  axes[0] = rightE; axes[1] = rightN; axes[2] = rightU;
  axes[3] = upE;    axes[4] = upN;    axes[5] = upU;
  axes[6] = lookE;  axes[7] = lookN;  axes[8] = lookU;

  // Derive display-friendly heading / tilt from look vector
  // heading = compass bearing = CW from north = atan2(East, North)
  const heading = ((Math.atan2(lookE, lookN) * 180 / Math.PI) + 360) % 360;
  const tilt = Math.asin(Math.max(-1, Math.min(1, lookU))) * 180 / Math.PI;

  // Roll = angle of device-up projected into the image plane vs world-up projected
  const dotLookUp = lookU;
  const refE = -lookE * dotLookUp;
  const refN = -lookN * dotLookUp;
  const refU = 1 - lookU * dotLookUp;
  const dotDevUp = upE * lookE + upN * lookN + upU * lookU;
  const devE = upE - lookE * dotDevUp;
  const devN = upN - lookN * dotDevUp;
  const devU = upU - lookU * dotDevUp;
  const cx = refN * devU - refU * devN;
  const cy = refU * devE - refE * devU;
  const cz = refE * devN - refN * devE;
  const sinRoll = cx * lookE + cy * lookN + cz * lookU;
  const cosRoll = refE * devE + refN * devN + refU * devU;
  const roll = Math.atan2(sinRoll, cosRoll) * 180 / Math.PI;

  return { heading, tilt, roll, cameraAxes: axes };
}

export function useDeviceOrientation(): OrientationState {
  const [state, setState] = useState<OrientationState>({
    heading: null,
    tilt: null,
    roll: null,
    absolute: false,
    supported: false,
    cameraAxes: null,
  });

  const gotAbsolute = useRef(false);

  useEffect(() => {
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      return;
    }

    setState(s => ({ ...s, supported: true }));

    function handleAbsolute(e: DeviceOrientationEvent) {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      gotAbsolute.current = true;

      const o = computeOrientation(e.alpha, e.beta, e.gamma);
      setState({ ...o, absolute: true, supported: true });
    }

    function handleRelative(e: DeviceOrientationEvent) {
      if (gotAbsolute.current) return;
      if (e.beta == null || e.gamma == null) return;

      const o = computeOrientation(0, e.beta, e.gamma);
      setState({
        heading: null,
        tilt: o.tilt,
        roll: o.roll,
        cameraAxes: null,
        absolute: false,
        supported: true,
      });
    }

    const hasAbsoluteEvent = 'ondeviceorientationabsolute' in window;

    if (hasAbsoluteEvent) {
      window.addEventListener('deviceorientationabsolute', handleAbsolute as EventListener);
    }

    function handleStandard(e: Event) {
      const de = e as DeviceOrientationEvent;
      if (de.absolute) {
        handleAbsolute(de);
      } else {
        handleRelative(de);
      }
    }

    window.addEventListener('deviceorientation', handleStandard);

    return () => {
      if (hasAbsoluteEvent) {
        window.removeEventListener('deviceorientationabsolute', handleAbsolute as EventListener);
      }
      window.removeEventListener('deviceorientation', handleStandard);
    };
  }, []);

  return state;
}
