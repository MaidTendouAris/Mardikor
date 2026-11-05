import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Braces, Eye, Pencil, Settings2, Columns2, X } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { RichEditor, RichToolbar, richDropDraft } from "./RichEditor";
import { Select } from "./Select";
import { ProjectSettings } from "./ProjectSettings";
import { ReadingPreview } from "./ReadingPreview";
import { MediaPreview } from "./MediaPreview";
import type { SourceEditorHandle, SourceModelPool } from "./SourceEditor";
import { desktop } from "../services/desktop";
import { renderPreview, settingsToCss } from "../services/preview";
import { resolveReference } from "../../shared/references";
import { isManuscript } from "../../shared/workspace";
import {
  markdownHeadings,
  requiresSourceMode,
  type MarkdownHeading,
} from "../../shared/markdown";
import type { MdkProject, MdkSettings } from "../../shared/mdk";
import type { InsertionDraft } from "../../shared/resources";
import type {
  EditorGroupState,
  EditorTab,
  TextBuffer,
} from "../services/editor-groups";
import type { Notify } from "../App";

const SourceEditor = lazy(() =>
  import("./SourceEditor").then((module) => ({ default: module.SourceEditor })),
);
export interface EditorGroupHandle {
  scrollTo: (ratio: number) => void;
  jumpHeading: (heading: MarkdownHeading) => void;
  dropDraft: (x: number, y: number, marker: string) => InsertionDraft;
  applyValue: (content: string) => void;
  focus: () => void;
}
interface Props {
  group: EditorGroupState;
  buffer: TextBuffer | null;
  project: MdkProject | null;
  file: string;
  settings: MdkSettings;
  projectFont: string;
  modelPool: SourceModelPool;
  active: boolean;
  split: boolean;
  label: string;
  busy: boolean;
  directoryDirty: boolean;
  notify: Notify;
  execute: (work: () => Promise<unknown>) => Promise<void>;
  flush: () => Promise<boolean>;
  openFile: (path: string) => Promise<void>;
  changeTab: (tab: EditorTab) => Promise<void>;
  updateContent: (content: string) => void;
  importResources: () => Promise<void>;
  revert: () => Promise<void>;
  splitEntry: () => Promise<void>;
  setSettings: (settings: MdkSettings) => void;
  setSettingsDirty: (dirty: boolean) => void;
  patch: (patch: Partial<EditorGroupState>) => void;
  onActivate: () => void;
  onClose: () => void;
  onScroll: (ratio: number) => void;
  getScrollProgress: () => number;
}
export const EditorGroup = forwardRef<EditorGroupHandle, Props>(
  function EditorGroup(
    {
      group,
      buffer,
      project,
      file,
      settings,
      projectFont,
      modelPool,
      active,
      split,
      label,
      busy,
      directoryDirty,
      notify,
      execute,
      flush,
      openFile,
      changeTab,
      updateContent,
      importResources,
      revert,
      splitEntry,
      setSettings,
      setSettingsDirty,
      patch,
      onActivate,
      onClose,
      onScroll,
      getScrollProgress,
    },
    ref,
  ) {
    const {
      path: activePath,
      tab,
      revision,
      reveal: headingReveal,
      heading: previewHeading,
    } = group;
    const [splitPreview, setSplitPreview] = useState(false);
    const [richEditor, setRichEditorInstance] = useState<Editor | null>(null);
    const setRichEditor = useCallback(
      (editor: Editor | null) => setRichEditorInstance(editor),
      [],
    );
    const sourceEditor = useRef<SourceEditorHandle>(null);
    const host = useRef<HTMLElement>(null);
    const previewRef = useRef<HTMLElement>(null);
    const expectedSourceScroll = useRef<number | null>(null);
    const expectedScroll = useRef(new WeakMap<HTMLElement, number>());
    function scrollTo(ratio: number, origin?: HTMLElement | "source") {
      ratio = Math.max(0, Math.min(1, ratio));
      if (tab === "source" && origin !== "source") {
        expectedSourceScroll.current = ratio;
        sourceEditor.current?.scrollTo(ratio);
      }
      const selectors =
        tab === "source"
          ? ".inline-preview"
          : tab === "preview"
            ? ".reading-preview"
            : ".document-canvas";
      host.current?.querySelectorAll<HTMLElement>(selectors).forEach((node) => {
        if (node === origin || node.scrollHeight <= node.clientHeight) return;
        expectedScroll.current.set(node, ratio);
        node.scrollTop = ratio * (node.scrollHeight - node.clientHeight);
      });
    }
    const viewportReady = () =>
      requestAnimationFrame(() => scrollTo(getScrollProgress()));
    const layoutScroll = useRef(viewportReady);
    layoutScroll.current = viewportReady;
    useEffect(() => {
      const observer = new ResizeObserver(() => layoutScroll.current());
      if (host.current) observer.observe(host.current);
      return () => observer.disconnect();
    }, []);
    useEffect(() => {
      viewportReady();
    }, [tab, activePath]);
    function reportScroll(ratio: number, origin: HTMLElement | "source") {
      const expected =
        origin === "source"
          ? expectedSourceScroll.current
          : expectedScroll.current.get(origin);
      if (origin === "source") expectedSourceScroll.current = null;
      else expectedScroll.current.delete(origin);
      if (expected != null && Math.abs(expected - ratio) < 0.004) return;
      scrollTo(ratio, origin);
      onScroll(ratio);
    }
    const lastTextBuffer = useRef<TextBuffer | null>(null);
    if (buffer) lastTextBuffer.current = buffer;
    const codeBuffer = buffer ?? lastTextBuffer.current;
    const contentDirty = !!buffer && buffer.content !== buffer.saved;
    const standalone = project?.format === "markdown";
    const isMarkdown = !!buffer && isManuscript(project, buffer.path);
    const markdown = isMarkdown ? buffer.content : "";
    const unsupported = requiresSourceMode(markdown);
    const headings = useMemo(() => markdownHeadings(markdown), [markdown]);
    const activeEntry = project?.contents.entries.find(
      (e) => e.path === activePath,
    );
    const activeFile = project?.files.find((f) => f.path === activePath);
    const [resourceData, setResourceData] = useState("");
    useEffect(() => {
      let live = true;
      setResourceData("");
      if (
        !buffer &&
        activeFile?.kind !== "directory" &&
        activePath.startsWith("resources/")
      ) {
        void desktop()
          .invoke("readResource", file, activePath)
          .then((data) => {
            if (live) setResourceData(data);
          })
          .catch((error) => {
            if (live) notify(String(error), true);
          });
      }
      return () => {
        live = false;
      };
    }, [file, activePath, !!buffer]);
    const resolveResource = useCallback(
      async (source: string) => {
        const target = resolveReference(activePath, source, true);
        return target.kind === "local"
          ? desktop().invoke("readResource", file, target.path)
          : "";
      },
      [file, activePath],
    );
    const previewMarkdown = settings.preview.live_preview
      ? markdown
      : isMarkdown
        ? buffer.saved
        : "";
    const previewHtml = renderPreview(
      previewMarkdown,
      project?.mode === "00"
        ? {
            ...settings,
            preview: { ...settings.preview, show_toc: false, show_title: true },
          }
        : settings,
      activeEntry?.position,
      project?.mode,
      group.id + "-",
      activePath,
    );
    useEffect(() => {
      let live = true;
      previewRef.current?.querySelectorAll("img").forEach((image) => {
        const src = image.getAttribute("data-mdk-ref") ?? "";
        image.removeAttribute("src");
        void resolveResource(src)
          .then((value) => {
            if (live && value) image.src = value;
          })
          .catch(() => {
            if (live) image.alt = "资源不可用：" + src;
          });
      });
      return () => {
        live = false;
      };
    }, [previewHtml, tab, splitPreview, resolveResource]);
    useImperativeHandle(
      ref,
      () => ({
        scrollTo,
        jumpHeading(heading) {
          if (!richEditor) return;
          let index = 0,
            position = -1;
          richEditor.state.doc.descendants((node, pos) => {
            if (node.type.name === "heading" && index++ === heading.index)
              position = pos + 1;
          });
          if (position >= 0)
            richEditor
              .chain()
              .focus()
              .setTextSelection(position)
              .scrollIntoView()
              .run();
        },
        dropDraft(x, y, marker) {
          const draft =
            tab === "write" && richEditor
              ? richDropDraft(richEditor, x, y, marker)
              : sourceEditor.current?.dropDraft(x, y, marker);
          if (!draft) throw new Error("编辑器尚未就绪。");
          return draft;
        },
        applyValue(content) {
          if (tab === "write" && richEditor)
            richEditor.commands.setContent(content, {
              contentType: "markdown",
              emitUpdate: false,
            });
          else sourceEditor.current?.applyValue(content);
        },
        focus() {
          if (tab === "write") richEditor?.commands.focus();
          else if (tab === "source") sourceEditor.current?.focus();
          else host.current?.focus();
        },
      }),
      [richEditor, tab],
    );
    const setCursor = (cursor: { line: number; column: number }) =>
      patch({ cursor });
    const setActiveHeading = (activeHeading: number) =>
      patch({ activeHeading });
    const flushRef = { current: flush };
    const style = {
      ...settingsToCss(settings),
      ...(projectFont ? { "--preview-font-family": projectFont } : {}),
      zoom: group.zoom / 100,
    } as CSSProperties;
    const choices = [
      ...new Set([
        activePath,
        ...(project?.files
          .filter((f) => f.kind !== "directory")
          .map((f) => f.path) ?? []),
        "settings.toml",
      ]),
    ].filter(Boolean);
    return (
      <section
        ref={host}
        className={"editor-group " + (active ? "active-editor-group" : "")}
        data-editor-group={group.id}
        role="region"
        aria-label={label + "编辑组"}
        tabIndex={-1}
        onPointerDownCapture={onActivate}
        onFocusCapture={onActivate}
        onLoadCapture={viewportReady}
        onScrollCapture={(event) => {
          const node = event.target;
          if (
            !(node instanceof HTMLElement) ||
            !node.matches(
              ".document-canvas,.reading-preview,.inline-preview",
            ) ||
            node.scrollHeight <= node.clientHeight
          )
            return;
          reportScroll(
            node.scrollTop / (node.scrollHeight - node.clientHeight),
            node,
          );
        }}
      >
        {split && (
          <header className="editor-group-heading">
            <span>{label}</span>
            <Select
              aria-label={label + "文件"}
              value={activePath}
              disabled={busy}
              onValueChange={(value) => void execute(() => openFile(value))}
            >
              {choices.map((p) => (
                <option
                  key={p}
                  value={p}
                  disabled={standalone && p === "settings.toml"}
                >
                  {p}
                </option>
              ))}
            </Select>
            <button
              className="icon-button"
              aria-label={"关闭" + label}
              title={"关闭" + label}
              disabled={busy}
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </header>
        )}
        <div className="document-tabs" role="tablist" aria-label="编辑模式">
          {[
            { id: "source", name: "源码", icon: Braces },
            { id: "write", name: "可视化", icon: Pencil },
            { id: "preview", name: "预览", icon: Eye },
            { id: "settings", name: "工程设置", icon: Settings2 },
          ].map((item) => (
            <button
              role="tab"
              key={item.id}
              aria-selected={tab === item.id}
              className={tab === item.id ? "active" : ""}
              disabled={
                busy ||
                !project ||
                (item.id === "write" && !isMarkdown) ||
                (item.id === "settings" && standalone)
              }
              onClick={() =>
                void execute(() => changeTab(item.id as EditorTab))
              }
            >
              <item.icon size={15} />
              {item.name}
            </button>
          ))}
          <div className="document-view-actions">
            {tab === "source" && isMarkdown && (
              <button
                aria-label="切换源码与预览分栏"
                title="源码与预览分栏"
                className={`icon-button ${splitPreview ? "selected" : ""}`}
                onClick={() => setSplitPreview(!splitPreview)}
              >
                <Columns2 size={16} />
              </button>
            )}
            {contentDirty && (
              <button
                className="text-button"
                onClick={() => void execute(revert)}
              >
                撤销文件更改
              </button>
            )}
          </div>
        </div>
        {project && !["00", "01", "02"].includes(project.mode) && (
          <p className="source-warning">
            未知 mode {project.mode}
            ：只读显示基础内容，其附加约束未验证。可显式切换到 00 后编辑。
          </p>
        )}
        {project &&
          project.issues.filter((issue) => issue.severity === "error").length >
            0 && (
            <details className="project-diagnostics">
              <summary>
                工程有{" "}
                {
                  project.issues.filter((issue) => issue.severity === "error")
                    .length
                }{" "}
                项待处理问题；允许保存，交付前须修复
              </summary>
              {project.issues
                .filter((issue) => issue.severity === "error")
                .map((issue, index) => (
                  <p key={index}>
                    {issue.path}：{issue.message}
                  </p>
                ))}
            </details>
          )}
        {tab === "write" && (
          <RichToolbar
            editor={richEditor}
            disabled={busy || unsupported || !!project?.readonly}
            sourceEditable={!busy && !project?.readonly}
            sourceText={markdown}
            notify={notify}
            sourcePath={activePath}
            files={project?.files ?? []}
            onImport={importResources}
            onSourceInsert={async (text) => {
              await execute(async () => {
                await changeTab("source");
                if (sourceEditor.current) sourceEditor.current.applyValue(text);
                else updateContent(text);
              });
              requestAnimationFrame(() => sourceEditor.current?.focus());
            }}
          />
        )}
        <div
          className={`document-canvas ${tab === "source" ? "source-canvas" : ""}`}
        >
          {codeBuffer && (
            <div
              className={`source-workspace ${splitPreview && isMarkdown ? "split-preview" : ""}`}
              hidden={tab !== "source" || !buffer}
            >
              <section
                className="source-pane"
                data-document-drop-zone={
                  isMarkdown && tab === "source" ? "source" : undefined
                }
                data-document-path={buffer?.path}
              >
                <div className="source-toolbar">
                  <span>{codeBuffer.path}</span>
                  <span>
                    UTF-8 ·{" "}
                    {codeBuffer.content.includes("\r\n") ? "CRLF" : "LF"}
                  </span>
                  {isMarkdown &&
                    project?.mode === "01" &&
                    settings.mode.book.split_by_heading &&
                    activeEntry && (
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() => void execute(splitEntry)}
                      >
                        按标题拆分
                      </button>
                    )}
                  <button
                    className="button small"
                    disabled={busy || !contentDirty}
                    onClick={() =>
                      void execute(async () => {
                        if (await flush()) notify("文件已保存。");
                      })
                    }
                  >
                    保存源码
                  </button>
                </div>
                {["contents.toml", "mimetype"].includes(codeBuffer.path) && (
                  <p className="source-warning">
                    {directoryDirty && codeBuffer.path === "contents.toml"
                      ? "目录有待同步变更，源码显示上次保存的版本。请先点击“更新目录”。"
                      : "关键工程文件，保存前执行格式校验。"}
                  </p>
                )}
                <Suspense
                  fallback={
                    <p className="editor-loading">正在加载 Monaco 编辑器…</p>
                  }
                >
                  <SourceEditor
                    ref={sourceEditor}
                    modelPool={modelPool}
                    onViewportReady={viewportReady}
                    onScroll={
                      tab === "source"
                        ? (ratio) => reportScroll(ratio, "source")
                        : undefined
                    }
                    reveal={headingReveal}
                    path={codeBuffer.path}
                    value={codeBuffer.content}
                    files={project?.files ?? []}
                    readOnly={
                      project?.readonly ||
                      (project?.settings_readonly &&
                        codeBuffer.path === "settings.toml") ||
                      busy ||
                      tab !== "source" ||
                      !buffer ||
                      (directoryDirty && codeBuffer.path === "contents.toml")
                    }
                    onChange={updateContent}
                    onSave={() =>
                      void execute(async () => {
                        if (await flushRef.current()) notify("工程已保存。");
                      })
                    }
                    onPosition={(line, column) => {
                      if (tab !== "source") return;
                      setCursor({ line, column });
                      setActiveHeading(
                        headings.reduce(
                          (active, heading, index) =>
                            heading.line <= line ? index : active,
                          -1,
                        ),
                      );
                    }}
                  />
                </Suspense>
              </section>
            </div>
          )}
          {tab === "settings" ? (
            <ProjectSettings
              value={settings}
              fonts={
                project?.files
                  .filter((item) => item.path.startsWith("resources/font/"))
                  .map((item) => item.path) ?? []
              }
              busy={busy || !!project?.readonly || !!project?.settings_readonly}
              onChange={(value) => {
                setSettings(value);
                setSettingsDirty(true);
              }}
              onSave={() =>
                void execute(async () => {
                  if (await flush()) notify("工程设置已保存。");
                })
              }
              onSource={() => void execute(() => openFile("settings.toml"))}
            />
          ) : tab === "preview" && project ? (
            <ReadingPreview
              onLayout={viewportReady}
              file={file}
              project={project}
              settings={settings}
              style={style}
              onOpen={(path) => void execute(() => openFile(path))}
              activeDocument={
                isMarkdown && buffer
                  ? { path: buffer.path, markdown: previewMarkdown }
                  : undefined
              }
              heading={previewHeading}
            />
          ) : buffer ? (
            <>
              <div className="paper-wrapper" hidden={tab !== "write"}>
                {unsupported && (
                  <div className="source-warning">
                    此文稿含扩展语法，请使用 Monaco 源码编辑以保留原始内容。
                  </div>
                )}
                <div
                  className="document-paper"
                  style={style}
                  data-document-drop-zone={
                    tab === "write" && isMarkdown ? "write" : undefined
                  }
                  data-document-path={buffer.path}
                >
                  <RichEditor
                    content={buffer.content}
                    revision={revision}
                    editable={
                      !busy &&
                      !project?.readonly &&
                      !unsupported &&
                      tab === "write"
                    }
                    onChange={updateContent}
                    onReady={setRichEditor}
                    resolveResource={resolveResource}
                  />
                </div>
              </div>
              {tab === "source" && splitPreview && isMarkdown && (
                <div
                  className={
                    tab === "source" ? "inline-preview" : "paper-wrapper"
                  }
                >
                  <article
                    className="document-paper preview-body"
                    style={{ ...style, background: settings.colors.background }}
                    ref={previewRef}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}
            </>
          ) : activeFile && project ? (
            <MediaPreview
              file={file}
              current={activeFile}
              data={resourceData}
              files={project.files}
              settings={settings}
              mode={project.mode}
              onSelect={(path) => void execute(() => openFile(path))}
            />
          ) : (
            <div className="workspace-empty">
              <p>
                {activeEntry
                  ? "文稿文件缺失：" +
                    activeEntry.path +
                    "。请在整体目录中恢复同名文件，或显式删除目录项；不会自动创建空白正文。"
                  : "从左侧选择文稿或工程文件。"}
              </p>
            </div>
          )}
        </div>
      </section>
    );
  },
);
