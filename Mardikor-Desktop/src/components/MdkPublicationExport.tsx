import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useState,
} from "react";
import { Download, Eye, FileCheck2, FilePlus2, RefreshCw, Save } from "lucide-react";
import { t } from "../../shared/i18n";
import { bundledFontChoices, projectFontChoices, systemFontName } from "../../shared/fonts";
import { FontCombobox } from "./FontCombobox";
import type {
  MdkPublicationMetadata,
  PublicationFormat,
  PublicationInfo,
  PublicationPlan,
  PublicationPresetEdit,
  PublicationStage,
} from "../../shared/publication";
import { desktop, desktopErrorMessage } from "../services/desktop";
import { Select } from "./Select";
import type { PublicationExportProps } from "./PublicationExport";
import { ValidationIssueRow } from "./ValidationIssueRow";

type Options = PublicationPresetEdit["options"];
type Info = PublicationInfo & { mdk: NonNullable<PublicationInfo["mdk"]> };

function activePreset(
  info: PublicationInfo,
  format: PublicationFormat,
  id?: string,
) {
  const presets = info.presets?.filter((preset) => preset.format === format);
  return (
    presets?.find((preset) => preset.id === (id ?? info.defaultPreset)) ??
    presets?.[0]
  );
}

function optionsForSave(
  format: PublicationFormat,
  original: Options,
  edits: Options,
) {
  const fixed = (edits.layout ?? original.layout) === "fixed";
  const irrelevant =
    format === "pdf"
      ? fixed
        ? ["chapter_break"]
        : []
      : fixed
        ? []
        : ["page_width", "page_height", "spread", "first_single"];
  return Object.fromEntries(
    Object.entries(edits).filter(([name]) => !irrelevant.includes(name)),
  );
}

function pdfDimensionErrors(options: Options) {
  const axes = [
    ["page_width", "margin_left", "margin_right"],
    ["page_height", "margin_top", "margin_bottom"],
  ] as const;
  const errors = new Map<string, string>();
  for (const [page, first, second] of axes) {
    const width = Number(options[page]),
      left = Number(options[first]),
      right = Number(options[second]);
    for (const [key, size] of [
      [page, width],
      [first, left],
      [second, right],
    ] as const)
      if (!Number.isFinite(size) || (key === page ? size <= 0 : size < 0))
        errors.set(key, t("出版尺寸无效。"));
    if (
      !errors.has(page) &&
      !errors.has(first) &&
      !errors.has(second) &&
      left + right >= width
    ) {
      const message = t("边距总和必须小于纸张尺寸。");
      for (const field of [page, first, second]) errors.set(field, message);
    }
  }
  return errors;
}

