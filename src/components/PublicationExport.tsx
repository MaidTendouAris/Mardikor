import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileCheck2,
  RefreshCw,
  Save,
  TriangleAlert,
} from "lucide-react";
import { Select } from "./Select";
import { desktop } from "../services/desktop";
import type { Notify } from "../App";
import type {
  PublicationConfiguration,
  PublicationFormat,
  PublicationInfo,
  PublicationPlan,
} from "../../shared/publication";

export function PublicationExport({
  file,
  flush,
  notify,
  onConfigured,
}: {
  file: string;
  flush: () => Promise<boolean>;
  notify: Notify;
  onConfigured: (file: string) => Promise<void>;
}) {
  const [info, setInfo] = useState<PublicationInfo | null>(null),
    [draft, setDraft] = useState<PublicationConfiguration | null>(null),
    [format, setFormat] = useState<PublicationFormat>("pdf"),
    [changed, setChanged] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [plan, setPlan] = useState<PublicationPlan | null>(null);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    let active = true;
    setInfo(null);
    setDraft(null);
    setError("");
    setPlan(null);
    setChanged(false);
    setFormat("pdf");
    if (file) {
      setBusy(true);
      void (async () => {
        if (!(await flushRef.current()))
          throw new Error("请先保存或修复编辑缓冲区。");
        return desktop().invoke("publicationInfo", file);
      })()
        .then((value) => {
          if (active) {
            setInfo(value);
            setDraft(value.configuration);
          }
        })
        .catch((error) => {
          if (active) setError(String(error));
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }
    return () => {
      active = false;
    };
  }, [file]);
  const change = (mutate: (value: PublicationConfiguration) => void) => {
    setDraft((old) => {
      if (!old) return old;
      const next = structuredClone(old);
      mutate(next);
      return next;
    });
    setChanged(true);
    setPlan(null);
  };
  async function reload() {
    setBusy(true);
    try {
      const value = await desktop().invoke("publicationInfo", file);
      setInfo(value);
      setDraft(value.configuration);
      setChanged(false);
      setPlan(null);
      setError("");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  const needsSave =
    !!info &&
    !!draft &&
    (changed ||
      !info.saved ||
      (!info.standalone &&
        format === "pdf" &&
        draft.appearance.font_family === "system"));
  async function persistConfiguration() {
    if (!draft || !info) return;
    const current = await desktop().invoke("publicationInfo", file);
    if (
      current.revision !== info.revision &&
      (current.mode !== info.mode ||
        current.saved !== info.saved ||
        JSON.stringify(current.configuration) !==
          JSON.stringify(info.configuration))
    )
      throw new Error("工程导出设置已变化，请重新读取配置后再保存。");
    const value = await desktop().invoke(
      "configurePublication",
      file,
      draft,
      current.revision,
      format,
    );
    setInfo(value);
    setDraft(value.configuration);
    setChanged(false);
    setPlan(null);
    await onConfigured(file);
    return value;
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (!(await flush())) return;
      const value = await persistConfiguration();
      if (!value) return;
      notify(
        value.standalone
          ? "导出配置已保存在本机，Markdown 原文件保持不变。"
          : "导出配置已保存至工程。",
      );
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function perform(exporting: boolean) {
    if (!info || !draft) return;
    setBusy(true);
    setError("");
    try {
      if (!(await flush())) return;
      if (needsSave) await persistConfiguration();
      const result = await desktop().invoke("planPublication", file, format);
      setPlan(result);
      if (!result.report.valid || !exporting) return;
      const name =
        draft.publication.metadata.title.replace(/[\\/:<>"|?*]/g, "_") +
        "." +
        format;
      const output = await desktop().dialog(
        format === "pdf" ? "save-pdf" : "save-epub",
        name,
      );
      if (!output) return;
      const exported = await desktop().invoke(
        "exportPublication",
        file,
        output,
        format,
        result.fingerprint,
      );
      notify(
        `${format.toUpperCase()} 已导出${exported.pages ? `，共 ${exported.pages} 页` : ""}。`,
      );
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  const text = (
    label: string,
    value: string,
    update: (value: string) => void,
    placeholder?: string,
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => update(event.target.value)}
      />
    </label>
  );
  const number = (
    label: string,
    value: number,
    update: (value: number) => void,
    min = 0,
    factor = 1,
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        step="any"
        value={
          Number.isFinite(value)
            ? Math.round(value * factor * 100000) / 100000
            : ""
        }
        onChange={(event) =>
          update(
            event.target.value === ""
              ? NaN
              : Number(event.target.value) / factor,
          )
        }
      />
    </label>
  );
  const check = (
    label: string,
    value: boolean,
    update: (value: boolean) => void,
    disabled = false,
  ) => (
    <label className="publication-check">
      <input
        type="checkbox"
        disabled={disabled}
        checked={value}
        onChange={(event) => update(event.target.checked)}
      />
      {label}
    </label>
  );
  const choose = (
    label: string,
    value: string,
    values: [string, string][],
    update: (value: string) => void,
    disabled = false,
  ) => (
    <label>
      {label}
      <Select
        aria-label={label}
        value={value}
        disabled={busy || disabled}
        onValueChange={update}
      >
        {values.map(([value, title]) => (
          <option key={value} value={value}>
            {title}
          </option>
        ))}
      </Select>
    </label>
  );
  const allowedEpub = !!info && ["01", "02"].includes(info.mode);
  const paperSizes = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] };
  const paperPreset =
    Object.entries(paperSizes).find(
      ([, dimensions]) =>
        draft &&
        Math.abs(
          ((draft.publication.pdf.page_width ?? draft.layout.page_width) *
            25.4) /
            96 -
            dimensions[0],
        ) < 0.001 &&
        Math.abs(
          (draft.publication.pdf.page_height * 25.4) / 96 - dimensions[1],
        ) < 0.001,
    )?.[0] ?? "current";
  if (!file) return null;
  return (
    <section className="publication-export" aria-label="PDF 与 EPUB 导出">
      <div className="section-heading">
        <h2>出版导出</h2>
        <button
          className="button small"
          disabled={busy}
          onClick={() => void reload()}
        >
          <RefreshCw size={14} />
          重新读取配置
        </button>
      </div>
      {error && (
        <p role="alert" className="publication-error">
          {error}
        </p>
      )}
      {!draft || !info ? (
        <p>{busy ? "正在读取导出设置…" : "请修复控制文件或重新读取配置。"}</p>
      ) : (
        <>
          <div className="publication-actions">
            <Select
              aria-label="出版导出格式"
              value={format}
              disabled={busy}
              onValueChange={(value) => {
                setFormat(value as PublicationFormat);
                setPlan(null);
              }}
            >
              <option value="pdf">PDF 文档</option>
              <option value="epub" disabled={!allowedEpub}>
                EPUB 3 电子书{!allowedEpub ? "（仅 book / comic）" : ""}
              </option>
            </Select>
            <button
              className="button"
              disabled={busy}
              onClick={() => void save()}
            >
              <Save size={15} />
              {info.standalone ? "保存本机导出配置" : "保存导出配置至工程"}
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void perform(false)}
            >
              <FileCheck2 size={15} />
              {needsSave ? "保存并预检" : "严格预检"}
            </button>
            <button
              className="button primary"
              disabled={busy}
              aria-describedby={
                needsSave ? "publication-save-required" : undefined
              }
              onClick={() => void perform(true)}
            >
              <Download size={15} />
              {needsSave ? "保存并导出" : "导出"} {format.toUpperCase()}
            </button>
          </div>
          {needsSave && (
            <p
              id="publication-save-required"
              className="publication-preflight"
              role="status"
            >
              执行预检或导出时会先保存当前配置。
            </p>
          )}
          {busy && (
            <p role="status" className="publication-note">
              正在处理导出任务，请稍候…
            </p>
          )}
          <p className="publication-note">
            {info.standalone
              ? "单 Markdown 仅导出 PDF；配置保存在本机，不产生 settings.toml。"
              : format === "pdf"
                ? "PDF 配置与固定字体随 MDK 分发，可在其他电脑复现导出。"
                : "EPUB 配置保存在 settings.toml，内置字体的子集直接写入电子书。"}
          </p>
          {plan && (
            <p className="publication-preflight" role="status">
              {plan.report.valid ? "严格预检通过" : "严格预检未通过"} ·{" "}
              {
                plan.report.issues.filter((issue) => issue.severity === "error")
                  .length
              }{" "}
              个错误 ·{" "}
              {
                plan.report.issues.filter(
                  (issue) => issue.severity === "warning",
                ).length
              }{" "}
              个警告 <a href="#publication-report">查看详情</a>
            </p>
          )}
          <fieldset disabled={busy}>
            <details open>
              <summary>作品信息与封面</summary>
              <div className="publication-fields">
                {(
                  [
                    ["title", "作品标题"],
                    ["author", "作者"],
                    ["language", "语言"],
                    ["identifier", "出版物标识"],
                    ["modified", "出版日期（UTC）"],
                    ["publisher", "出版者"],
                    ["rights", "版权说明"],
                    ["description", "作品简介"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    {text(
                      label,
                      draft.publication.metadata[key],
                      (value) =>
                        change((c) => {
                          c.publication.metadata[key] = value;
                        }),
                      key === "identifier"
                        ? "留空时生成固定 UUID"
                        : key === "modified"
                          ? "2026-11-04T00:00:00Z"
                          : undefined,
                    )}
                  </div>
                ))}
                {choose(
                  "封面资源",
                  draft.publication.metadata.cover || "none",
                  [
                    ["none", "不设置封面"],
                    ...info.images.map(
                      (path) => [path, path] as [string, string],
                    ),
                  ],
                  (value) =>
                    change((c) => {
                      c.publication.metadata.cover =
                        value === "none" ? "" : value;
                    }),
                )}
              </div>
            </details>
            <details open>
              <summary>排版与字体</summary>
              <div className="publication-fields">
                {choose(
                  "导出字体",
                  draft.appearance.font_family,
                  [
                    ["system", "Noto Sans CJK SC（内置，保存时嵌入工程）"],
                    ...info.fonts.map(
                      (path) => [path, path] as [string, string],
                    ),
                    ...(!info.fonts.includes(draft.appearance.font_family) &&
                    draft.appearance.font_family !== "system"
                      ? [
                          [
                            draft.appearance.font_family,
                            draft.appearance.font_family,
                          ] as [string, string],
                        ]
                      : []),
                  ],
                  (value) =>
                    change((c) => {
                      c.appearance.font_family = value;
                    }),
                )}
                {number(
                  "正文字号（px）",
                  draft.appearance.font_size,
                  (value) =>
                    change((c) => {
                      c.appearance.font_size = value;
                    }),
                  0.1,
                )}
                {number(
                  "正文行高",
                  draft.appearance.line_height,
                  (value) =>
                    change((c) => {
                      c.appearance.line_height = value;
                    }),
                  0.1,
                )}
                {number(
                  "段间距（em）",
                  draft.appearance.paragraph_spacing,
                  (value) =>
                    change((c) => {
                      c.appearance.paragraph_spacing = value;
                    }),
                )}
                {(
                  [
                    ["text", "正文颜色"],
                    ["background", "纸张背景"],
                    ["link", "链接颜色"],
                    ["quote", "引用颜色"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    {text(label, draft.colors[key], (value) =>
                      change((c) => {
                        c.colors[key] = value;
                      }),
                    )}
                  </div>
                ))}
                {number(
                  "目录标题深度",
                  draft.book.toc_depth,
                  (value) =>
                    change((c) => {
                      c.book.toc_depth = value;
                    }),
                  1,
                )}
                {check("书籍章节编号", draft.book.chapter_numbering, (value) =>
                  change((c) => {
                    c.book.chapter_numbering = value;
                  }),
                )}
                {check(
                  "渲染 note / warning / tip 容器",
                  draft.render_containers,
                  (value) =>
                    change((c) => {
                      c.render_containers = value;
                    }),
                )}
              </div>
              <p className="publication-note">
                PDF
                使用工程内字体并校验全部字形，不回退到系统字体。自定义字体须允许分发与嵌入。字号和行距等通用选项同时用于工程排版。
              </p>
            </details>
            <details open>
              <summary>PDF 纸张 / EPUB 固定画布</summary>
              <div className="publication-fields">
                {choose(
                  "纸张预设",
                  paperPreset,
                  [
                    ["current", "当前自定义尺寸"],
                    ["A4", "A4 · 210 × 297 mm"],
                    ["A5", "A5 · 148 × 210 mm"],
                    ["Letter", "Letter · 215.9 × 279.4 mm"],
                  ],
                  (value) =>
                    change((c) => {
                      const dimensions: Record<string, number[]> = {
                        A4: [210, 297],
                        A5: [148, 210],
                        Letter: [215.9, 279.4],
                      };
                      if (dimensions[value]) {
                        c.publication.pdf.page_width =
                          (dimensions[value][0] / 25.4) * 96;
                        c.publication.pdf.page_height =
                          (dimensions[value][1] / 25.4) * 96;
                      }
                    }),
                )}
                {number(
                  "纸张宽度（mm）",
                  draft.publication.pdf.page_width ?? draft.layout.page_width,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.page_width = value;
                    }),
                  25.4,
                  25.4 / 96,
                )}
                {number(
                  "纸张高度（mm）",
                  draft.publication.pdf.page_height,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.page_height = value;
                    }),
                  25.4,
                  25.4 / 96,
                )}
                {(
                  [
                    ["margin_top", "上边距（mm）"],
                    ["margin_bottom", "下边距（mm）"],
                    ["margin_left", "左边距（mm）"],
                    ["margin_right", "右边距（mm）"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    {number(
                      label,
                      draft.layout[key],
                      (value) =>
                        change((c) => {
                          c.layout[key] = value;
                        }),
                      0,
                      25.4 / 96,
                    )}
                  </div>
                ))}
              </div>
            </details>
            <details open={format === "pdf"}>
              <summary>PDF 选项</summary>
              <div className="publication-fields">
                {check(
                  "PDF 横向纸张",
                  draft.publication.pdf.landscape,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.landscape = value;
                    }),
                )}
                {check(
                  "打印背景色",
                  draft.publication.pdf.print_background,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.print_background = value;
                    }),
                )}
                {check("灰度输出", draft.publication.pdf.grayscale, (value) =>
                  change((c) => {
                    c.publication.pdf.grayscale = value;
                  }),
                )}
                {check(
                  "生成无障碍标签",
                  draft.publication.pdf.tagged,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.tagged = value;
                    }),
                )}
                {check(
                  "按标题生成 PDF 书签",
                  draft.publication.pdf.outline,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.outline = value;
                    }),
                )}
                {check(
                  "PDF 插入封面页",
                  draft.publication.pdf.include_cover,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.include_cover = value;
                    }),
                )}
                {check(
                  "PDF 插入目录",
                  draft.publication.pdf.include_toc,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.include_toc = value;
                    }),
                )}
                {choose(
                  "章节分页",
                  info.mode === "02"
                    ? "page"
                    : draft.publication.pdf.chapter_break,
                  [
                    ["none", "连续排版"],
                    ["page", "每篇另起一页"],
                    ["right", "每篇从右页开始"],
                  ],
                  (value) =>
                    change((c) => {
                      c.publication.pdf.chapter_break = value as
                        "none" | "page" | "right";
                    }),
                  info.mode === "02",
                )}
                {number(
                  "PDF 缩放",
                  draft.publication.pdf.scale,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.scale = value;
                    }),
                  0.25,
                )}
                {text(
                  "PDF 页码范围",
                  draft.publication.pdf.page_ranges,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.page_ranges = value;
                    }),
                  "留空导出全部，例如 1-3,5",
                )}
                {number(
                  "起始页码",
                  draft.publication.pdf.first_page_number,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.first_page_number = value;
                    }),
                  1,
                )}
                {number(
                  "页眉页脚字号（px）",
                  draft.publication.pdf.furniture_size,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.furniture_size = value;
                    }),
                  6,
                )}
                {text("页眉", draft.publication.pdf.header, (value) =>
                  change((c) => {
                    c.publication.pdf.header = value;
                  }),
                )}
                {text("页脚", draft.publication.pdf.footer, (value) =>
                  change((c) => {
                    c.publication.pdf.footer = value;
                  }),
                )}
                {check(
                  "空页脚时自动显示页码",
                  draft.publication.pdf.page_numbers,
                  (value) =>
                    change((c) => {
                      c.publication.pdf.page_numbers = value;
                    }),
                )}
              </div>
              <p className="publication-note">
                页眉页脚支持 {"{title}、{author}、{page}、{pages}"}
                ；选定页码范围时保留完整文档中的页码，总页数表示全文页数。漫画按实际目录项分单页
                / 双页，内容超出固定页面时拒绝导出。
              </p>
              <details>
                <summary>跨电脑复现信息</summary>
                <p className="publication-engine">
                  固定渲染版本：
                  {draft.publication.pdf.engine || "保存配置时记录当前版本"}
                  <br />
                  当前版本：{info.engine}
                  <br />
                  字体 SHA-256：
                  {draft.publication.pdf.font_sha256 || "保存配置时记录"}
                </p>
              </details>
              <p className="publication-note">
                重新保存会明确采用当前渲染版本与字体摘要；已有配置不匹配时不会自动替换。
              </p>
            </details>
            {allowedEpub && (
              <details open={format === "epub"}>
                <summary>EPUB 转换选项</summary>
                <div className="publication-fields">
                  {choose(
                    "EPUB 版式",
                    draft.publication.epub.layout,
                    info.mode === "02"
                      ? [["pre-paginated", "固定版式（漫画）"]]
                      : [
                          ["reflowable", "可重排版式（书籍）"],
                          ["pre-paginated", "固定版式"],
                        ],
                    (value) =>
                      change((c) => {
                        c.publication.epub.layout = value as
                          "reflowable" | "pre-paginated";
                      }),
                  )}
                  {choose(
                    "EPUB 翻页方向",
                    info.mode === "02"
                      ? draft.comic.reading_direction
                      : draft.publication.epub.direction,
                    [
                      ["ltr", "从左到右"],
                      ["rtl", "从右到左"],
                    ],
                    (value) =>
                      change((c) => {
                        if (info.mode === "02")
                          c.comic.reading_direction = value;
                        else
                          c.publication.epub.direction = value as "ltr" | "rtl";
                      }),
                  )}
                  {check(
                    "EPUB 嵌入字体（固定版式强制嵌入）",
                    draft.publication.epub.layout === "pre-paginated" ||
                      draft.publication.epub.embed_font,
                    (value) =>
                      change((c) => {
                        c.publication.epub.embed_font = value;
                      }),
                    draft.publication.epub.layout === "pre-paginated",
                  )}
                  {check(
                    "将导航目录加入阅读顺序",
                    draft.publication.epub.toc_in_spine,
                    (value) =>
                      change((c) => {
                        c.publication.epub.toc_in_spine = value;
                      }),
                  )}
                  {check(
                    "EPUB 插入封面",
                    draft.publication.epub.include_cover,
                    (value) =>
                      change((c) => {
                        c.publication.epub.include_cover = value;
                      }),
                  )}
                </div>
                <p className="publication-note">
                  EPUB 3
                  转换执行前严格检查容器、控制文件、阅读顺序、链接锚点、字体和资源兼容性。原始
                  HTML
                  按文本显示。外部媒体、附件链接和不兼容图片须先处理；生成后再次检查
                  XHTML、manifest、spine 和导航。
                </p>
              </details>
            )}
            {info.mode === "02" && (
              <details open>
                <summary>漫画页面</summary>
                <div className="publication-fields">
                  {choose(
                    "漫画页面排列",
                    draft.comic.spread_mode,
                    [
                      ["single", "单页"],
                      ["double", "双页"],
                    ],
                    (value) =>
                      change((c) => {
                        c.comic.spread_mode = value;
                      }),
                  )}
                  {choose(
                    "漫画阅读方向",
                    draft.comic.reading_direction,
                    [
                      ["ltr", "从左到右"],
                      ["rtl", "从右到左"],
                    ],
                    (value) =>
                      change((c) => {
                        c.comic.reading_direction = value;
                      }),
                  )}
                  {choose(
                    "漫画图片适应",
                    draft.comic.page_fit,
                    [
                      ["contain", "完整显示"],
                      ["cover", "填充裁切"],
                      ["width", "宽度适应"],
                    ],
                    (value) =>
                      change((c) => {
                        c.comic.page_fit = value;
                      }),
                  )}
                </div>
              </details>
            )}
          </fieldset>
          {plan && (
            <div
              className="publication-report"
              id="publication-report"
              role="region"
              aria-label="出版转换校验结果"
            >
              <strong>
                {plan.report.valid ? "严格预检通过" : "严格预检未通过"} ·{" "}
                {plan.chapters} 篇文稿
              </strong>
              {plan.report.issues.map((issue, index) => (
                <div className={`issue ${issue.severity}`} key={index}>
                  <TriangleAlert size={16} />
                  <div>
                    <strong>
                      {issue.path ?? "出版转换"}
                      <code>{issue.code}</code>
                    </strong>
                    <p>{issue.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
