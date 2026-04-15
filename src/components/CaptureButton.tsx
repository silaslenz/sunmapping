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

    // Composite the overlay canvas on top.
    // The overlay is screen-sized and includes letterbox offsets — we need to
    // extract just the region covering the video rect and map it to the
    // capture canvas (which is video-native-resolution).
    if (overlay && overlay.width && overlay.height) {
      const ow = overlay.width;
      const oh = overlay.height;
      // Recompute the video rect within the overlay (same logic as SunOverlay draw loop)
      const containScale = Math.min(ow / w, oh / h);
      const vidW = w * containScale;
      const vidH = h * containScale;
      const vidX = (ow - vidW) / 2;
      const vidY = (oh - vidH) / 2;
      // Draw only the video-rect portion of the overlay, stretched to fill the capture
      ctx.drawImage(overlay, vidX, vidY, vidW, vidH, 0, 0, w, h);
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