export function MdkPublicationExport({
  file,
  flush,
  notify,
  onConfigured,
  progressLabels,
  ask,
  handleRef,
  onDirty,
  onBusy,
  issueFiles,
  onOpenIssue,
}: PublicationExportProps & {
  progressLabels: Record<PublicationStage, string>;
}) {
  const [info, setInfo] = useState<Info>();
  const [format, setFormat] = useState<PublicationFormat>("pdf");
  const [selection, setSelection] = useState<
    Partial<Record<PublicationFormat, string>>
  >({});
  const [edits, setEdits] = useState<Record<string, Options>>({});
  const [metadata, setMetadata] = useState<Partial<MdkPublicationMetadata>>({});
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<PublicationPlan>();
  const fieldId = useId();

  async function readInfo() {
    const result = await desktop().invoke("publicationInfo", file);
    if (!result.mdk) throw new Error(t("出版配置无效。"));
    return { ...result, mdk: result.mdk };
  }

  useEffect(() => {
    let live = true;
    void readInfo()
      .then(
        (value) => {
          if (live) setInfo(value);
        },
        (error: unknown) => {
          if (live) setError(desktopErrorMessage(error));
        },
      )
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [file]);
  useEffect(
    () =>
      window.mardikor?.onPublicationProgress((source, stage) => {
        if (source === file) setProgress(progressLabels[stage]);
      }),
    [file, progressLabels],
  );

  const presets =
    info?.presets?.filter((preset) => preset.format === format) ?? [];
  const preset = info && activePreset(info, format, selection[format]);
  const initial =
    preset ?? info?.mdk.defaults.find((entry) => entry.format === format);
  const key = `${format}:${preset?.id ?? ""}`;
  const initialFont = initial?.inheritsFont ? "inherit" : (initial?.font ?? "inherit");
  const selectedFont = String(edits[key]?.font ?? initialFont);
  const options = { ...initial?.options, ...edits[key] } as Options;
  const fixed = options.layout === "fixed";
  const automaticFontEmbedding =
    initial?.format === "epub" && initial.automaticFontEmbedding;
  const defaultEmbed = fixed || !!systemFontName(selectedFont === "inherit" ? info?.configuration.appearance.font_family : selectedFont);
  if (automaticFontEmbedding && edits[key]?.embed_font === undefined)
    options.embed_font = defaultEmbed;
  const drafts = Object.entries(edits).flatMap(([draftKey, values]) => {
    const [kind, id] = draftKey.split(":", 2) as [PublicationFormat, string];
    const base = id
      ? info?.presets?.find((entry) => entry.id === id && entry.format === kind)
      : info?.mdk.defaults.find((entry) => entry.format === kind);
    if (!base) return [];
    const original = { ...base.options } as Options;
    const { font, ...optionEdits } = values;
    const options = optionsForSave(kind, original, optionEdits);
    return Object.keys(options).length || font !== undefined
      ? [{ draftKey, format: kind, id: id || undefined, original, options,
        originalFont: base.font, inherited: base.inheritsFont,
        font: typeof font === "string" ? (font === "inherit" ? "" : font) : undefined }]
      : [];
  });
  const fieldErrors =
    format === "pdf" && initial
      ? pdfDimensionErrors(options)
      : new Map<string, string>();
  const fields = { ...info?.mdk.metadata, ...metadata };
  const metadataEdits = { ...metadata };
  if (metadata.creators) {
    const names = metadata.creators.map((name) => name.trim()).filter(Boolean);
    if (JSON.stringify(names) === JSON.stringify(info?.mdk.metadata.creators))
      delete metadataEdits.creators;
    else metadataEdits.creators = names;
  }
  const metadataChanged = Object.keys(metadataEdits).length > 0;
  const changed =
    drafts.some((draft) => draft.draftKey === key) || metadataChanged;
  const anyDirty = drafts.length > 0 || metadataChanged;
  const unavailable = busy || Boolean(info?.mdk.readonly);
  useLayoutEffect(() => onDirty(anyDirty), [anyDirty, onDirty]);
  useLayoutEffect(() => onBusy(busy), [busy, onBusy]);

  function changeOption(name: string, value: Options[string]) {
    if (!initial) return;
    const original =
      name === "font" ? initialFont : name === "embed_font" && automaticFontEmbedding
        ? defaultEmbed
        : (initial.options as unknown as Options)[name];
    setEdits((previous) => {
      const next = { ...previous[key] };
      if (Object.is(value, original)) delete next[name];
      else next[name] = value;
      return { ...previous, [key]: next };
    });
    setPlan(undefined);
  }

  function changeFont(value: string) {
    changeOption("font", value);
    if (format === "epub" && value !== "inherit" && !options.embed_font)
      changeOption("embed_font", true);
  }

  async function packFont() {
    if (!info || unavailable) return;
    setBusy(true);
    setError("");
    try {
      if (!(await flush())) return;
      const latest = await readInfo();
      const result = await desktop().invoke("packFont", file, latest.revision);
      if (!result) return;
      setInfo(await readInfo());
      await onConfigured(file);
      changeFont(result.path);
      notify(t("字体已打包至 {0}。", result.path));
    } catch (error) {
      setError(desktopErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function changeMetadata<K extends keyof MdkPublicationMetadata>(
    name: K,
    value: MdkPublicationMetadata[K],
  ) {
    setMetadata((previous) => {
      const next = { ...previous };
      if (value === info?.mdk.metadata[name]) delete next[name];
      else next[name] = value;
      return next;
    });
    setPlan(undefined);
  }

  async function reload() {
    if (
      anyDirty &&
      !(await ask({
        title: t("放弃未保存的导出配置？"),
        confirm: t("重新读取配置"),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      setInfo(await readInfo());
      setEdits({});
      setMetadata({});
      setPlan(undefined);
    } catch (error) {
      setError(desktopErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function perform(
    action: "save" | "preflight" | "preview" | "export",
    flushDocument = true,
  ): Promise<boolean> {
    if (!info || !initial || busy) return false;
    setBusy(true);
    setError("");
    setPlan(undefined);
    try {
      let id = preset?.id;
      const submitted =
        action === "save"
          ? drafts
          : drafts.filter((draft) => draft.draftKey === key);
      for (const draft of submitted) {
        if (draft.format !== "pdf") continue;
        const error = pdfDimensionErrors({
          ...draft.original,
          ...draft.options,
        })
          .values()
          .next().value;
        if (error) {
          setFormat(draft.format);
          if (draft.id)
            setSelection((previous) => ({ ...previous, pdf: draft.id }));
          throw new Error(error);
        }
      }
      if (flushDocument && !(await flush())) return false;
      if (submitted.length || metadataChanged) {
        const latest = await readInfo();
        if (
          submitted.some((draft) => {
            const current = activePreset(latest, draft.format, draft.id);
            const expected =
              current ??
              latest.mdk.defaults.find(
                (entry) => entry.format === draft.format,
              );
            return (
              current?.id !== draft.id ||
              draft.originalFont !== expected?.font ||
              draft.inherited !== expected?.inheritsFont ||
              JSON.stringify(draft.original) !==
                JSON.stringify(expected?.options)
            );
          }) ||
          Object.keys(metadataEdits).some((name) => {
            const field = name as keyof MdkPublicationMetadata;
            return (
              JSON.stringify(info.mdk.metadata[field]) !==
              JSON.stringify(latest.mdk.metadata[field])
            );
          })
        )
          throw new Error(t("工程导出设置已变化，请重新读取配置后再保存。"));
        const editsToSave: PublicationPresetEdit[] = submitted.map(
          (draft, index) => ({
            format: draft.format,
            presetId: draft.id,
            font: draft.font,
            options: draft.options,
            metadata: index === 0 ? metadataEdits : {},
          }),
        );
        if (!editsToSave.length)
          editsToSave.push({
            format,
            presetId: id,
            options: {},
            metadata: metadataEdits,
          });
        const saved = await desktop().invoke(
          "saveMdkPublication",
          file,
          editsToSave,
          latest.revision,
        );
        const newSelection: Partial<Record<PublicationFormat, string>> = {};
        submitted.forEach((draft, index) => {
          const savedId = saved.ids[index];
          if (draft.draftKey === key) id = savedId;
          if (!draft.id && savedId) newSelection[draft.format] = savedId;
        });
        setSelection((previous) => ({ ...previous, ...newSelection }));
        setEdits((previous) => {
          const next = { ...previous };
          for (const draft of submitted) delete next[draft.draftKey];
          return next;
        });
        setMetadata({});
        setInfo(await readInfo());
        await onConfigured(file);
      }
      if (action === "save") {
        if (flushDocument) notify(t("导出配置已保存至工程。"));
        return true;
      }
      setProgress(progressLabels.prepare);
      const presetArgs = id ? ([id] as const) : ([] as const);
      const result = await desktop().invoke(
        "planPublication",
        file,
        format,
        ...presetArgs,
      );
      setPlan(result);
      if (!result.report.valid || action === "preflight")
        return result.report.valid;
      if (action === "preview") {
        await desktop().invoke("previewPdf", file, result.fingerprint, ...presetArgs);
        return true;
      }
      const name =
        (
          fields.title ||
          file
            .split(/[\\/]/)
            .at(-1)!
            .replace(/\.mdk$/i, "")
        ).replace(/[\\/:<>"|?*]/g, "_") +
        "." +
        format;
      setProgress(t("请选择导出位置。"));
      const output = await desktop().dialog(
        format === "pdf" ? "save-pdf" : "save-epub",
        name,
      );
      if (!output) return false;
      const exported = await desktop().invoke(
        "exportPublication",
        file,
        output,
        format,
        result.fingerprint,
        ...presetArgs,
      );
      notify(
        t(
          "{0} 已导出{1}。",
          format.toUpperCase(),
          exported.pages ? t("，共 {0} 页", exported.pages) : "",
        ),
      );
      return true;
    } catch (error) {
      const message = desktopErrorMessage(error);
      setError(message);
      if (!flushDocument) notify(message, true);
      return false;
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  useImperativeHandle(handleRef, () => ({
    save: async () => !busy && (!anyDirty || (await perform("save", false))),
  }));

  const choose = (
    label: string,
    value: string,
    choices: [string, string][],
    update: (value: string) => void,
  ) => (
    <label>
      {label}
      <Select
        aria-label={label}
        value={value}
        disabled={unavailable}
        onValueChange={update}
      >
        {choices.map(([key, title]) => (
          <option key={key} value={key}>
            {title}
          </option>
        ))}
      </Select>
    </label>
  );
  const number = (label: string, name: string, min: number) => (
    <label key={name}>
      {label}
      <input
        type="number"
        aria-label={label}
        min={min}
        step="any"
        value={Number.isFinite(options[name]) ? Number(options[name]) : ""}
        aria-invalid={fieldErrors.has(name) || undefined}
        aria-describedby={
          fieldErrors.has(name) ? `${fieldId}-${name}` : undefined
        }
        onChange={(event) => changeOption(name, event.target.valueAsNumber)}
      />
      {fieldErrors.has(name) && (
        <small id={`${fieldId}-${name}`} className="publication-field-error">
          {fieldErrors.get(name)}
        </small>
      )}
    </label>
  );
  const check = (label: string, name: string) => (
    <label className="publication-check">
      <input
        type="checkbox"
        checked={Boolean(options[name])}
        onChange={(event) => changeOption(name, event.target.checked)}
      />
      {label}
    </label>
  );

  return (
    <section className="publication-export" aria-label={t("PDF 与 EPUB 导出")}>
      <div className="section-heading">
        <h2>{t("出版导出")}</h2>
        <button
          className="button small"
          disabled={busy}
          onClick={() => void reload()}
        >
          <RefreshCw size={14} /> {t("重新读取配置")}
        </button>
      </div>
      {error && (
        <p className="publication-error" role="alert">
          {error}
        </p>
      )}
      {progress && (
        <div className="publication-progress" role="status">
          {progress}
          <progress aria-label={t("出版任务进度")} />
        </div>
      )}
      {info && initial ? (
        <>
          <div className="publication-actions">
            <Select
              aria-label={t("出版导出格式")}
              value={format}
              disabled={busy}
              onValueChange={(value) => {
                setFormat(value as PublicationFormat);
                setPlan(undefined);
              }}
            >
              <option value="pdf">{t("PDF 文档")}</option>
              <option value="epub">{t("EPUB 3 电子书")}</option>
            </Select>
            {presets.length > 1 && (
              <Select
                aria-label={t("选择出版预设")}
                disabled={busy}
                value={preset?.id ?? ""}
                onValueChange={(id) => {
                  setSelection((previous) => ({ ...previous, [format]: id }));
                  setPlan(undefined);
                }}
              >
                {presets.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
            <button
              className="button"
              disabled={unavailable || !anyDirty}
              onClick={() => void perform("save")}
            >
              <Save size={15} /> {t("保存导出配置至工程")}
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void perform("preflight")}
            >
              <FileCheck2 size={15} />{" "}
              {changed ? t("保存并预检") : t("严格预检")}
            </button>
            {format === "pdf" && (
              <button
                className="button"
                disabled={busy}
                onClick={() => void perform("preview")}
              >
                <Eye size={15} /> {changed ? t("保存并预览 PDF") : t("预览 PDF")}
              </button>
            )}
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void perform("export")}
            >
              <Download size={15} /> {changed ? t("保存并导出") : t("导出")}{" "}
              {format.toUpperCase()}
            </button>
          </div>
          <fieldset disabled={unavailable}>
            <details open>
              <summary>
                {format === "pdf" ? t("PDF 页面设置") : t("EPUB 阅读设置")}
              </summary>
              <div className="publication-fields">
                {choose(
                  t("出版版式"),
                  String(options.layout),
                  [
                    format === "pdf"
                      ? ["flow", t("流式排版")]
                      : ["reflowable", t("可重排")],
                    ["fixed", t("固定版式")],
                  ],
                  (value) => changeOption("layout", value),
                )}
                {(format === "pdf" || fixed) && (
                  <>
                    {number(
                      format === "pdf"
                        ? t("纸张宽度（mm）")
                        : t("页面宽度（px）"),
                      "page_width",
                      0.01,
                    )}
                    {number(
                      format === "pdf"
                        ? t("纸张高度（mm）")
                        : t("页面高度（px）"),
                      "page_height",
                      0.01,
                    )}
                  </>
                )}
                {format === "pdf" ? (
                  <>
                    {number(t("上边距（mm）"), "margin_top", 0)}
                    {number(t("下边距（mm）"), "margin_bottom", 0)}
                    {number(t("左边距（mm）"), "margin_left", 0)}
                    {number(t("右边距（mm）"), "margin_right", 0)}
                    {!fixed &&
                      choose(
                        t("章节换页"),
                        String(options.chapter_break),
                        [
                          ["none", t("连续排版")],
                          ["page", t("每章另起一页")],
                        ],
                        (value) => changeOption("chapter_break", value),
                      )}
                    {check(t("生成目录页"), "include_toc")}
                  </>
                ) : (
                  <>
                    {choose(
                      t("阅读方向"),
                      String(options.direction),
                      [
                        ["ltr", t("从左到右")],
                        ["rtl", t("从右到左")],
                      ],
                      (value) => changeOption("direction", value),
                    )}
                    {fixed &&
                      choose(
                        t("分页布局"),
                        String(options.spread),
                        [
                          ["single", t("单页")],
                          ["double", t("双页")],
                        ],
                        (value) => changeOption("spread", value),
                      )}
                    {fixed &&
                      options.spread === "double" &&
                      check(t("首项单页"), "first_single")}
                    {check(t("将目录页加入阅读顺序"), "toc_in_spine")}
                    {check(t("嵌入字体"), "embed_font")}
                  </>
                )}
                {check(t("生成封面页"), "include_cover")}
              </div>
            </details>
            <details open>
              <summary>{t("排版与字体")}</summary>
              <div className="publication-fields">
                <label>
                  {t("导出字体")}
                  <FontCombobox aria-label={t("导出字体")} disabled={unavailable} value={selectedFont}
                    options={[
                      ["inherit", t("沿用工程字体（{0}）", systemFontName(info.configuration.appearance.font_family) ?? info.configuration.appearance.font_family)],
                      ...bundledFontChoices(),
                      ...projectFontChoices(info.fonts, selectedFont),
                    ]} onValueChange={changeFont} />
                </label>
                <div className="publication-font-actions">
                  <button type="button" className="button" disabled={unavailable} onClick={() => void packFont()}>
                    <FilePlus2 size={15} /> {t("打包字体文件")}
                  </button>
                </div>
              </div>
            </details>
            <details>
              <summary>{t("作品信息与封面")}</summary>
              <div className="publication-fields">
                {(
                  [
                    ["title", t("作品标题")],
                    ["language", t("语言")],
                    ["identifier", t("出版物标识")],
                    ["publisher", t("出版者")],
                    ["rights", t("版权说明")],
                    ["description", t("作品简介")],
                  ] as const
                ).map(([name, label]) => (
                  <label key={name}>
                    {label}
                    <input
                      value={fields[name] ?? ""}
                      onChange={(event) =>
                        changeMetadata(name, event.target.value)
                      }
                    />
                  </label>
                ))}
                <label>
                  {t("创作者（每行一位）")}
                  <textarea
                    rows={2}
                    value={fields.creators?.join("\n") ?? ""}
                    onChange={(event) =>
                      changeMetadata("creators", event.target.value.split("\n"))
                    }
                  />
                </label>
                {choose(
                  t("封面资源"),
                  fields.cover || "none",
                  [
                    ["none", t("不设置封面")],
                    ...[
                      ...new Set([
                        ...info.images,
                        ...(fields.cover ? [fields.cover] : []),
                      ]),
                    ].map((path): [string, string] => [path, path]),
                  ],
                  (value) =>
                    changeMetadata("cover", value === "none" ? "" : value),
                )}
              </div>
            </details>
          </fieldset>
          {plan && (
            <div
              className="publication-report"
              role="region"
              aria-label={t("出版转换校验结果")}
            >
              <strong>
                {plan.report.valid ? t("严格预检通过") : t("严格预检未通过")} ·{" "}
                {plan.chapters} {t("篇文稿")}
              </strong>
              {plan.report.issues.map((issue, index) => (
                <ValidationIssueRow
                  key={index}
                  issue={issue}
                  fallback={t("出版转换")}
                  onOpen={
                    issue.path && issueFiles.has(issue.path)
                      ? onOpenIssue
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </>
      ) : (
        busy && <p role="status">{t("正在读取导出设置…")}</p>
      )}
    </section>
  );
}
