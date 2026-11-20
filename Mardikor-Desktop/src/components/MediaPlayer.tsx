import { useCallback, useEffect, useRef, useState } from "react";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { t } from "../../shared/i18n";
import {
  defaultMediaVolume,
  formatPlaybackTime,
  type PlaybackKind,
} from "../../shared/media-viewer";
import { desktop } from "../services/desktop";
import { PlayerSlider } from "./PlayerSlider";

export function MediaPlayer({
  file,
  path,
  kind,
  label = path.split("/").at(-1),
}: {
  file: string;
  path: string;
  kind: PlaybackKind;
  label?: string;
}) {
  const player = useRef<HTMLMediaElement>(null);
  const attachPlayer = useCallback((element: HTMLMediaElement | null) => {
    player.current = element;
    if (element) element.volume = defaultMediaVolume;
  }, []);
  const playback = useRef<string | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(defaultMediaVolume);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const video = kind === "video";

  useEffect(() => {
    const media = player.current;
    const updateFullscreen = () =>
      setFullscreen(document.fullscreenElement === media?.parentElement);
    if (video) document.addEventListener("fullscreenchange", updateFullscreen);
    return () => {
      if (video)
        document.removeEventListener("fullscreenchange", updateFullscreen);
      media?.pause();
      if (playback.current) {
        void desktop()
          .releasePlayback(playback.current)
          .catch(() => {});
        playback.current = undefined;
      }
    };
  }, [video]);

  async function toggle() {
    const media = player.current;
    if (!media || loading || failed) return;
    if (!media.paused) {
      media.pause();
      return;
    }
    setLoading(true);
    try {
      if (!playback.current) {
        const url = await desktop().preparePlayback(file, path, kind);
        if (player.current !== media) {
          void desktop()
            .releasePlayback(url)
            .catch(() => {});
          return;
        }
        playback.current = url;
        media.src = url;
      }
      await media.play();
    } catch (error) {
      if (
        player.current === media &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        setFailed(true);
    } finally {
      if (player.current === media) setLoading(false);
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void player.current?.parentElement?.requestFullscreen().catch(() => {});
    }
  }

  const mediaProps = {
    preload: "none",
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: () => setElapsed(player.current?.currentTime ?? 0),
    onDurationChange: () => {
      const seconds = player.current?.duration ?? 0;
      setDuration(Number.isFinite(seconds) ? seconds : 0);
    },
    onVolumeChange: () => {
      setVolume(player.current?.volume ?? defaultMediaVolume);
      setMuted(player.current?.muted ?? false);
    },
    onError: () => {
      setPlaying(false);
      setFailed(true);
    },
  };
  const action = playing ? t("暂停") : t("播放");
  const volumeAction = muted ? t("取消静音") : t("静音");
  const volumePercent = muted ? 0 : Math.round(volume * 100);
  const fullscreenAction = fullscreen ? t("退出全屏") : t("全屏");
  return (
    <span className="preview-player" role="group" aria-label={label}>
      {video ? (
        <video ref={attachPlayer} {...mediaProps} playsInline />
      ) : (
        <audio ref={attachPlayer} {...mediaProps} hidden />
      )}
      <span className="preview-player-controls">
        <span className="preview-player-transport">
          <button
            type="button"
            data-media-toggle
            aria-label={action}
            title={action}
            disabled={loading || failed}
            onClick={() => void toggle()}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <span className="preview-player-time">
            {formatPlaybackTime(elapsed)}
          </span>
          <PlayerSlider
            label={t("播放进度")}
            valueText={`${formatPlaybackTime(elapsed)} / ${formatPlaybackTime(duration)}`}
            max={duration || 1}
            step={0.01}
            value={Math.min(elapsed, duration)}
            disabled={!duration || failed}
            onChange={(value) => {
              if (player.current) {
                player.current.currentTime = value;
                setElapsed(player.current.currentTime);
              }
            }}
          />
          <span className="preview-player-time">
            {formatPlaybackTime(duration)}
          </span>
        </span>
        <span className="preview-player-volume">
          <button
            type="button"
            aria-label={volumeAction}
            title={volumeAction}
            onClick={() => {
              if (player.current) player.current.muted = !muted;
            }}
          >
            {muted || volume === 0 ? (
              <VolumeX size={16} />
            ) : (
              <Volume2 size={16} />
            )}
          </button>
          <PlayerSlider
            label={t("音量")}
            valueText={`${volumePercent}%`}
            max={100}
            step={1}
            value={volumePercent}
            onChange={(value) => {
              if (player.current) {
                player.current.volume = value / 100;
                player.current.muted = false;
              }
            }}
          />
          <span className="preview-player-volume-value" aria-hidden="true">
            {volumePercent}%
          </span>
        </span>
        {video && (
          <button
            type="button"
            aria-label={fullscreenAction}
            title={fullscreenAction}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        )}
      </span>
      {failed && (
        <span className="preview-player-error" role="status">
          {t("无法播放：资源可能缺失、损坏，或使用了不支持的格式或编解码器。")}
        </span>
      )}
    </span>
  );
}
