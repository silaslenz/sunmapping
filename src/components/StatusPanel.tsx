import type { GeoState } from '../hooks/useGeolocation';
import type { OrientationState } from '../hooks/useDeviceOrientation';
import type { SunPosition } from '../hooks/useSunPosition';

interface Props {
  geo: GeoState;
  orientation: OrientationState;
  sun: SunPosition | null;
  fov: number;
}

function fmt(v: number | null, decimals = 1): string {
  return v == null ? '—' : v.toFixed(decimals);
}

export function StatusPanel({ geo, orientation, sun, fov }: Props) {
  return (
    <div className="status-panel">
      <div className="status-panel__row">
        <span className="status-panel__key">GPS</span>
        <span className="status-panel__val">
          {geo.lat != null
            ? `${fmt(geo.lat, 5)}, ${fmt(geo.lon, 5)} ±${fmt(geo.accuracy, 0)}m`
            : geo.error ?? 'waiting…'}
        </span>
      </div>
      <div className="status-panel__row">
        <span className="status-panel__key">Heading</span>
        <span className="status-panel__val">
          {orientation.absolute
            ? `${fmt(orientation.heading)}° (absolute)`
            : orientation.heading != null
            ? `${fmt(orientation.heading)}° (relative)`
            : 'unavailable'}
        </span>
      </div>
      <div className="status-panel__row">
        <span className="status-panel__key">Tilt</span>
        <span className="status-panel__val">{fmt(orientation.tilt)}°</span>
      </div>
      <div className="status-panel__row">
        <span className="status-panel__key">Sun az/el</span>
        <span className="status-panel__val">
          {sun ? `${fmt(sun.azimuth)}° / ${fmt(sun.altitude)}°` : '—'}
        </span>
      </div>
      <div className="status-panel__row">
        <span className="status-panel__key">FoV</span>
        <span className="status-panel__val">{fov}°</span>
      </div>
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
