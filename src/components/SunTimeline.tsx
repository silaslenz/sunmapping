import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import SunCalc from 'suncalc';
import { projectSun } from '../utils/projection';
import { isPointInSky } from '../analysis/skyAnalysis';
import { headingToCameraAxes } from '../utils/orientation';
import type { SkyAnalysis } from '../analysis/skyAnalysis';

interface Props {
  lat: number | null;
  lon: number | null;
  cameraAxes: Float64Array | null;
  currentHeading: number | null;
  fovH: number;
  videoW: number;
  videoH: number;
  skyAnalysis: SkyAnalysis | null;
}

const SLOT_MINUTES = 15;
const HEADING_DEDUPE_THRESHOLD = 15;
const CAPTURE_INTERVAL_MS = 600;

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

function isHeadingCaptured(heading: number, captured: number[]): boolean {
  return captured.some(h => {
    const diff = Math.abs(h - heading);
    return Math.min(diff, 360 - diff) < HEADING_DEDUPE_THRESHOLD;
  });
}

/**
 * Compute slots for a single heading + sky analysis.
 */
function computeSlotsForAxes(
  lat: number,
  lon: number,
  cameraAxes: Float64Array,
  fovH: number,
  videoW: number,
  videoH: number,
  skyAnalysis: SkyAnalysis,
  dateStr: string,
): Slot[] {
  const date = new Date(dateStr + 'T12:00:00');
  const times = SunCalc.getTimes(date, lat, lon);
  const sunrise = times.sunrise;
  const sunset = times.sunset;

  if (!sunrise || !sunset || isNaN(sunrise.getTime()) || isNaN(sunset.getTime())) return [];

  const portraitFovV = fovH;
  const halfVRad = (portraitFovV / 2) * Math.PI / 180;
  const portraitFovH = 2 * Math.atan(Math.tan(halfVRad) * (videoW / videoH)) * 180 / Math.PI;

  const vidW = videoW;
  const vidH = videoH;
  const result: Slot[] = [];

  const startMs = Math.ceil(sunrise.getTime() / (SLOT_MINUTES * 60000)) * (SLOT_MINUTES * 60000);
  const endMs = sunset.getTime();

  for (let ms = startMs; ms <= endMs; ms += SLOT_MINUTES * 60000) {
    const t = new Date(ms);
    const sunPos = SunCalc.getPosition(t, lat, lon);
    const azDeg = ((sunPos.azimuth * 180 / Math.PI) + 180 + 360) % 360;
    const elDeg = sunPos.altitude * 180 / Math.PI;

    if (elDeg < 0) continue;

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
}

/**
 * Merge multiple slot arrays: for each time slot, pick the best status across
 * all headings (visible > terrain > outside).
 */
function mergeSlots(slotArrays: Slot[][]): Slot[] {
  if (slotArrays.length === 0) return [];
  if (slotArrays.length === 1) return slotArrays[0];

  // Use the first array as the time template
  const base = slotArrays[0];
  return base.map((slot, i) => {
    let bestStatus: SlotStatus = slot.status;
    for (let a = 1; a < slotArrays.length; a++) {
      const other = slotArrays[a][i];
      if (!other) continue;
      if (other.status === 'visible') {
        bestStatus = 'visible';
        break; // can't do better
      }
      if (other.status === 'terrain' && bestStatus === 'outside') {
        bestStatus = 'terrain';
      }
    }
    return { ...slot, status: bestStatus };
  });
}

export function SunTimeline({
  lat,
  lon,
  cameraAxes,
  currentHeading,
  fovH,
  videoW,
  videoH,
  skyAnalysis,
}: Props) {
  const [dateStr, setDateStr] = useState(() => formatDate(new Date()));
  const [sweepMode, setSweepMode] = useState(false);
  const [capturedHeadings, setCapturedHeadings] = useState<number[]>([]);
  const headingRef = useRef<number | null>(null);

  useEffect(() => {
    headingRef.current = currentHeading;
  }, [currentHeading]);

  // Interval-based auto-capture while sweep is active
  useEffect(() => {
    if (!sweepMode) return;

    const id = setInterval(() => {
      const h = headingRef.current;
      if (h == null) return;

      setCapturedHeadings(prev => {
        if (isHeadingCaptured(h, prev)) return prev;
        return [...prev, h];
      });
    }, CAPTURE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [sweepMode]);

  // Current live-view slots (used when sweep is off)
  const currentSlots = useMemo(() => {
    if (lat == null || lon == null || !cameraAxes || !skyAnalysis) return null;
    return computeSlotsForAxes(lat, lon, cameraAxes, fovH, videoW, videoH, skyAnalysis, dateStr);
  }, [lat, lon, cameraAxes, fovH, videoW, videoH, skyAnalysis, dateStr]);

  // Merged sweep slots: merge visibility across all captured headings
  const sweepSlots = useMemo(() => {
    if (lat == null || lon == null || capturedHeadings.length === 0 || !skyAnalysis) return null;

    const allSlots = capturedHeadings.map(heading => {
      const axes = headingToCameraAxes(heading);
      return computeSlotsForAxes(lat, lon, axes, fovH, videoW, videoH, skyAnalysis, dateStr);
    }).filter(s => s.length > 0);

    if (allSlots.length === 0) return null;
    return mergeSlots(allSlots);
  }, [lat, lon, capturedHeadings, fovH, videoW, videoH, skyAnalysis, dateStr]);

  const handleReset = useCallback(() => {
    setCapturedHeadings([]);
  }, []);

  if (lat == null || lon == null) return null;

  // Decide which slots to display: sweep merged slots if available, else live
  const displaySlots = (sweepMode && sweepSlots) ? sweepSlots : currentSlots;

  const today = formatDate(new Date());
  const isToday = dateStr === today;

  let nowFrac: number | null = null;
  if (isToday && displaySlots && displaySlots.length >= 2) {
    const now = Date.now();
    const first = displaySlots[0].time.getTime();
    const last = displaySlots[displaySlots.length - 1].time.getTime();
    if (now >= first && now <= last) {
      nowFrac = (now - first) / (last - first);
    }
  }

  return (
    <div className="sun-timeline">
      <div className="sun-timeline__header">
        <span className="sun-timeline__title">Sun visibility</span>
        <button
          className={`sun-timeline__sweep-btn ${sweepMode ? 'sun-timeline__sweep-btn--active' : ''}`}
          onClick={() => {
            setSweepMode(!sweepMode);
            if (!sweepMode) setCapturedHeadings([]);
          }}
          title={sweepMode ? 'Stop sweep' : 'Start horizon sweep'}
        >
          {sweepMode ? '◉ Sweep' : '○ Sweep'}
        </button>
        <input
          type="date"
          className="sun-timeline__date"
          value={dateStr}
          onChange={e => setDateStr(e.target.value)}
        />
      </div>

      {sweepMode && capturedHeadings.length > 0 && (
        <div className="sun-timeline__sweep-info">
          <span className="sun-timeline__sweep-count">
            {capturedHeadings.length} direction{capturedHeadings.length !== 1 ? 's' : ''} captured
          </span>
          <button className="sun-timeline__reset-btn" onClick={handleReset}>Reset</button>
        </div>
      )}

      {displaySlots && displaySlots.length > 0 ? (
        <div className="sun-timeline__bar-wrap">
          <div className="sun-timeline__bar">
            {displaySlots.map((slot, i) => (
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
            {displaySlots.map((slot, i) => {
              if (slot.time.getMinutes() !== 0) return null;
              const pct = (i / (displaySlots.length - 1)) * 100;
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
            <span className="sun-timeline__legend-item"><span className="sun-timeline__dot sun-timeline__dot--outside" /> {sweepMode ? 'not captured' : 'not in frame'}</span>
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