import { useState, useEffect } from 'react';
import SunCalc from 'suncalc';

export interface SunPosition {
  /** Sun azimuth in degrees, clockwise from north (0–360). */
  azimuth: number;
  /** Sun altitude/elevation in degrees above horizon. Negative = below horizon. */
  altitude: number;
}

export function useSunPosition(lat: number | null, lon: number | null): SunPosition | null {
  const [position, setPosition] = useState<SunPosition | null>(null);

  useEffect(() => {
    if (lat == null || lon == null) {
      setPosition(null);
      return;
    }

    function compute() {
      if (lat == null || lon == null) return;
      const pos = SunCalc.getPosition(new Date(), lat, lon);

      // SunCalc azimuth: radians from south, increasing westward.
      // Convert to compass degrees (0 = north, CW):
      //   south = 180°, west = 270°, north = 0°/360°
      const azimuthDeg = ((pos.azimuth * 180) / Math.PI + 180 + 360) % 360;
      const altitudeDeg = (pos.altitude * 180) / Math.PI;

      setPosition({ azimuth: azimuthDeg, altitude: altitudeDeg });
    }

    compute();
    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [lat, lon]);

  return position;
}
