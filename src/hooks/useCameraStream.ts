import { useState, useEffect, useRef } from 'react';

export interface CameraState {
  stream: MediaStream | null;
  error: string | null;
}

export function useCameraStream(): CameraState {
  const [state, setState] = useState<CameraState>({ stream: null, error: null });
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setState({ stream: null, error: 'Camera API not available. Make sure you are on HTTPS.' });
      return;
    }

    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          // No width/height constraints — use the camera's native resolution
          // (usually 4:3 full sensor, which gives the widest FoV).
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        setState({ stream, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ stream: null, error: `Camera error: ${msg}` });
      });

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return state;
}
