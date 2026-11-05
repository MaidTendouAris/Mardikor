import { ChevronLeft, ChevronRight, File } from "lucide-react";
import type { MdkSettings, ProjectFile } from "../../shared/mdk";
export function MediaPreview({
  current,
  data,
  files,
  onSelect,
}: {
  file: string;
  current: ProjectFile;
  data: string;
  files: ProjectFile[];
  settings: MdkSettings;
  mode: string;
  onSelect: (path: string) => void;
}) {
  const images = files
      .filter((f) => /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(f.path))
      .sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { numeric: true }),
      ),
    index = images.findIndex((f) => f.path === current.path);
  return (
    <div className="resource-preview">
      <div className="media-toolbar">
        <strong>{current.path}</strong>
        {index >= 0 && (
          <div className="button-row">
            <button
              className="icon-button"
              aria-label="上一图片"
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
              aria-label="下一图片"
              disabled={index >= images.length - 1}
              onClick={() => onSelect(images[index + 1].path)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      {data.startsWith("data:image/") ? (
        <div className="image-pages single">
          <img src={data} alt={current.path} />
        </div>
      ) : data.startsWith("data:audio/") ? (
        <audio src={data} controls />
      ) : data.startsWith("data:video/") ? (
        <video src={data} controls />
      ) : (
        <div className="binary-file-info">
          <File size={32} />
          <p>二进制附件，仅显示文件信息。</p>
          <dl>
            <dt>路径</dt>
            <dd>{current.path}</dd>
            <dt>大小</dt>
            <dd>{current.bytes.toLocaleString()} 字节</dd>
            <dt>类型</dt>
            <dd>{data.match(/^data:([^;]+)/)?.[1] ?? "不透明附件"}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
