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
}

/**
 * Compute camera-space heading/tilt/roll from raw DeviceOrientation angles
 * using a full ZXY rotation matrix, avoiding gimbal-coupling artefacts.
 *
 * Browser convention (ZXY intrinsic Euler, world→device):
 *   alpha: yaw   around world-Z, CCW from north, 0–360°
 *   beta:  pitch around device-X, -180–180°  (90 = upright portrait)
 *   gamma: roll  around device-Y, -90–90°    (0 = no roll)
 *
 * World frame: X = East, Y = North, Z = Up  (ENU)
 * Device frame in portrait-upright: X = right, Y = up, Z = out of screen (back camera = -Z)
 *
 * We build R (world→device), then find the camera's look direction (-Z device axis)
 * and the camera's up direction (+Y device axis) in world space by using R^T (=R^-1
 * since R is orthogonal).  From those we derive heading, tilt and roll directly.
 */
function toCamera(alpha: number, beta: number, gamma: number) {
  const toRad = Math.PI / 180;
  const a = alpha * toRad;   // yaw
  const b = beta  * toRad;   // pitch
  const g = gamma * toRad;   // roll

  // ZXY rotation matrix (world → device), standard browser definition.
  // R = Rz(a) · Rx(b) · Ry(g)
  const sa = Math.sin(a), ca = Math.cos(a);
  const sb = Math.sin(b), cb = Math.cos(b);
  const sg = Math.sin(g), cg = Math.cos(g);

  // Row-major R[row][col]
  const R = [
    [ ca * cg - sa * sb * sg,  -sa * cb,  ca * sg + sa * sb * cg ],
    [ sa * cg + ca * sb * sg,   ca * cb,  sa * sg - ca * sb * cg ],
    [ -cb * sg,                 sb,        cb * cg                ],
  ];

  // Camera look direction is device -Z axis expressed in world coords = R^T col 2 negated
  // = -R[*][2] transposed  →  -(R[0][2], R[1][2], R[2][2])
  // But R^T row i = R col i, so the device -Z world direction is:
  const lookX = -R[0][2];  // East component of look
  const lookY = -R[1][2];  // North component
  const lookZ = -R[2][2];  // Up component

  // Heading = compass bearing of the horizontal projection of the look vector
  // atan2(East, North)  →  clockwise from north
  const heading = ((Math.atan2(lookX, lookY) * 180 / Math.PI) + 360) % 360;

  // Tilt = elevation angle of the look vector above the horizon
  const tilt = Math.asin(Math.max(-1, Math.min(1, lookZ))) * 180 / Math.PI;

  // Roll: project device +Y (up) into world, then measure its rotation around
  // the look vector relative to "world up projected onto the image plane".
  // Device +Y world direction = R^T col 1 = (R[0][1], R[1][1], R[2][1])
  const upX = R[0][1];
  const upY = R[1][1];
  const upZ = R[2][1];

  // Project world-up (0,0,1) onto the plane perpendicular to look, and compare to
  // projected device-up to get roll.
  // Component of world-up along look:
  const dot = lookZ; // (0,0,1)·look = lookZ
  const refX = -lookX * dot;
  const refY = -lookY * dot;
  const refZ = 1 - lookZ * dot;  // world-up minus its look-component

  // Component of device-up along look:
  const dotUp = upX * lookX + upY * lookY + upZ * lookZ;
  const devX = upX - lookX * dotUp;
  const devY = upY - lookY * dotUp;
  const devZ = upZ - lookZ * dotUp;

  // Cross product ref × dev gives the sin of the angle around look
  const crossX = refY * devZ - refZ * devY;
  const crossY = refZ * devX - refX * devZ;
  const crossZ = refX * devY - refY * devX;
  const sinRoll = crossX * lookX + crossY * lookY + crossZ * lookZ;
  const cosRoll = refX * devX + refY * devY + refZ * devZ;
  const roll = Math.atan2(sinRoll, cosRoll) * 180 / Math.PI;

  return { heading, tilt, roll };
}

export function useDeviceOrientation(): OrientationState {
  const [state, setState] = useState<OrientationState>({
    heading: null,
    tilt: null,
    roll: null,
    absolute: false,
    supported: false,
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

      const { heading, tilt, roll } = toCamera(e.alpha, e.beta, e.gamma);
      setState({ heading, tilt, roll, absolute: true, supported: true });
    }

    function handleRelative(e: DeviceOrientationEvent) {
      if (gotAbsolute.current) return;
      if (e.beta == null || e.gamma == null) return;

      const { tilt, roll } = toCamera(0, e.beta, e.gamma);
      setState({
        heading: null,
        tilt,
        roll,
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
