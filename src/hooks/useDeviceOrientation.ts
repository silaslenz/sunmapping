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
 * Compute camera-space heading/tilt/roll from raw device orientation angles
 * using a proper rotation matrix.
 *
 * Raw Euler angles (alpha, beta, gamma) suffer from gimbal-coupling: when the
 * phone is tilted, panning left/right changes alpha by less than the true
 * rotation. We build the full ZXY rotation matrix and extract the direction
 * the camera is pointing to get accurate heading and tilt.
 *
 * We lock the app to portrait, so the camera looks out the back of the phone
 * along the local -Z axis (in the device coordinate frame where Z points out
 * of the screen).
 */
function toCamera(alpha: number, beta: number, gamma: number) {
  const deg2rad = Math.PI / 180;
  const a = alpha * deg2rad;
  const b = beta * deg2rad;
  const g = gamma * deg2rad;

  const cosA = Math.cos(a), sinA = Math.sin(a);
  const cosB = Math.cos(b), sinB = Math.sin(b);
  const cosG = Math.cos(g), sinG = Math.sin(g);

  // Device orientation rotation matrix (ZXY convention, as per W3C spec).
  // This transforms from device coords to world (ENU) coords.
  // We want to know where the camera's -Z axis points in world coords.
  // Camera looks along device -Z → world direction = R * [0, 0, -1]
  //   dx = -(R[0][2]),  dy = -(R[1][2]),  dz = -(R[2][2])
  //
  // R[0][2] = cosA * sinG + sinA * sinB * cosG
  // R[1][2] = sinA * sinG - cosA * sinB * cosG
  // R[2][2] = cosB * cosG

  const dx = -(cosA * sinG + sinA * sinB * cosG);
  const dy = -(sinA * sinG - cosA * sinB * cosG);
  const dz = -(cosB * cosG);

  // Heading: azimuth of the look direction projected onto the horizontal plane.
  // In ENU, X = East, Y = North. atan2(east, north) gives compass bearing.
  const heading = (Math.atan2(dx, dy) / deg2rad + 360) % 360;

  // Tilt: elevation angle above the horizontal plane.
  // Positive = looking up, negative = looking down.
  const horizLen = Math.sqrt(dx * dx + dy * dy);
  const tilt = Math.atan2(-dz, horizLen) / deg2rad;

  // Roll: rotation around the camera's look axis.
  // We need the camera's "up" direction in world coords.
  // Camera up = device +Y → world direction = R * [0, 1, 0]
  // R[0][1] = cosA * sinB * sinG - sinA * cosG
  // R[1][1] = sinA * sinB * sinG + cosA * cosG
  // R[2][1] = cosB * sinG
  const upX = cosA * sinB * sinG - sinA * cosG;
  const upY = sinA * sinB * sinG + cosA * cosG;
  const upZ = cosB * sinG;

  // Project the camera-up vector onto the plane perpendicular to the look direction,
  // then measure its angle from "world up projected into that plane".
  // For simplicity, use the component of camera-up that is vertical vs horizontal
  // relative to the look direction.
  // World up in ENU = [0, 0, -1] (we used Z-down for dz, so world up = [0,0,-1]... 
  // Actually in ENU, up = +Z = [0,0,1]).
  
  // Camera right = look × world_up (for roll=0 reference)
  // look direction normalized:
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const lx = dx / len, ly = dy / len, lz = dz / len;
  
  // World up = [0, 0, 1] in ENU
  // right = look × up = [ly*1 - lz*0, lz*0 - lx*1, lx*0 - ly*0] = [ly, -lx, 0]
  // (this is only valid when look is not straight up/down, but that's fine)
  const rx = ly, ry = -lx;
  const rLen = Math.sqrt(rx * rx + ry * ry);
  
  let roll = 0;
  if (rLen > 0.01) {
    // Normalize right
    const rnx = rx / rLen, rny = ry / rLen;
    // Camera up dot world-right = component of camera-up along the reference right
    const upDotRight = upX * rnx + upY * rny;
    // Camera up dot world-up-in-camera-plane:
    // reference up = right × look
    const refUpX = ry * lz;
    const refUpY = -rx * lz;
    const refUpZ = rx * ly - ry * lx;
    const upDotRefUp = upX * refUpX + upY * refUpY + upZ * refUpZ;
    roll = Math.atan2(upDotRight, upDotRefUp) / deg2rad;
  }

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
