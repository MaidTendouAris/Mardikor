import { appLocale, t } from "../../shared/i18n";
import { ChevronLeft, ChevronRight, File } from "lucide-react";
import type { ProjectFile } from "../../shared/mdk";
import { previewMediaKind, previewMediaMime } from "../../shared/media-viewer";
import { MediaPlayer } from "./MediaPlayer";
export function MediaPreview({
  file,
  current,
  data,
  files,
  view,
  onSelect,
}: {
  file: string;
  current: ProjectFile;
  data: string;
  files: ProjectFile[];
  view?: { label: string; open: () => void };
  onSelect: (path: string) => void;
}) {
  const images = files
      .filter(
        (f) =>
          f.kind !== "directory" &&
          previewMediaMime(f.path)?.startsWith("image/"),
      )
      .sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { numeric: true }),
      ),
    index = images.findIndex((f) => f.path === current.path);
  const kind = previewMediaKind(previewMediaMime(current.path) ?? data.match(/^data:([^;]+)/)?.[1]);
  return (
    <div className="resource-preview">
      <div className="media-toolbar">
        <strong title={current.path}>{current.path}</strong>
        {view && (
          <button type="button" className="button small" onClick={view.open}>
            {view.label}
          </button>
        )}
        {index >= 0 && (
          <div className="button-row">
            <button
              className="icon-button"
              aria-label={t("上一图片")}
              disabled={index === 0}
              onClick={() => onSelect(images[index - 1].path)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {index + 1} / {images.length}
            </span>
            <button
              className="icon-button"
              aria-label={t("下一图片")}
              disabled={index >= images.length - 1}
              onClick={() => onSelect(images[index + 1].path)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      {kind === "audio" || kind === "video" ? (
        <MediaPlayer key={JSON.stringify([file, current.path])} file={file} path={current.path} kind={kind} />
      ) : data.startsWith("data:image/") ? (
        <div className="image-pages single">
          <img src={data} alt={current.path} />
        </div>
      ) : (
        <div className="binary-file-info">
          <File size={32} />
          <p>{t("二进制附件，仅显示文件信息。")}</p>
          <dl>
            <dt>{t("路径")}</dt>
            <dd>{current.path}</dd>
            <dt>{t("大小")}</dt>
            <dd>
              {current.bytes.toLocaleString(appLocale())} {t("字节")}
            </dd>
            <dt>{t("类型")}</dt>
            <dd>{data.match(/^data:([^;]+)/)?.[1] ?? t("不透明附件")}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
