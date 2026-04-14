import { useState, useEffect } from 'react';
import SunCalc from 'suncalc';

export interface SunPosition {
  /** Sun azimuth in degrees, clockwise from north (0–360). */
  azimuth: number;
  /** Sun altitude/elevation in degrees above horizon. Negative = below horizon. */
  altitude: number;
}

/**
 * @param lat - Latitude in decimal degrees.
 * @param lon - Longitude in decimal degrees.
 * @param debugHour - If set (0–23), override the current time with this hour
 *                    (using today's date) for debugging sun position.
 */
export function useSunPosition(
  lat: number | null,
  lon: number | null,
  debugHour: number | null = null,
): SunPosition | null {
  const [position, setPosition] = useState<SunPosition | null>(null);

  useEffect(() => {
    if (lat == null || lon == null) {
      setPosition(null);
      return;
    }

    function compute() {
      if (lat == null || lon == null) return;

      let date: Date;
      if (debugHour != null) {
        date = new Date();
        date.setHours(debugHour, 0, 0, 0);
      } else {
        date = new Date();
      }

      const pos = SunCalc.getPosition(date, lat, lon);

      // SunCalc azimuth: radians from south, increasing westward.
      // Convert to compass degrees (0 = north, CW):
      const azimuthDeg = ((pos.azimuth * 180) / Math.PI + 180 + 360) % 360;
      const altitudeDeg = (pos.altitude * 180) / Math.PI;

      setPosition({ azimuth: azimuthDeg, altitude: altitudeDeg });
    }

    compute();
    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [lat, lon, debugHour]);

  return position;
}
