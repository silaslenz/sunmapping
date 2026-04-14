import { useState, useEffect, useRef } from 'react';

export interface OrientationState {
  /** Compass heading in degrees, clockwise from north (0–360). Null if unavailable. */
  heading: number | null;
  /** Vertical tilt in degrees. 0 = camera pointing at horizon, +90 = pointing up, -90 = pointing down. */
  tilt: number | null;
  /** Roll in degrees. 0 = phone upright/level, positive = tilted right. */
  roll: number | null;
  /** True if we have an absolute (north-referenced) heading source. */
  absolute: boolean;
  /** Whether the browser has any orientation support at all. */
  supported: boolean;
}

/**
 * Returns the current screen rotation angle in degrees (0, 90, 180, 270).
 * Uses the Screen Orientation API where available, falls back to
 * the deprecated window.orientation.
 */
function getScreenAngle(): number {
  if (typeof screen !== 'undefined' && screen.orientation?.angle != null) {
    return screen.orientation.angle;
  }
  if (typeof window.orientation === 'number') {
    // window.orientation returns negative for some rotations; normalise.
    return ((window.orientation as number) + 360) % 360;
  }
  return 0; // assume portrait
}

/**
 * Given raw DeviceOrientationEvent angles and the current screen rotation,
 * return { heading, tilt, roll } in camera-space coordinates where:
 *   heading = compass bearing the camera points at (degrees CW from north)
 *   tilt    = elevation angle of camera (0 = horizon, +90 = zenith, -90 = nadir)
 *   roll    = clockwise rotation of the image (0 = upright)
 *
 * The Device Orientation spec defines alpha/beta/gamma relative to the
 * device body regardless of screen orientation, so we must remap when the
 * screen has been rotated.
 *
 * Reference coordinate system (spec):
 *   alpha: yaw   around Z (vertical), CCW from north, 0–360
 *   beta:  pitch around X, -180–180  (0=flat, 90=upright portrait, horizon)
 *   gamma: roll  around Y, -90–90    (0=flat/upright, ±90=on its side)
 */
function remapOrientation(
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle: number,
): { heading: number; tilt: number; roll: number } {
  // alpha (yaw) is always relative to true north regardless of screen angle.
  const heading = (360 - alpha) % 360;

  let tilt: number;
  let roll: number;

  switch (screenAngle) {
    case 90:
      // Landscape: home button on the right (rotated clockwise).
      // gamma is now the forward/back tilt; beta is the roll.
      tilt = -(gamma + 90);
      roll = beta;
      break;
    case 270:
      // Landscape: home button on the left (rotated counter-clockwise).
      tilt = gamma - 90;
      roll = -beta;
      break;
    case 180:
      // Portrait upside-down.
      tilt = -(beta + 90);
      roll = -gamma;
      break;
    default:
      // 0° — normal portrait.
      tilt = beta - 90;
      roll = gamma;
      break;
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

  // Track whether we've received at least one absolute event so we
  // don't fall back to relative unnecessarily.
  const gotAbsolute = useRef(false);

  useEffect(() => {
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      return;
    }

    setState(s => ({ ...s, supported: true }));

    function handleAbsolute(e: DeviceOrientationEvent) {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      gotAbsolute.current = true;

      const { heading, tilt, roll } = remapOrientation(
        e.alpha, e.beta, e.gamma, getScreenAngle(),
      );

      setState({ heading, tilt, roll, absolute: true, supported: true });
    }

    function handleRelative(e: DeviceOrientationEvent) {
      // Only use relative events if we haven't received an absolute one.
      if (gotAbsolute.current) return;
      if (e.beta == null || e.gamma == null) return;

      const { tilt, roll } = remapOrientation(
        0, e.beta, e.gamma, getScreenAngle(),
      );

      setState({
        heading: null, // non-absolute alpha is meaningless for compass
        tilt,
        roll,
        absolute: false,
        supported: true,
      });
    }

    // Prefer deviceorientationabsolute (Chrome 50+, Firefox 110+).
    // Fall back to deviceorientation with absolute flag check.
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
