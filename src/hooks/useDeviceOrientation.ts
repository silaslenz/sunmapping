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
 * Compute camera-space heading/tilt/roll from raw device orientation angles.
 *
 * We lock the app to portrait, so we always use portrait-mode mapping:
 *   alpha: yaw around Z (vertical), CCW from north, 0–360
 *   beta:  pitch around X, -180–180  (0=flat, 90=upright portrait → horizon)
 *   gamma: roll around Y, -90–90     (0=upright, ±90=on its side)
 */
function toCamera(alpha: number, beta: number, gamma: number) {
  const heading = (360 - alpha) % 360;
  const tilt = beta - 90;   // 0 = horizon when phone is upright portrait
  const roll = gamma;       // 0 = no roll
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
