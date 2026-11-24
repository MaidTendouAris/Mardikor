import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Ellipsis } from "lucide-react";
import { t } from "../../shared/i18n";
import {
  defaultMediaVolume,
  type PlaybackKind,
} from "../../shared/media-viewer";
import { desktop, desktopErrorMessage } from "../services/desktop";
import { EditorMenu } from "./EditorMenu";
import { MediaPlaybackBar } from "./MediaPlaybackBar";
import {
  createAudioGraph,
  defaultColors,
  defaultEffects,
  MediaPlayerSettings,
  setAudioEffects,
  type MediaEffects,
  type MediaPanel,
} from "./MediaPlayerSettings";

const controlsDelay = 2200;
const holdDelay = 350;
const clickDelay = 280;
type SeekHold = {
  key: string;
  timer: ReturnType<typeof setTimeout>;
  media: HTMLMediaElement;
  rate: number;
  paused: boolean;
  fast: boolean;
};

export function MediaPlayer({
  file,
  path,
  kind,
  label = path.split("/").at(-1)!,
}: {
  file: string;
  path: string;
  kind: PlaybackKind;
  label?: string;
}) {
  return (
    <MediaPlayback
      key={JSON.stringify([file, path])}
      kind={kind}
      label={label}
      inline
      acquire={() => desktop().preparePlayback(file, path, kind)}
      release={(url) => desktop().releasePlayback(url)}
      openWindow={() => desktop().openMedia(file, path, kind)}
    />
  );
}

