import { createRoot } from "react-dom/client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  AudioLines,
  Copy,
  Download,
  File,
  FlipHorizontal2,
  Image as ImageIcon,
  ImageOff,
  Info,
  Maximize,
  Minimize,
  Minus,
  RotateCcw,
  RotateCw,
  Scan,
  Square,
  Video,
  VideoOff,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { appLocale, setAppLocale, t } from "../shared/i18n";
import {
  defaultMediaVolume,
  type MediaViewerApi,
  type MediaViewerInfo,
  type MediaWindowAction,
} from "../shared/media-viewer";
import { EditorMenu } from "./components/EditorMenu";
import { MediaPlaybackBar } from "./components/MediaPlaybackBar";
import { desktopErrorMessage } from "./services/desktop";
import "./styles/base.css";
import "./styles/media-viewer.css";

type Size = { width: number; height: number };
type View = {
  zoom: number | null;
  angle: number;
  mirrored: boolean;
  x: number;
  y: number;
};
const initialView: View = { zoom: null, angle: 0, mirrored: false, x: 0, y: 0 };
const initialSize: Size = { width: 0, height: 0 };
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function imageLayout(view: View, natural: Size, area: Size) {
  const sideways = Math.abs(view.angle % 180) === 90;
  const width = sideways ? natural.height : natural.width;
  const height = sideways ? natural.width : natural.height;
  const zoom =
    view.zoom ??
    (width && height && area.width && area.height
      ? Math.min(
          1,
          Math.max(1, area.width - 32) / width,
          Math.max(1, area.height - 32) / height,
        )
      : 1);
  // Keep a strip of the picture reachable even when it fits inside the stage.
  const panLimit = (image: number, stage: number) =>
    Math.max(0, (stage + image) / 2 - Math.min(64, image, stage / 2));
  const left = panLimit(width * zoom, area.width);
  const top = panLimit(height * zoom, area.height);
  return {
    zoom,
    x: clamp(view.x, -left, left),
    y: clamp(view.y, -top, top),
  };
}

