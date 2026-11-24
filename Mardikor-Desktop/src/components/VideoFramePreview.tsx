import { useEffect, useRef, useState } from "react";

export function VideoFramePreview({
  src,
  seconds,
  filter,
}: {
  src: string;
  seconds: number;
  filter: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const seek = useRef<((time: number) => void) | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const video = document.createElement("video");
    video.muted = true;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    let requested = -1;
    let displayed = -1;
    const draw = () => {
      const output = canvas.current;
      if (!output || !video.videoWidth || video.readyState < 2) return;
      output.width = 180;
      output.height = Math.max(
        1,
        Math.round((180 * video.videoHeight) / video.videoWidth),
      );
      output
        .getContext("2d")
        ?.drawImage(video, 0, 0, output.width, output.height);
      displayed = video.currentTime;
      setReady(true);
    };
    const update = () => {
      if (video.seeking || !Number.isFinite(video.duration) || requested < 0)
        return;
      const target = Math.min(requested, Math.max(0, video.duration - 0.04));
      if (Math.abs(video.currentTime - target) >= 0.015)
        video.currentTime = target;
      else if (displayed < 0) draw();
    };
    const settled = () => {
      draw();
      update();
    };
    seek.current = (time) => {
      requested = time;
      update();
    };
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("loadeddata", settled);
    video.addEventListener("seeked", settled);
    video.src = src;
    return () => {
      seek.current = null;
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("loadeddata", settled);
      video.removeEventListener("seeked", settled);
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);
  useEffect(() => {
    const timer = setTimeout(() => seek.current?.(seconds), 75);
    return () => clearTimeout(timer);
  }, [src, seconds]);
  return (
    <canvas
      ref={canvas}
      hidden={!ready}
      style={{ filter }}
      aria-hidden="true"
    />
  );
}
