import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { appLocale, t } from "../../shared/i18n";
import { formatPlaybackTime } from "../../shared/media-viewer";

export const defaultColors = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
};
export const defaultEffects = { bass: 0, middle: 0, treble: 0, balance: 0 };
export type MediaColors = typeof defaultColors;
export type MediaEffects = typeof defaultEffects;
export type MediaPanel = "color" | "audio" | "statistics";

export function createAudioGraph(player: HTMLMediaElement) {
  const context = new AudioContext();
  try {
    const bass = context.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 120;
    const middle = context.createBiquadFilter();
    middle.type = "peaking";
    middle.frequency.value = 1000;
    const treble = context.createBiquadFilter();
    treble.type = "highshelf";
    treble.frequency.value = 4500;
    const balance = context.createStereoPanner();
    context
      .createMediaElementSource(player)
      .connect(bass)
      .connect(middle)
      .connect(treble)
      .connect(balance)
      .connect(context.destination);
    return { context, bass, middle, treble, balance };
  } catch (error) {
    void context.close().catch(() => {});
    throw error;
  }
}

export function setAudioEffects(
  graph: ReturnType<typeof createAudioGraph>,
  effects: MediaEffects,
) {
  const time = graph.context.currentTime;
  for (const band of ["bass", "middle", "treble"] as const)
    graph[band].gain.setTargetAtTime(effects[band], time, 0.02);
  graph.balance.pan.setTargetAtTime(effects.balance / 100, time, 0.02);
  return graph.context.state === "suspended"
    ? graph.context.resume()
    : Promise.resolve();
}

function statistics(player: HTMLMediaElement | null) {
  const duration = Number.isFinite(player?.duration) ? player!.duration : 0;
  const rows: [string, string][] = [
    [
      t("播放进度"),
      `${formatPlaybackTime(player?.currentTime ?? 0)} / ${formatPlaybackTime(duration)}`,
    ],
    [t("播放速度"), `${player?.playbackRate ?? 1}×`],
    [
      t("音量"),
      `${player?.muted ? 0 : Math.round((player?.volume ?? 0) * 100)}%`,
    ],
  ];
  if (player && duration > 0) {
    let buffered = 0;
    for (let index = 0; index < player.buffered.length; index++)
      buffered += player.buffered.end(index) - player.buffered.start(index);
    rows.push([
      t("已缓冲"),
      `${Math.min(100, Math.round((buffered / duration) * 100))}%`,
    ]);
  }
  if (player instanceof HTMLVideoElement && player.videoWidth) {
    rows.unshift([
      t("视频分辨率"),
      `${player.videoWidth} × ${player.videoHeight}`,
    ]);
    const quality = player.getVideoPlaybackQuality();
    rows.push(
      [t("总帧数"), quality.totalVideoFrames.toLocaleString(appLocale())],
      [t("丢帧数"), quality.droppedVideoFrames.toLocaleString(appLocale())],
    );
  }
  return rows;
}

function MediaStatistics({ player }: { player: HTMLMediaElement | null }) {
  const [rows, setRows] = useState(() => statistics(player));
  useEffect(() => {
    const update = () => setRows(statistics(player));
    update();
    const timer = setInterval(update, 350);
    return () => clearInterval(timer);
  }, [player]);
  return (
    <dl>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MediaPlayerSettings({
  panel,
  player,
  video,
  colors,
  effects,
  onColor,
  onEffects,
  onClose,
}: {
  panel: MediaPanel;
  player: HTMLMediaElement | null;
  video: boolean;
  colors: MediaColors;
  effects: MediaEffects;
  onColor: (colors: MediaColors) => void;
  onEffects: (effects: MediaEffects) => void;
  onClose: () => void;
}) {
  const title =
    panel === "color"
      ? t("视频色彩调整")
      : panel === "audio"
        ? video
          ? t("视频音效调节")
          : t("音频音效调节")
        : video
          ? t("视频统计信息")
          : t("音频统计信息");
  const field = (
    label: string,
    value: number,
    min: number,
    max: number,
    unit: string,
    onChange: (value: number) => void,
  ) => (
    <label key={label}>
      <span>{label}</span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <output>
        {value}
        {unit}
      </output>
    </label>
  );
  return (
    <div className="media-player-inspector" role="dialog" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <button
          type="button"
          className="icon-button"
          aria-label={t("关闭对话框")}
          onClick={onClose}
          autoFocus
        >
          <X size={16} />
        </button>
      </header>
      {panel === "color" && (
        <>
          {field(t("亮度"), colors.brightness, 25, 200, "%", (brightness) =>
            onColor({ ...colors, brightness }),
          )}
          {field(t("对比度"), colors.contrast, 25, 200, "%", (contrast) =>
            onColor({ ...colors, contrast }),
          )}
          {field(t("饱和度"), colors.saturation, 0, 200, "%", (saturation) =>
            onColor({ ...colors, saturation }),
          )}
          <button
            className="button small"
            type="button"
            onClick={() => onColor(defaultColors)}
          >
            {t("重置")}
          </button>
        </>
      )}
      {panel === "audio" && (
        <>
          {field(t("低音"), effects.bass, -12, 12, " dB", (bass) =>
            onEffects({ ...effects, bass }),
          )}
          {field(t("中音"), effects.middle, -12, 12, " dB", (middle) =>
            onEffects({ ...effects, middle }),
          )}
          {field(t("高音"), effects.treble, -12, 12, " dB", (treble) =>
            onEffects({ ...effects, treble }),
          )}
          {field(
            t("左右声道平衡"),
            effects.balance,
            -100,
            100,
            "%",
            (balance) => onEffects({ ...effects, balance }),
          )}
          <button
            className="button small"
            type="button"
            onClick={() => onEffects(defaultEffects)}
          >
            {t("重置")}
          </button>
        </>
      )}
      {panel === "statistics" && <MediaStatistics player={player} />}
    </div>
  );
}
