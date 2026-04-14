import { useState, useEffect } from 'react';

export interface GeoState {
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  error: string | null;
}

export function useGeolocation(): GeoState {
  const [state, setState] = useState<GeoState>({
    lat: null,
    lon: null,
    accuracy: null,
    error: null,
  });

  useEffect(() => {
    if (!navigator.geolocation) {
      setState(s => ({ ...s, error: 'Geolocation not supported by this browser.' }));
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          error: null,
        });
      },
      (err) => {
        setState(s => ({ ...s, error: `GPS error: ${err.message}` }));
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return state;
}
