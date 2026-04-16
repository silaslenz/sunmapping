import type { GeoState } from '../hooks/useGeolocation';
import type { OrientationState } from '../hooks/useDeviceOrientation';
import type { SunPosition } from '../hooks/useSunPosition';
import type { SkyAnalysis } from '../analysis/skyAnalysis';

interface Props {
  geo: GeoState;
  orientation: OrientationState;
  sun: SunPosition | null;
  fov: number;
  skyAnalysis: SkyAnalysis | null;
}

function fmt(v: number | null, decimals = 1): string {
  return v == null ? '—' : v.toFixed(decimals);
}

export function StatusPanel({ geo, orientation, sun, fov, skyAnalysis }: Props) {
  const headingVal = orientation.absolute
    ? `${fmt(orientation.heading)}° (absolute)`
    : orientation.heading != null
    ? `${fmt(orientation.heading)}° (relative)`
    : 'unavailable';

  const sunVisVal = skyAnalysis == null ? '—'
    : skyAnalysis.sunInSky === true ? 'In sky'
    : skyAnalysis.sunInSky === false ? 'Behind terrain'
    : 'Not in frame';

  const rows: [string, string][] = [
    ['GPS', geo.lat != null
      ? `${fmt(geo.lat, 5)}, ${fmt(geo.lon, 5)} ±${fmt(geo.accuracy, 0)}m`
      : geo.error ?? 'waiting…'],
    ['Heading', headingVal],
    ['Tilt', `${fmt(orientation.tilt)}°`],
    ['Sun az/el', sun ? `${fmt(sun.azimuth)}° / ${fmt(sun.altitude)}°` : '—'],
    ['FoV', `${fov}°`],
    ['Sky', skyAnalysis ? `${(skyAnalysis.skyFraction * 100).toFixed(0)}% of frame` : '—'],
    ['Sun vis', sunVisVal],
  ];

  return (
    <div className="status-panel">
      {rows.map(([key, val]) => (
        <div key={key} className="status-panel__row">
          <span className="status-panel__key">{key}</span>
          <span className="status-panel__val">{val}</span>
        </div>
      ))}
      {!orientation.absolute && orientation.supported && (
        <div className="status-panel__warn">
          Compass not north-referenced — sun overlay unavailable.
          Requires Firefox 110+ or Chrome 50+.
        </div>
      )}
      {!orientation.supported && (
        <div className="status-panel__warn">
          Device orientation not supported by this browser.
        </div>
      )}
    </div>
  );
}
