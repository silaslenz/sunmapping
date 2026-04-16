import { useEffect, useRef, useState } from 'react';
import { useGeolocation } from './hooks/useGeolocation';
import { useDeviceOrientation } from './hooks/useDeviceOrientation';
import { useSunPosition } from './hooks/useSunPosition';
import { useCameraStream } from './hooks/useCameraStream';
import { SunOverlay } from './components/SunOverlay';
import { SunTimeline } from './components/SunTimeline';
import { StatusPanel } from './components/StatusPanel';
import { FovSlider } from './components/FovSlider';
import { DebugTimeSlider } from './components/DebugTimeSlider';
import { CaptureButton } from './components/CaptureButton';
import type { SkyAnalysis } from './analysis/skyAnalysis';

const DEFAULT_FOV = 65;
const FOV_STORAGE_KEY = 'sunmapping_fov';

function loadFov(): number {
  try {
    const n = parseInt(localStorage.getItem(FOV_STORAGE_KEY) ?? '', 10);
    if (n >= 40 && n <= 90) return n;
  } catch {}
  return DEFAULT_FOV;
}

export default function App() {
  const [fov, setFov] = useState<number>(loadFov);
  const [showSettings, setShowSettings] = useState(false);
  const [debugHour, setDebugHour] = useState<number | null>(null);
  const [skyAnalysis, setSkyAnalysis] = useState<SkyAnalysis | null>(null);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    screen.orientation?.lock?.('portrait-primary').catch(() => {});
  }, []);

  // Track video dimensions once available
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    function onMeta() {
      if (video) setVideoDims({ w: video.videoWidth, h: video.videoHeight });
    }
    video.addEventListener('loadedmetadata', onMeta);
    // Also check immediately in case already loaded
    if (video.videoWidth > 0) setVideoDims({ w: video.videoWidth, h: video.videoHeight });
    return () => video.removeEventListener('loadedmetadata', onMeta);
  }, []);

  const geo = useGeolocation();
  const orientation = useDeviceOrientation();
  const sun = useSunPosition(geo.lat, geo.lon, debugHour);
  const camera = useCameraStream();

  function handleFovChange(v: number) {
    setFov(v);
    try { localStorage.setItem(FOV_STORAGE_KEY, String(v)); } catch {}
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
        onSkyAnalysis={setSkyAnalysis}
      />

      {/* Landscape warning — shown via CSS @media only */}
      <div className="landscape-warning">
        <p>Please rotate your phone to portrait mode</p>
      </div>

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
          <DebugTimeSlider debugHour={debugHour} onChange={setDebugHour} />
        </div>
      )}

      {/* Bottom bar */}
      <div className="bottom-bar">
        <SunTimeline
          lat={geo.lat}
          lon={geo.lon}
          cameraAxes={orientation.cameraAxes ?? null}
          fovH={fov}
          videoW={videoDims.w}
          videoH={videoDims.h}
          skyAnalysis={skyAnalysis}
        />
        <StatusPanel geo={geo} orientation={orientation} sun={sun} fov={fov} skyAnalysis={skyAnalysis} />
        <CaptureButton videoRef={videoRef} overlayRef={overlayRef} />
      </div>
    </div>
  );
}
