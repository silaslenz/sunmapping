import { useRef } from 'react';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
}

export function CaptureButton({ videoRef, overlayRef }: Props) {
  const linkRef = useRef<HTMLAnchorElement>(null);

  function capture() {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video) return;

    const w = video.videoWidth || video.clientWidth;
    const h = video.videoHeight || video.clientHeight;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw the video frame
    ctx.drawImage(video, 0, 0, w, h);

    // Composite the overlay canvas on top (if available and same-ish size)
    if (overlay) {
      ctx.drawImage(overlay, 0, 0, w, h);
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = linkRef.current!;
      a.href = url;
      a.download = `sun_${Date.now()}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/jpeg', 0.92);
  }

  return (
    <>
      {/* Hidden link used to trigger download */}
      <a ref={linkRef} style={{ display: 'none' }} aria-hidden="true" />
      <button className="btn-capture" onClick={capture} aria-label="Capture photo">
        <span className="btn-capture__icon" />
      </button>
    </>
  );
}
