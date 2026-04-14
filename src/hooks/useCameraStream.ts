import { useState, useEffect, useRef } from 'react';

export interface CameraState {
  stream: MediaStream | null;
  error: string | null;
}

export function useCameraStream(active: boolean): CameraState {
  const [state, setState] = useState<CameraState>({ stream: null, error: null });
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!active) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setState({ stream: null, error: 'Camera API not available. Make sure you are on HTTPS.' });
      return;
    }

    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
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
  }, [active]);

  return state;
}
