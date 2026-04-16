import { useMemo, useState } from 'react';
import SunCalc from 'suncalc';
import { projectSun } from '../utils/projection';
import { isPointInSky } from '../analysis/skyAnalysis';
import type { SkyAnalysis } from '../analysis/skyAnalysis';

interface Props {
  lat: number | null;
  lon: number | null;
  cameraAxes: Float64Array | null;
  fovH: number;            // landscape (sensor) FoV — portrait vertical
  videoW: number;           // native video width (portrait)
  videoH: number;           // native video height (portrait)
  skyAnalysis: SkyAnalysis | null;
}

const SLOT_MINUTES = 15;

type SlotStatus = 'visible' | 'terrain' | 'outside';

interface Slot {
  time: Date;
  label: string;
  status: SlotStatus;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function SunTimeline({ lat, lon, cameraAxes, fovH, videoW, videoH, skyAnalysis }: Props) {
  const [dateStr, setDateStr] = useState(() => formatDate(new Date()));

  const slots = useMemo(() => {
    if (lat == null || lon == null || !cameraAxes || !skyAnalysis) return null;

    const date = new Date(dateStr + 'T12:00:00');
    const times = SunCalc.getTimes(date, lat, lon);
    const sunrise = times.sunrise;
    const sunset = times.sunset;

    if (!sunrise || !sunset || isNaN(sunrise.getTime()) || isNaN(sunset.getTime())) return null;

    // Derive portrait FoVs (same as SunOverlay)
    const portraitFovV = fovH;
    const halfVRad = (portraitFovV / 2) * Math.PI / 180;
    const portraitFovH = 2 * Math.atan(Math.tan(halfVRad) * (videoW / videoH)) * 180 / Math.PI;

    // Use a reasonable display size for the video rect (just needs aspect ratio for isPointInSky)
    const vidW = videoW;
    const vidH = videoH;

    const result: Slot[] = [];

    // Round sunrise up to the next SLOT_MINUTES boundary
    const startMs = Math.ceil(sunrise.getTime() / (SLOT_MINUTES * 60000)) * (SLOT_MINUTES * 60000);
    const endMs = sunset.getTime();

    for (let ms = startMs; ms <= endMs; ms += SLOT_MINUTES * 60000) {
      const t = new Date(ms);
      const sunPos = SunCalc.getPosition(t, lat, lon);
      const azDeg = ((sunPos.azimuth * 180 / Math.PI) + 180 + 360) % 360;
      const elDeg = sunPos.altitude * 180 / Math.PI;

      if (elDeg < 0) continue; // below horizon

      const proj = projectSun(azDeg, elDeg, cameraAxes, portraitFovH, portraitFovV, vidW, vidH);
      const inFrame = proj.inFront && proj.x >= 0 && proj.x <= vidW && proj.y >= 0 && proj.y <= vidH;

      let status: SlotStatus;
      if (!inFrame) {
        status = 'outside';
      } else if (isPointInSky(proj.x, proj.y, vidW, vidH, skyAnalysis)) {
        status = 'visible';
      } else {
        status = 'terrain';
      }

      result.push({ time: t, label: formatTime(t), status });
    }

    return result;
  }, [lat, lon, cameraAxes, fovH, videoW, videoH, skyAnalysis, dateStr]);

  if (lat == null || lon == null) return null;

  const today = formatDate(new Date());
  const isToday = dateStr === today;

  // Find "now" position as fraction of the timeline
  let nowFrac: number | null = null;
  if (isToday && slots && slots.length >= 2) {
    const now = Date.now();
    const first = slots[0].time.getTime();
    const last = slots[slots.length - 1].time.getTime();
    if (now >= first && now <= last) {
      nowFrac = (now - first) / (last - first);
    }
  }

  return (
    <div className="sun-timeline">
      <div className="sun-timeline__header">
        <span className="sun-timeline__title">Sun visibility</span>
        <input
          type="date"
          className="sun-timeline__date"
          value={dateStr}
          onChange={e => setDateStr(e.target.value)}
        />
      </div>
      {slots && slots.length > 0 ? (
        <div className="sun-timeline__bar-wrap">
          <div className="sun-timeline__bar">
            {slots.map((slot, i) => (
              <div
                key={i}
                className={`sun-timeline__slot sun-timeline__slot--${slot.status}`}
                title={`${slot.label} — ${slot.status === 'visible' ? 'In sky' : slot.status === 'terrain' ? 'Behind terrain' : 'Outside frame'}`}
              />
            ))}
            {nowFrac != null && (
              <div className="sun-timeline__now" style={{ left: `${nowFrac * 100}%` }} />
            )}
          </div>
          <div className="sun-timeline__labels">
            {slots.map((slot, i) => {
              // Show a label at each full hour
              if (slot.time.getMinutes() !== 0) return null;
              const pct = (i / (slots.length - 1)) * 100;
              return (
                <span key={i} className="sun-timeline__tick" style={{ left: `${pct}%` }}>
                  {slot.label}
                </span>
              );
            })}
          </div>
          <div className="sun-timeline__legend">
            <span className="sun-timeline__legend-item"><span className="sun-timeline__dot sun-timeline__dot--visible" /> sky</span>
            <span className="sun-timeline__legend-item"><span className="sun-timeline__dot sun-timeline__dot--terrain" /> terrain</span>
            <span className="sun-timeline__legend-item"><span className="sun-timeline__dot sun-timeline__dot--outside" /> not in frame</span>
          </div>
        </div>
      ) : (
        <div className="sun-timeline__empty">
          {!cameraAxes ? 'Waiting for compass…' : !skyAnalysis ? 'Waiting for sky analysis…' : 'No sun data for this date'}
        </div>
      )}
    </div>
  );
}
