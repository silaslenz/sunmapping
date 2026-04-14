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
      if (e.alpha == null) return;
      gotAbsolute.current = true;

      // Spec alpha: counterclockwise from north. Convert to CW compass heading.
      const heading = (360 - e.alpha) % 360;

      // beta: 0 = flat, ~90 = upright portrait pointing at horizon
      // We want 0 = pointing at horizon, so subtract 90.
      const tilt = e.beta != null ? e.beta - 90 : null;

      // gamma: 0 = upright, ±90 = on its side
      const roll = e.gamma;

      setState({
        heading,
        tilt,
        roll,
        absolute: true,
        supported: true,
      });
    }

    function handleRelative(e: DeviceOrientationEvent) {
      // Only use relative events if we haven't received an absolute one.
      if (gotAbsolute.current) return;
      if (e.alpha == null) return;

      const tilt = e.beta != null ? e.beta - 90 : null;
      const roll = e.gamma;

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
    // Always attach the standard event too for tilt/roll even if heading isn't absolute.
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
