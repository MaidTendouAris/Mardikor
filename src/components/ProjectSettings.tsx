import { Save, FileCode2 } from "lucide-react";
import type { MdkSettings } from "../../shared/mdk";
import type { Table } from "../../shared/schema";
import { Select } from "./Select";
import { FontCombobox } from "./FontCombobox";

type Field = {
  path: string;
  label: string;
  type?: "number" | "boolean" | "color";
  min?: number;
  max?: number;
  step?: number;
  choices?: [string, string][];
};
const groups: { title: string; note?: string; fields: Field[] }[] = [
  {
    title: "外观",
    fields: [
      {
        path: "appearance.theme",
        label: "文稿主题",
        choices: [["default", "默认"]],
      },
      { path: "appearance.font_family", label: "字体" },
      {
        path: "appearance.font_size",
        label: "字号",
        type: "number",
        min: 0.1,
        step: 0.1,
      },
      {
        path: "appearance.line_height",
        label: "行高",
        type: "number",
        min: 0.5,
        step: 0.05,
      },
      {
        path: "appearance.paragraph_spacing",
        label: "段间距",
        type: "number",
        min: 0,
        step: 0.1,
      },
    ],
  },
  {
    title: "页面布局",
    note: "用于书籍/漫画排版和 PDF 导出；通用模式的编辑正文仍随窗口调整。",
    fields: [
      "page_width",
      "margin_top",
      "margin_bottom",
      "margin_left",
      "margin_right",
    ].map((key, index) => ({
      path: "layout." + key,
      label: [
        "预览版心宽度 / px",
        "上边距 / px",
        "下边距 / px",
        "左边距 / px",
        "右边距 / px",
      ][index],
      type: "number",
      min: index === 0 ? 0.1 : 0,
      step: 0.1,
    })),
  },
  {
    title: "文稿颜色",
    note: "背景色用于预览及启用背景的 PDF 导出，编辑纸张保持纯白。",
    fields: ["text", "background", "link", "quote"].map((key, index) => ({
      path: "colors." + key,
      label: ["正文", "预览背景", "链接", "引用"][index],
      type: "color",
    })),
  },
  {
    title: "预览",
    note: "通用模式保留正文标题，在左侧显示标题大纲；首个标题和文稿目录开关用于书籍和漫画预览。",
    fields: [
      "show_title",
      "show_toc",
      "render_containers",
      "show_word_count",
      "live_preview",
    ].map((key, index) => ({
      path: "preview." + key,
      label: [
        "显示首个标题",
        "显示文稿目录",
        "渲染 note / warning / tip 容器",
        "显示字数",
        "源码实时预览",
      ][index],
      type: "boolean",
    })),
  },
  {
    title: "MDK 交付",
    note: "v1 仅交付 MDK，最终检查始终执行。默认保留批注和未知 meta；剔除持久数据时确认本次范围。无法确保引用同步时保留源文件名。",
    fields: [
      {
        path: "export.default_target",
        label: "默认交付格式",
        choices: [["mdk", ".mdk"]],
      },
      {
        path: "export.mdk.package_mode",
        label: "打包方式",
        choices: [["portable", "portable"]],
      },
      ...[
        "validate_before_export",
        "include_meta",
        "include_editor_state",
        "preserve_source_names",
      ].map((key, index): Field => ({
        path: "export." + key,
        label: [
          "提前展示交付预检报告",
          "保留持久及未知 meta 数据",
          "保留已识别的编辑器状态",
          "保留文稿文件名",
        ][index],
        type: "boolean",
      })),
      {
        path: "export.mdk.overwrite_existing",
        label: "允许覆盖导出文件",
        type: "boolean",
      },
      {
        path: "export.mdk.normalize_paths",
        label: "规范化导出路径",
        type: "boolean",
      },
    ],
  },
  {
    title: "书籍模式",
    note: "目录深度与章节编号用于书籍预览；启用按标题拆分后，可在源码工具栏手动拆分当前文稿。",
    fields: [
      {
        path: "mode.book.toc_depth",
        label: "预览目录深度",
        type: "number",
        min: 1,
        max: 6,
      },
      {
        path: "mode.book.chapter_numbering",
        label: "预览章节编号",
        type: "boolean",
      },
      {
        path: "mode.book.split_by_heading",
        label: "启用按标题拆分",
        type: "boolean",
      },
    ],
  },
  {
    title: "漫画模式",
    fields: [
      {
        path: "mode.comic.reading_direction",
        label: "阅读方向",
        choices: [
          ["ltr", "从左到右"],
          ["rtl", "从右到左"],
        ],
      },
      {
        path: "mode.comic.page_fit",
        label: "图片适应方式",
        choices: [
          ["contain", "完整显示"],
          ["cover", "填充"],
          ["width", "适应宽度"],
        ],
      },
      {
        path: "mode.comic.spread_mode",
        label: "页面排列",
        choices: [
          ["single", "单页"],
          ["double", "双页"],
        ],
      },
    ],
  },
];
export function ProjectSettings({
  value,
  onChange,
  onSave,
  onSource,
  busy,
  fonts,
}: {
  value: MdkSettings;
  onChange: (value: MdkSettings) => void;
  onSave: () => void;
  onSource: () => void;
  busy: boolean;
  fonts: string[];
}) {
  function read(path: string): unknown {
    return path
      .split(".")
      .reduce<unknown>((current, key) => (current as Table)[key], value);
  }
  function update(path: string, next: unknown) {
    const draft = structuredClone(value);
    const keys = path.split(".");
    let section = draft as unknown as Table;
    for (const key of keys.slice(0, -1)) section = section[key] as Table;
    section[keys[keys.length - 1]] = next;
    onChange(draft);
  }
  return (
    <div className="project-settings">
      <div className="section-heading">
        <h2>工程设置</h2>
        <div className="button-row">
          <button className="button small" onClick={onSource} disabled={busy}>
            <FileCode2 size={15} />
            编辑 settings.toml
          </button>
          <button
            className="button primary small"
            disabled={busy}
            onClick={onSave}
          >
            <Save size={15} />
            保存设置
          </button>
        </div>
      </div>
      <p className="field-hint">
        表单保存会重排 TOML
        注释和空白；需要保留源文件布局时，请使用源码编辑。字号和页宽仅要求合法正数，常用界面范围不决定格式合法性。
      </p>
      <fieldset disabled={busy}>
        {groups.map((group) => (
          <div className="settings-card" key={group.title}>
            <h3>{group.title}</h3>
            <div className="settings-fields">
              {group.fields.map((field) => (
                <label
                  className={field.type === "boolean" ? "checkbox-label" : ""}
                  key={field.path}
                >
                  {field.type === "boolean" ? (
                    <>
                      <input
                        aria-label={field.label}
                        type="checkbox"
                        checked={!!read(field.path)}
                        onChange={(e) => update(field.path, e.target.checked)}
                      />
                      {field.label}
                    </>
                  ) : (
                    <>
                      {field.label}
                      {field.choices ? (
                        <Select
                          aria-label={field.label}
                          disabled={busy}
                          value={String(read(field.path))}
                          onValueChange={(value) => update(field.path, value)}
                        >
                          {!field.choices.some(
                            ([v]) => v === read(field.path),
                          ) && (
                            <option value={String(read(field.path))}>
                              {String(read(field.path))}
                            </option>
                          )}
                          {field.choices.map(([v, label]) => (
                            <option value={v} key={v}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      ) : field.path === "appearance.font_family" ? (
                        <FontCombobox
                          aria-label={field.label}
                          value={String(read(field.path))}
                          options={[
                            "system",
                            "Arial",
                            "Times New Roman",
                            ...fonts,
                          ]}
                          disabled={busy}
                          onValueChange={(value) => update(field.path, value)}
                        />
                      ) : (
                        <input
                          aria-label={field.label}
                          type={
                            field.type === "color"
                              ? "text"
                              : (field.type ?? "text")
                          }
                          value={String(read(field.path))}
                          min={field.min}
                          max={field.max}
                          step={field.step ?? 1}
                          onChange={(e) =>
                            update(
                              field.path,
                              field.type === "number"
                                ? +e.target.value
                                : e.target.value,
                            )
                          }
                        />
                      )}
                    </>
                  )}
                </label>
              ))}
            </div>
            {group.note && <p className="field-hint">{group.note}</p>}
          </div>
        ))}
      </fieldset>
    </div>
  );
}