function Tool({
  label,
  shortcut,
  children,
  onClick,
  pressed,
  disabled,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AttachmentDetails({ info }: { info: MediaViewerInfo }) {
  return (
    <dl className="media-viewer-details">
      <dt>{t("文件")}</dt>
      <dd>{info.name}</dd>
      <dt>{t("路径")}</dt>
      <dd>{info.path}</dd>
      <dt>{t("大小")}</dt>
      <dd>
        {info.bytes.toLocaleString(appLocale())} {t("字节")}
      </dd>
      <dt>{t("类型")}</dt>
      <dd>
        {info.mime === "application/octet-stream" ? t("未知类型") : info.mime}
      </dd>
    </dl>
  );
}

function MediaViewer({
  info,
  api,
}: {
  info: MediaViewerInfo;
  api: MediaViewerApi;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [player, setPlayer] = useState<HTMLMediaElement | null>(null);
  const attachPlayer = useCallback((element: HTMLMediaElement | null) => {
    if (element) element.volume = defaultMediaVolume;
    setPlayer(element);
  }, []);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
  }>(undefined);
  const [dragging, setDragging] = useState(false);
  const [area, setArea] = useState<Size>(initialSize);
  const [natural, setNatural] = useState<Size>(initialSize);
  const [view, setView] = useState<View>(initialView);
  const [failed, setFailed] = useState(!info.src && info.kind !== "attachment");
  const [ready, setReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [imageMenu, setImageMenu] = useState<{
    x: number;
    y: number;
    keyboard: boolean;
  } | null>(null);
  const closeImageMenu = useCallback(() => {
    setImageMenu(null);
    if (document.activeElement?.closest(".editor-context-menu"))
      stage.current?.focus({ preventScroll: true });
  }, []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [details, setDetails] = useState(false);
  const isImage = info.kind === "image";
  const isVideo = info.kind === "video";
  const isPlayer = isVideo || info.kind === "audio";
  const isAttachment = info.kind === "attachment";
  const showTools = ready && !failed;
  const layout = imageLayout(view, natural, area);
  const MediaIcon = isImage
    ? ImageIcon
    : isVideo
      ? Video
      : isPlayer
        ? AudioLines
        : File;

  useEffect(() => api.onMaximized(setMaximized), [api]);

  useEffect(() => {
    if (!isImage || !stage.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setArea({ width, height });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [isImage]);
  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3500);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const element = stage.current;
    if (!isImage || !showTools || !element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      changeZoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, {
        x: event.clientX - box.left - box.width / 2,
        y: event.clientY - box.top - box.height / 2,
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [isImage, showTools, natural, area]);

  function changeZoom(factor: number, at = { x: 0, y: 0 }) {
    setView((current) => {
      const before = imageLayout(current, natural, area);
      const zoom = clamp(before.zoom * factor, Math.min(0.02, before.zoom), 16);
      const ratio = zoom / before.zoom;
      const next = imageLayout(
        {
          ...current,
          zoom,
          x: at.x + (before.x - at.x) * ratio,
          y: at.y + (before.y - at.y) * ratio,
        },
        natural,
        area,
      );
      return { ...current, zoom, x: next.x, y: next.y };
    });
  }
  function center(zoom: number | null) {
    setView((current) => ({ ...current, zoom, x: 0, y: 0 }));
  }
  function rotate(by: number) {
    setView((current) => ({
      ...current,
      angle: (current.angle + by) % 360,
      x: 0,
      y: 0,
    }));
  }
  function pan(x: number, y: number) {
    setView((current) => {
      const next = imageLayout({ ...current, x, y }, natural, area);
      return { ...current, x: next.x, y: next.y };
    });
  }
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !isImage ||
      !showTools ||
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target as Element).closest(".media-viewer-inspector")
    )
      return;
    closeImageMenu();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: layout.x,
      top: layout.y,
    };
    setDragging(true);
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (start?.id === event.pointerId)
      pan(
        start.left + event.clientX - start.x,
        start.top + event.clientY - start.y,
      );
  }
  function pointerEnd() {
    drag.current = undefined;
    setDragging(false);
  }
  function windowAction(action: MediaWindowAction) {
    void api
      .window(action)
      .catch((error) => setMessage(desktopErrorMessage(error)));
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      setMessage(desktopErrorMessage(error));
    }
  }
  function togglePlayback() {
    if (!player || !showTools) return;
    if (player.paused) {
      void player.play().catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setMessage(desktopErrorMessage(error));
      });
    } else {
      player.pause();
    }
  }
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      if (await api.save()) setMessage(t("已保存原文件。"));
    } catch (error) {
      setMessage(desktopErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  async function copyImage() {
    const element = image.current;
    if (!element) return;
    try {
      if (natural.width * natural.height > 40_000_000)
        throw new Error(t("图片过大，无法复制到剪贴板。"));
      const canvas = document.createElement("canvas");
      canvas.width = natural.width;
      canvas.height = natural.height;
      canvas.getContext("2d")?.drawImage(element, 0, 0);
      const png = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!png || png.size > 64 * 1024 * 1024)
        throw new Error(t("无法复制图片。"));
      await api.copyImage(new Uint8Array(await png.arrayBuffer()));
      setMessage(t("图片已复制。"));
    } catch (error) {
      setMessage(desktopErrorMessage(error));
    }
  }
  function metadata(element: HTMLMediaElement) {
    if (element instanceof HTMLVideoElement)
      setNatural({ width: element.videoWidth, height: element.videoHeight });
    setReady(true);
  }
  const fileTools = (
    <>
      {!isAttachment && !failed && (
        <Tool
          label={t("附件详情")}
          pressed={details}
          onClick={() => setDetails(!details)}
        >
          <Info size={18} />
        </Tool>
      )}
      <Tool
        label={isAttachment || failed ? t("提取原文件") : t("另存原文件")}
        shortcut="Ctrl+S"
        onClick={() => void save()}
        disabled={saving}
      >
        <Download size={18} />
      </Tool>
      <Tool
        label={fullscreen ? t("退出全屏") : t("全屏显示")}
        shortcut="F11"
        onClick={() => void toggleFullscreen()}
      >
        {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
      </Tool>
    </>
  );

  return (
    <main
      className="media-viewer"
      data-kind={info.kind}
      data-fullscreen={fullscreen}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        const key = event.key.toLowerCase();
        if (
          isImage &&
          showTools &&
          event.target === stage.current &&
          (key === "contextmenu" || (key === "f10" && event.shiftKey))
        ) {
          event.preventDefault();
          const box = stage.current.getBoundingClientRect();
          setImageMenu({
            x: box.left + box.width / 2,
            y: box.top + box.height / 2,
            keyboard: true,
          });
          return;
        }
        if (key === "f11" || (key === "escape" && document.fullscreenElement)) {
          event.preventDefault();
          void toggleFullscreen();
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          if (key === "s" && !saving) {
            event.preventDefault();
            void save();
          } else if (
            key === "c" &&
            isImage &&
            showTools &&
            !window.getSelection()?.toString()
          ) {
            event.preventDefault();
            void copyImage();
          }
          return;
        }
        if (failed) return;
        if (event.altKey) return;
        if (isImage && showTools) {
          if (key === "+" || key === "=") changeZoom(1.2);
          else if (key === "-") changeZoom(1 / 1.2);
          else if (key === "0") center(null);
          else if (key === "1") center(1);
          else if (key === "r") rotate(event.shiftKey ? -90 : 90);
          else if (key === "arrowleft") pan(layout.x + 48, layout.y);
          else if (key === "arrowright") pan(layout.x - 48, layout.y);
          else if (key === "arrowup") pan(layout.x, layout.y + 48);
          else if (key === "arrowdown") pan(layout.x, layout.y - 48);
          else return;
          event.preventDefault();
        } else if (
          player &&
          !(event.target as Element).closest(
            "button,input,select,[role=slider]",
          )
        ) {
          if (key === " ") {
            togglePlayback();
          } else if (
            (key === "arrowleft" || key === "arrowright") &&
            Number.isFinite(player.duration)
          ) {
            player.currentTime = clamp(
              player.currentTime + (key === "arrowleft" ? -5 : 5),
              0,
              player.duration,
            );
          } else return;
          event.preventDefault();
        }
      }}
      ref={(element) => {
        if (element && document.activeElement === document.body)
          element.focus({ preventScroll: true });
      }}
    >
      <header className="media-viewer-titlebar">
        <MediaIcon className="media-viewer-kind" size={17} aria-hidden="true" />
        <div className="media-viewer-filename">
          <h1 title={info.path}>{info.name}</h1>
          <p>
            {new Intl.NumberFormat(appLocale(), {
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(info.bytes)}{" "}
            {t("字节")}
            {natural.width > 0 && ` · ${natural.width} × ${natural.height}`}
          </p>
        </div>
        <div className="window-controls">
          <button
            type="button"
            aria-label={t("最小化")}
            title={t("最小化")}
            onClick={() => windowAction("minimize")}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            aria-label={maximized ? t("还原") : t("最大化")}
            title={maximized ? t("还原") : t("最大化")}
            onClick={() => windowAction("maximize")}
          >
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button
            type="button"
            className="window-close"
            aria-label={t("关闭窗口")}
            title={t("关闭窗口")}
            onClick={() => windowAction("close")}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <footer className="media-viewer-toolbar">
        {isPlayer && !failed ? (
          <MediaPlaybackBar
            player={player}
            ready={showTools}
            onTogglePlayback={togglePlayback}
          >
            {fileTools}
          </MediaPlaybackBar>
        ) : (
          <div
            className="media-viewer-tools"
            role="toolbar"
            aria-label={t("媒体查看工具")}
          >
            {isImage && (
              <>
                <div className="media-viewer-tool-group">
                  <Tool
                    label={t("缩小图片")}
                    shortcut="-"
                    onClick={() => changeZoom(1 / 1.2)}
                    disabled={!showTools}
                  >
                    <ZoomOut size={18} />
                  </Tool>
                  <output className="media-viewer-zoom">
                    {Math.max(1, Math.round(layout.zoom * 100))}%
                  </output>
                  <Tool
                    label={t("放大图片")}
                    shortcut="+"
                    onClick={() => changeZoom(1.2)}
                    disabled={!showTools}
                  >
                    <ZoomIn size={18} />
                  </Tool>
                  <Tool
                    label={t("适应窗口")}
                    shortcut="0"
                    onClick={() => center(null)}
                    pressed={view.zoom === null}
                    disabled={!showTools}
                  >
                    <Scan size={18} />
                  </Tool>
                  <Tool
                    label={t("实际大小")}
                    shortcut="1"
                    onClick={() => center(1)}
                    pressed={view.zoom === 1}
                    disabled={!showTools}
                  >
                    <span className="media-viewer-actual">1:1</span>
                  </Tool>
                </div>
                <div className="media-viewer-tool-group">
                  <Tool
                    label={t("向左旋转")}
                    shortcut="Shift+R"
                    onClick={() => rotate(-90)}
                    disabled={!showTools}
                  >
                    <RotateCcw size={18} />
                  </Tool>
                  <Tool
                    label={t("向右旋转")}
                    shortcut="R"
                    onClick={() => rotate(90)}
                    disabled={!showTools}
                  >
                    <RotateCw size={18} />
                  </Tool>
                  <Tool
                    label={t("水平翻转")}
                    onClick={() =>
                      setView((current) => ({
                        ...current,
                        mirrored: !current.mirrored,
                      }))
                    }
                    pressed={view.mirrored}
                    disabled={!showTools}
                  >
                    <FlipHorizontal2 size={18} />
                  </Tool>
                </div>
              </>
            )}
            <div className="media-viewer-tool-group">
              {isImage && (
                <Tool
                  label={t("复制图片")}
                  shortcut="Ctrl+C"
                  onClick={() => void copyImage()}
                  disabled={!showTools}
                >
                  <Copy size={18} />
                </Tool>
              )}
              {fileTools}
            </div>
          </div>
        )}
      </footer>
      <div
        ref={stage}
        className="media-viewer-stage"
        tabIndex={isImage && showTools ? 0 : undefined}
        role={isImage && showTools ? "region" : undefined}
        aria-label={isImage && showTools ? t("图片查看器") : undefined}
        data-audio={(info.kind === "audio" && !failed) || undefined}
        data-pan={isImage && showTools}
        data-dragging={dragging}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onLostPointerCapture={pointerEnd}
        onContextMenu={(event) => {
          if (
            !isImage ||
            !showTools ||
            (event.target as Element).closest(".media-viewer-inspector")
          )
            return;
          event.preventDefault();
          setImageMenu({ x: event.clientX, y: event.clientY, keyboard: false });
        }}
        onDoubleClick={(event) => {
          if (
            isImage &&
            showTools &&
            !(event.target as Element).closest(".media-viewer-inspector")
          ) {
            event.preventDefault();
            center(view.zoom === null ? 1 : null);
          }
        }}
      >
        {isAttachment || failed ? (
          <div
            className="media-viewer-status"
            role={failed ? "alert" : undefined}
          >
            {isAttachment ? (
              <File size={32} aria-hidden="true" />
            ) : isImage ? (
              <ImageOff size={32} />
            ) : isVideo ? (
              <VideoOff size={32} />
            ) : (
              <AudioLines size={32} />
            )}
            {failed && (
              <strong>
                {t("不支持此媒体格式或编解码器，文件也可能已损坏。")}
              </strong>
            )}
            <AttachmentDetails info={info} />
            {info.text !== undefined && (
              <>
                {info.truncated && (
                  <small>{t("仅显示文件开头，提取时保留完整内容。")}</small>
                )}
                <pre className="media-viewer-text" tabIndex={0}>
                  {info.text}
                </pre>
              </>
            )}
          </div>
        ) : isImage ? (
          <img
            ref={image}
            crossOrigin="anonymous"
            src={info.src!}
            alt={info.name}
            draggable={false}
            hidden={!ready}
            style={{
              width: natural.width || undefined,
              height: natural.height || undefined,
              transform: `translate(-50%, -50%) translate(${layout.x}px, ${layout.y}px) rotate(${view.angle}deg) scale(${view.mirrored ? -layout.zoom : layout.zoom}, ${layout.zoom})`,
            }}
            onLoad={({ currentTarget }) => {
              setNatural({
                width: currentTarget.naturalWidth,
                height: currentTarget.naturalHeight,
              });
              setReady(true);
            }}
            onError={() => setFailed(true)}
          />
        ) : isVideo ? (
          <video
            ref={attachPlayer}
            src={info.src!}
            playsInline
            preload="metadata"
            onClick={togglePlayback}
            onLoadedMetadata={(event) => metadata(event.currentTarget)}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="media-viewer-audio">
            <span className="media-viewer-audio-art" aria-hidden="true">
              <AudioLines size={44} strokeWidth={1.5} />
            </span>
            <strong title={info.name}>{info.name}</strong>
            <audio
              ref={attachPlayer}
              src={info.src!}
              preload="metadata"
              hidden
              onLoadedMetadata={(event) => metadata(event.currentTarget)}
              onError={() => setFailed(true)}
            />
          </div>
        )}
        {!ready && !failed && !isAttachment && (
          <span className="media-viewer-loading" role="status">
            {t("正在加载媒体…")}
          </span>
        )}
        {details && !failed && (
          <aside
            className="media-viewer-status media-viewer-inspector"
            aria-label={t("附件详情")}
          >
            <AttachmentDetails info={info} />
          </aside>
        )}
        {message && (
          <div className="media-viewer-message" role="status">
            {message}
          </div>
        )}
      </div>
      {imageMenu && (
        <EditorMenu
          x={imageMenu.x}
          y={imageMenu.y}
          ariaLabel={t("图片查看菜单")}
          focusFirst={imageMenu.keyboard}
          onClose={closeImageMenu}
          items={[
            {
              id: "fit",
              label: t("适应窗口"),
              shortcut: "0",
              run: () => center(null),
            },
            {
              id: "actual",
              label: t("实际大小"),
              shortcut: "1",
              run: () => center(1),
            },
            {
              id: "reset",
              label: t("重置视图"),
              run: () => setView(initialView),
            },
            {
              id: "copy",
              label: t("复制图片"),
              separator: true,
              run: () => void copyImage(),
            },
            {
              id: "save",
              label: t("另存原文件"),
              disabled: saving,
              run: () => void save(),
            },
          ]}
        />
      )}
    </main>
  );
}

const root = createRoot(document.getElementById("app")!);
const api = window.mardikorMedia;
if (api) {
  try {
    const info = await api.info();
    setAppLocale(info.locale);
    document.documentElement.lang = info.locale;
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const setTheme = () => {
      document.documentElement.dataset.appTheme =
        info.theme === "system"
          ? scheme.matches
            ? "dark"
            : "light"
          : info.theme;
    };
    setTheme();
    if (info.theme === "system") scheme.addEventListener("change", setTheme);
    root.render(<MediaViewer info={info} api={api} />);
  } catch (error) {
    root.render(<p role="alert">{desktopErrorMessage(error)}</p>);
  }
} else {
  root.render(<p role="alert">{t("请通过桌面应用打开工程。")}</p>);
}
