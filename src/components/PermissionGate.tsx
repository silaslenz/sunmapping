

interface Props {
  onStart: () => void;
  errors: string[];
}

export function PermissionGate({ onStart, errors }: Props) {
  return (
    <div className="permission-gate">
      <div className="permission-gate__inner">
        <h1 className="permission-gate__title">Sun Mapper</h1>
        <p className="permission-gate__desc">
          Point your camera at the sky and see exactly where the sun is — even through clouds.
        </p>
        <ul className="permission-gate__list">
          <li>Camera (rear)</li>
          <li>Location (GPS)</li>
          <li>Device orientation (compass)</li>
        </ul>
        <button className="btn-start" onClick={onStart}>
          Start
        </button>
        {errors.length > 0 && (
          <div className="permission-gate__errors">
            {errors.map((e, i) => (
              <p key={i} className="permission-gate__error">{e}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
