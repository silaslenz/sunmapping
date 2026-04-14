import { useRef, useState } from 'react';
import { useGeolocation } from './hooks/useGeolocation';
import { useDeviceOrientation } from './hooks/useDeviceOrientation';
import { useSunPosition } from './hooks/useSunPosition';
import { useCameraStream } from './hooks/useCameraStream';
import { PermissionGate } from './components/PermissionGate';
import { SunOverlay } from './components/SunOverlay';
import { StatusPanel } from './components/StatusPanel';
import { FovSlider } from './components/FovSlider';
import { CaptureButton } from './components/CaptureButton';

const DEFAULT_FOV = 65;
const FOV_STORAGE_KEY = 'sunmapping_fov';

function loadFov(): number {
  try {
    const v = localStorage.getItem(FOV_STORAGE_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= 40 && n <= 90) return n;
    }
  } catch {}
  return DEFAULT_FOV;
}

export default function App() {
  const [started, setStarted] = useState(false);
  const [fov, setFov] = useState<number>(loadFov);
  const [showSettings, setShowSettings] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const geo = useGeolocation();
  const orientation = useDeviceOrientation();
  const sun = useSunPosition(geo.lat, geo.lon);
  const camera = useCameraStream(started);

  function handleFovChange(v: number) {
    setFov(v);
    try { localStorage.setItem(FOV_STORAGE_KEY, String(v)); } catch {}
  }

  const errors: string[] = [];
  if (camera.error) errors.push(camera.error);
  if (geo.error) errors.push(geo.error);

  if (!started) {
    return <PermissionGate onStart={() => setStarted(true)} errors={errors} />;
  }

  return (
    <div className="app">
      <SunOverlay
        stream={camera.stream}
        orientation={orientation}
        sun={sun}
        fovH={fov}
        videoRef={videoRef}
        overlayRef={overlayRef}
      />

      {/* Top bar */}
      <div className="top-bar">
        <button
          className="btn-icon"
          onClick={() => setShowSettings(s => !s)}
          aria-label="Toggle settings"
          title="Settings"
        >
          &#9881;
        </button>
      </div>

      {/* Settings drawer */}
      {showSettings && (
        <div className="settings-drawer">
          <FovSlider fov={fov} onChange={handleFovChange} />
        </div>
      )}

      {/* Bottom bar */}
      <div className="bottom-bar">
        <StatusPanel geo={geo} orientation={orientation} sun={sun} fov={fov} />
        <CaptureButton videoRef={videoRef} overlayRef={overlayRef} />
      </div>
    </div>
  );
}
