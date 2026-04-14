interface Props {
  debugHour: number | null;
  onChange: (hour: number | null) => void;
}

function fmt(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${period}`;
}

export function DebugTimeSlider({ debugHour, onChange }: Props) {
  const enabled = debugHour != null;

  return (
    <div className="debug-time-slider">
      <label className="debug-time-slider__label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? 12 : null)}
          className="debug-time-slider__checkbox"
        />
        Debug time
        {enabled && (
          <span className="debug-time-slider__value">{fmt(debugHour!)}</span>
        )}
      </label>
      {enabled && (
        <input
          type="range"
          min={0}
          max={23}
          step={1}
          value={debugHour!}
          onChange={(e) => onChange(Number(e.target.value))}
          className="debug-time-slider__input"
        />
      )}
    </div>
  );
}
