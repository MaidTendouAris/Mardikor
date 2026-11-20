import { useEffect, useState, type ReactNode } from "react";
import { Pause, Play, Repeat, Volume2, VolumeX } from "lucide-react";
import { t } from "../../shared/i18n";
import {
  defaultMediaVolume,
  formatPlaybackTime,
} from "../../shared/media-viewer";
import { PlayerSlider } from "./PlayerSlider";

const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const playbackEvents = [
  "timeupdate",
  "durationchange",
  "play",
  "pause",
  "ended",
  "volumechange",
  "ratechange",
];

function playbackState(player: HTMLMediaElement | null) {
  const duration =
    player && Number.isFinite(player.duration) ? player.duration : 0;
  return {
    duration,
    elapsed: Math.min(player?.currentTime ?? 0, duration),
    playing: !!player && !player.paused && !player.ended,
    muted: player?.muted ?? false,
    volume: player?.volume ?? defaultMediaVolume,
    speed: player?.playbackRate ?? 1,
    loop: player?.loop ?? false,
  };
}

export function MediaPlaybackBar({
  player,
  ready,
  onTogglePlayback,
  children,
}: {
  player: HTMLMediaElement | null;
  ready: boolean;
  onTogglePlayback: () => void;
  children: ReactNode;
}) {
  const [playback, setPlayback] = useState(() => playbackState(player));
  useEffect(() => {
    const sync = () => setPlayback(playbackState(player));
    sync();
    for (const event of playbackEvents) player?.addEventListener(event, sync);
    return () => {
      for (const event of playbackEvents)
        player?.removeEventListener(event, sync);
    };
  }, [player]);
  const { duration, elapsed, playing, muted, volume, speed, loop } = playback;
  const elapsedTime = formatPlaybackTime(elapsed);
  const durationTime = formatPlaybackTime(duration);
  const volumePercent = muted ? 0 : Math.round(volume * 100);
  const playLabel = playing ? t("暂停") : t("播放");
  const muteLabel = muted ? t("取消静音") : t("静音");
  const rateLabel = t("播放速度");
  const repeatLabel = t("循环播放");

  return (
    <div
      className="media-playback-bar"
      role="group"
      aria-label={t("媒体播放控件")}
      data-playing={playing}
    >
      <div className="media-playback-timeline">
        <span>{elapsedTime}</span>
        <PlayerSlider
          label={t("播放进度")}
          value={elapsed}
          valueText={`${elapsedTime} / ${durationTime}`}
          max={duration || 1}
          step={0.01}
          disabled={!ready || !duration}
          onChange={(value) => {
            if (!player) return;
            player.currentTime = value;
            setPlayback(playbackState(player));
          }}
        />
        <span>{durationTime}</span>
      </div>
      <button
        className="icon-button media-playback-toggle"
        type="button"
        aria-label={playLabel}
        title={`${playLabel} (Space)`}
        disabled={!ready}
        onClick={onTogglePlayback}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="media-playback-volume">
        <button
          className="icon-button"
          type="button"
          aria-label={muteLabel}
          title={muteLabel}
          disabled={!player}
          onClick={() => {
            if (player) player.muted = !player.muted;
          }}
        >
          {volumePercent ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <PlayerSlider
          label={t("音量")}
          value={volumePercent}
          valueText={`${volumePercent}%`}
          max={100}
          step={1}
          disabled={!player}
          onChange={(value) => {
            if (!player) return;
            player.volume = value / 100;
            player.muted = false;
            setPlayback(playbackState(player));
          }}
        />
        <span aria-hidden="true">{volumePercent}%</span>
      </div>
      <div className="media-playback-actions">
        <select
          aria-label={rateLabel}
          title={rateLabel}
          value={speed}
          disabled={!ready}
          onChange={(event) => {
            if (player) player.playbackRate = Number(event.target.value);
          }}
        >
          {speeds.map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          type="button"
          aria-label={repeatLabel}
          title={repeatLabel}
          aria-pressed={loop}
          disabled={!ready}
          onClick={() => {
            if (!player) return;
            player.loop = !player.loop;
            setPlayback(playbackState(player));
          }}
        >
          <Repeat size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
