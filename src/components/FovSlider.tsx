interface Props {
  fov: number;
  onChange: (fov: number) => void;
}

export function FovSlider({ fov, onChange }: Props) {
  return (
    <div className="fov-slider">
      <label htmlFor="fov-range" className="fov-slider__label">
        Sensor FoV: <span className="fov-slider__value">{fov}°</span>
      </label>
      <input
        id="fov-range"
        type="range"
        min={40}
        max={90}
        step={1}
        value={fov}
        onChange={(e) => onChange(Number(e.target.value))}
        className="fov-slider__input"
      />
      <span className="fov-slider__hint">Landscape horizontal FoV from phone spec</span>
    </div>
  );
}