export function MediaPlayback({
  kind,
  label,
  src,
  inline = false,
  acquire,
  release,
  openWindow,
  onMetadata,
  onFailure,
  children,
}: {
  kind: PlaybackKind;
  label: string;
  src?: string;
  inline?: boolean;
  acquire?: () => Promise<string>;
  release?: (url: string) => Promise<void>;
  openWindow?: () => Promise<void>;
  onMetadata?: (element: HTMLMediaElement) => void;
  onFailure?: () => void;
  children?: ReactNode;
}) {
  const surface = useRef<HTMLSpanElement>(null);
  const player = useRef<HTMLMediaElement | null>(null);
  const [element, setElement] = useState<HTMLMediaElement | null>(null);
  const attach = useCallback((media: HTMLMediaElement | null) => {
    if (media) media.volume = defaultMediaVolume;
    player.current = media;
    setElement(media);
  }, []);
  const lease = useRef<string | undefined>(undefined);
  const releaseLease = useRef(release);
  releaseLease.current = release;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [boost, setBoost] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    keyboard: boolean;
  }>();
  const [panel, setPanel] = useState<MediaPanel>();
  const [colors, setColors] = useState(defaultColors);
  const [effects, setEffects] = useState(defaultEffects);
  const [message, setMessage] = useState("");
  const focusBeforeHover = useRef<HTMLElement | null>(null);
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const holding = useRef<SeekHold | undefined>(undefined);
  const graph = useRef<ReturnType<typeof createAudioGraph> | undefined>(
    undefined,
  );
  const video = kind === "video";
  const filter =
    colors === defaultColors
      ? ""
      : `brightness(${colors.brightness}%) contrast(${colors.contrast}%) saturate(${colors.saturation}%)`;

  function reveal() {
    setVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), controlsDelay);
  }
  function releaseHover() {
    clearTimeout(hideTimer.current);
    setVisible(false);
    const previous = focusBeforeHover.current;
    focusBeforeHover.current = null;
    if (!previous || document.activeElement !== surface.current) return;
    if (previous.isConnected && previous !== document.body)
      previous.focus({ preventScroll: true });
    else surface.current?.blur();
  }
  const stopHold = useCallback((seek: boolean, update = true) => {
    const hold = holding.current;
    if (!hold) return;
    holding.current = undefined;
    clearTimeout(hold.timer);
    const { media } = hold;
    if (hold.fast) {
      media.playbackRate = hold.rate;
      if (hold.paused) media.pause();
      if (update) setBoost(false);
    } else if (seek && Number.isFinite(media.duration)) {
      media.currentTime = Math.min(
        media.duration,
        Math.max(0, media.currentTime + (hold.key === "ArrowLeft" ? -5 : 5)),
      );
    }
  }, []);

  useEffect(() => {
    const media = player.current;
    if (!inline) surface.current?.focus({ preventScroll: true });
    const onFullscreen = () =>
      setFullscreen(
        !!surface.current &&
          !!document.fullscreenElement?.contains(surface.current),
      );
    const onBlur = () => stopHold(false);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("blur", onBlur);
      stopHold(false, false);
      clearTimeout(hideTimer.current);
      clearTimeout(clickTimer.current);
      media?.pause();
      if (graph.current) void graph.current.context.close().catch(() => {});
      graph.current = undefined;
      if (lease.current)
        void releaseLease.current?.(lease.current).catch(() => {});
      lease.current = undefined;
    };
  }, [inline, stopHold]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  function fail() {
    setFailed(true);
    onFailure?.();
  }
  function applyEffects(media: HTMLMediaElement, next: MediaEffects) {
    if (
      !media.getAttribute("src") ||
      (!graph.current && next === defaultEffects)
    )
      return;
    try {
      const active = (graph.current ??= createAudioGraph(media));
      void setAudioEffects(active, next).catch(() =>
        setMessage(t("无法启用音效调节。")),
      );
    } catch {
      setMessage(t("无法启用音效调节。"));
    }
  }
  function changeEffects(next: MediaEffects) {
    setEffects(next);
    if (player.current) applyEffects(player.current, next);
  }
  async function toggle() {
    const media = player.current;
    if (!media || busy.current || failed) return;
    reveal();
    if (!media.paused) {
      media.pause();
      return;
    }
    busy.current = true;
    setLoading(true);
    try {
      if (acquire && !lease.current) {
        const url = await acquire();
        if (player.current !== media) {
          await release?.(url);
          return;
        }
        lease.current = url;
        media.src = url;
      }
      applyEffects(media, effects);
      await media.play();
    } catch (error) {
      if (
        player.current === media &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        fail();
    } finally {
      busy.current = false;
      if (player.current === media) setLoading(false);
    }
  }
  function toggleFullscreen() {
    const root = surface.current;
    if (!root) return;
    reveal();
    const request = document.fullscreenElement?.contains(root)
      ? document.exitFullscreen()
      : root.requestFullscreen();
    void request.catch((error) => setMessage(desktopErrorMessage(error)));
  }

  function keyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    )
      return;
    const target = event.target as HTMLElement;
    if (event.key === "Escape" && (panel || fullscreen)) {
      event.preventDefault();
      event.stopPropagation();
      if (panel) closePanel();
      if (fullscreen && document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
      return;
    }
    if (
      target.closest(
        "input,select,textarea,[contenteditable=true],[role=listbox],.media-player-inspector,.editor-context-menu",
      )
    )
      return;
    const media = player.current;
    if (!media) return;
    const key = event.key;
    if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) {
      const box = surface.current!.getBoundingClientRect();
      openMenu(box.left + box.width / 2, box.top + box.height / 2, true);
    } else if (key.toLowerCase() === "f") {
      if (!event.repeat) toggleFullscreen();
    } else if (key === " " && !target.closest("button")) {
      if (!event.repeat) void toggle();
    } else if (key === "ArrowUp" || key === "ArrowDown") {
      const volume = media.muted ? 0 : Math.round(media.volume * 100);
      media.volume =
        Math.max(0, Math.min(100, volume + (key === "ArrowUp" ? 5 : -5))) / 100;
      media.muted = false;
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      if (
        !event.repeat &&
        !holding.current &&
        Number.isFinite(media.duration)
      ) {
        const hold: SeekHold = {
          key,
          media,
          rate: media.playbackRate,
          paused: media.paused,
          fast: false,
          timer: setTimeout(() => {
            if (holding.current !== hold) return;
            hold.fast = true;
            media.playbackRate = 2;
            setBoost(true);
            if (hold.paused) void media.play().catch(() => {});
          }, holdDelay),
        };
        holding.current = hold;
      }
    } else return;
    focusBeforeHover.current = null;
    event.preventDefault();
    event.stopPropagation();
    reveal();
  }
  function openMenu(x: number, y: number, keyboard: boolean) {
    focusBeforeHover.current = null;
    stopHold(false);
    clearTimeout(clickTimer.current);
    setMenu({ x, y, keyboard });
    reveal();
  }
  const closeMenu = useCallback(() => {
    setMenu(undefined);
    if (document.activeElement?.closest(".editor-context-menu"))
      surface.current?.focus({ preventScroll: true });
  }, []);
  function closePanel() {
    setPanel(undefined);
    surface.current?.focus({ preventScroll: true });
  }
  function showPanel(next: MediaPanel) {
    setPanel(next);
    reveal();
  }
  const items = [
    ...(video
      ? [
          {
            id: "color",
            label: t("视频色彩调整"),
            run: () => showPanel("color"),
          },
        ]
      : []),
    {
      id: "audio",
      label: video ? t("视频音效调节") : t("音频音效调节"),
      run: () => showPanel("audio"),
    },
    {
      id: "statistics",
      label: video ? t("视频统计信息") : t("音频统计信息"),
      run: () => showPanel("statistics"),
    },
    ...(openWindow
      ? [
          {
            id: "window",
            label: t("打开新窗口播放"),
            separator: true,
            run: () => {
              void openWindow().catch((error) =>
                setMessage(desktopErrorMessage(error)),
              );
            },
          },
        ]
      : []),
  ];
  const mediaProps = {
    ref: attach,
    src,
    preload: inline ? "none" : "metadata",
    crossOrigin: "anonymous" as const,
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      setReady(true);
      onMetadata?.(event.currentTarget);
    },
    onError: fail,
  };
  return (
    <span
      ref={surface}
      className={`media-player${inline ? " preview-player" : ""}`}
      role="group"
      aria-label={label}
      tabIndex={0}
      data-kind={kind}
      data-controls-visible={visible || !!menu || !!panel || boost}
      data-boost={boost || undefined}
      onPointerEnter={reveal}
      onPointerMove={reveal}
      onPointerLeave={releaseHover}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) stopHold(false);
      }}
      onKeyDown={keyDown}
      onKeyUp={(event) => {
        if (holding.current?.key === event.key) {
          event.preventDefault();
          event.stopPropagation();
          stopHold(true);
        }
      }}
      onContextMenu={(event) => {
        if (
          (event.target as HTMLElement).closest(
            ".media-player-inspector,.editor-context-menu",
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        surface.current?.focus({ preventScroll: true });
        openMenu(event.clientX, event.clientY, false);
      }}
    >
      <span
        className="media-player-surface"
        onPointerEnter={(event) => {
          const root = surface.current;
          const active = document.activeElement;
          if (video && event.pointerType === "mouse" && root &&
            active instanceof HTMLElement && !root.contains(active)) {
            focusBeforeHover.current = active;
            root.focus({ preventScroll: true });
          }
        }}
        onPointerDown={(event) => {
          if (event.button === 0) {
            focusBeforeHover.current = null;
            surface.current?.focus({ preventScroll: true });
          }
        }}
        onClick={(event) => {
          clearTimeout(clickTimer.current);
          if (event.detail === 1)
            clickTimer.current = setTimeout(() => void toggle(), clickDelay);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          clearTimeout(clickTimer.current);
          toggleFullscreen();
        }}
      >
        {video ? (
          <video {...mediaProps} playsInline style={{ filter }} />
        ) : (
          <audio {...mediaProps} hidden />
        )}
      </span>
      <span className="media-playback-overlay">
        <MediaPlaybackBar
          player={element}
          ready={ready && !failed}
          canPlay={!loading && !failed}
          filter={filter}
          fullscreen={fullscreen}
          onTogglePlayback={() => void toggle()}
          onToggleFullscreen={toggleFullscreen}
        >
          {children}
          <button
            type="button"
            className="icon-button"
            aria-label={t("媒体播放菜单")}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              openMenu(box.left, box.bottom, event.detail === 0);
            }}
          >
            <Ellipsis size={18} />
          </button>
        </MediaPlaybackBar>
      </span>
      {boost && (
        <span className="media-speed-indicator" role="status">
          {t("2 倍速播放")}
        </span>
      )}
      {failed && (
        <span className="media-player-message" role="status">
          {t("无法播放：资源可能缺失、损坏，或使用了不支持的格式或编解码器。")}
        </span>
      )}
      {message && (
        <span className="media-player-message" role="status">
          {message}
        </span>
      )}
      {panel && (
        <MediaPlayerSettings
          panel={panel}
          player={element}
          video={video}
          colors={colors}
          effects={effects}
          onColor={setColors}
          onEffects={changeEffects}
          onClose={closePanel}
        />
      )}
      {menu && (
        <EditorMenu
          {...menu}
          container={
            fullscreen ? (document.fullscreenElement ?? undefined) : undefined
          }
          ariaLabel={t("媒体播放菜单")}
          className={video ? "video-playback-popover" : undefined}
          focusFirst={menu.keyboard}
          onClose={closeMenu}
          items={items}
        />
      )}
    </span>
  );
}
