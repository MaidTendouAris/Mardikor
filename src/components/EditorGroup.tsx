import { t } from "../../shared/i18n";
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
import {
  PagedPreview,
  type PagePoint,
  type PagedPreviewHandle,
} from "./PagedPreview";
import { PageNavigation } from "./PageNavigation";
import { MediaPreview } from "./MediaPreview";
import type { SourceEditorHandle, SourceModelPool } from "./SourceEditor";
import { desktop } from "../services/desktop";
import {
  mayContainMath,
  renderPreview,
  settingsToCss,
} from "../services/preview";
import { usePreviewMath } from "../services/preview-math";
import { followPreviewLink } from "../services/document-links";
import { resolveReference } from "../../shared/references";
import { isManuscript } from "../../shared/workspace";
import {
  requiresSourceMode,
  type MarkdownHeading,
} from "../../shared/markdown";
import { canEditVisually, isLargeDocument } from "../services/document-size";
import {
  editWindowAt,
  headingOffsetAtLine,
  pageAtLine,
  replacePage,
  replacePages,
  shiftEditWindow,
  type DocumentPages,
  type EditPageWindow,
} from "../services/document-pages";
import {
  richPageDraft,
  richPageTextPosition,
  type RichPageChange,
} from "../services/rich-pages";
import { richDropTransaction } from "../services/rich-markdown";
import { markdownTask } from "../services/markdown-tasks";
import { reservedSectionNumbers } from "../../shared/heading-numbering";
import type { MdkProject, MdkSettings } from "../../shared/mdk";
import type { InsertionDraft } from "../../shared/resources";
import {
  editorFileKind,
  editorView,
  type EditorGroupState,
  type EditorTab,
  type TextBuffer,
} from "../services/editor-groups";
import type { Notify } from "../App";
import type { ResolvedAppTheme } from "../../shared/desktop";
import type { ShortcutOverrides, VisualShortcut } from "../../shared/shortcuts";

const SourceEditor = lazy(async () => {
  // Monaco translates action labels when its modules are first evaluated.
  if (document.documentElement.lang === "zh-CN")
    await import("monaco-editor/nls/lang/zh-cn.js");
  const module = await import("./SourceEditor");
  return { default: module.SourceEditor };
});
export interface EditorGroupHandle {
  scrollTo: (ratio: number) => void;
  jumpHeading: (heading: MarkdownHeading) => void;
  dropDraft: (x: number, y: number, marker: string) => InsertionDraft;
  applyValue: (content: string) => void;
  focus: () => void;
  format: (action: VisualShortcut) => void;
}
interface Props {
  group: EditorGroupState;
  buffer: TextBuffer | null;
  project: MdkProject | null;
  file: string;
  initialFragment?: string;
  settings: MdkSettings;
  projectFont: string;
  modelPool: SourceModelPool;
  active: boolean;
  followOutline: boolean;
  theme: ResolvedAppTheme;
  pageLength: number;
  showPageMarkers: boolean;
  headings?: MarkdownHeading[];
  split: boolean;
  label: string;
  busy: boolean;
  editingBlocked: boolean;
  shortcutOverrides?: ShortcutOverrides;
  directoryDirty: boolean;
  notify: Notify;
  execute: (work: () => Promise<unknown>) => Promise<void>;
  flush: () => Promise<boolean>;
  saveDocument: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  changeTab: (tab: EditorTab) => Promise<void>;
  updateContent: (content: string) => void;
  setPagination: (content: string, layout: DocumentPages) => void;
  updatePages: (changes: RichPageChange[]) => RichPageChange[];
  importResources: () => Promise<void>;
  pasteImage: (image: File) => Promise<void>;
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
      initialFragment,
      settings,
      projectFont,
      modelPool,
      active,
      followOutline,
      theme,
      pageLength,
      showPageMarkers,
      headings,
      split,
      label,
      busy,
      editingBlocked,
      shortcutOverrides,
      directoryDirty,
      notify,
      execute,
      flush,
      saveDocument,
      openFile,
      changeTab,
      updateContent,
      setPagination,
      updatePages,
      importResources,
      pasteImage,
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
      tab: selectedTab,
      revision,
      reveal: headingReveal,
      heading: previewHeading,
    } = group;
    const isMarkdown = !!buffer && isManuscript(project, buffer.path);
    const fileKind = editorFileKind(project, activePath);
    const markdown = isMarkdown ? buffer.content : "";
    const visualAvailable = isMarkdown && canEditVisually(markdown);
    const standalone = project?.format === "markdown";
    const tab = editorView(fileKind, selectedTab, markdown, standalone);
    useEffect(() => {
      if (tab !== selectedTab) patch({ tab, outlinePath: undefined });
    }, [selectedTab, tab]);
    const [splitPreview, setSplitPreview] = useState(false);
    const [richEditor, setRichEditorInstance] = useState<Editor | null>(null);
    const setRichEditor = useCallback(
      (editor: Editor | null) => setRichEditorInstance(editor),
      [],
    );
    const sourceEditor = useRef<SourceEditorHandle>(null);
    const sourceHeadings = useMemo(
      () => headings?.slice().sort((a, b) => a.line - b.line),
      [headings],
    );
    const host = useRef<HTMLElement>(null);
    const previewRef = useRef<HTMLElement>(null);
    const pagedPreview = useRef<PagedPreviewHandle>(null);
    const outlineFrame = useRef(0);
    const sourceCursorMoved = useRef(0);
    const lastSourceLine = useRef<{ path: string; line: number } | undefined>(
      undefined,
    );
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
      if (origin !== "source" && origin?.matches(".paged-preview-viewport"))
        return;
      pagedPreview.current?.scrollTo(ratio);
      host.current?.querySelectorAll<HTMLElement>(selectors).forEach((node) => {
        if (node === origin || node.scrollHeight <= node.clientHeight) return;
        expectedScroll.current.set(node, ratio);
        node.scrollTop = ratio * (node.scrollHeight - node.clientHeight);
      });
    }
    const viewportReady = () =>
      requestAnimationFrame(() => {
        scrollTo(getScrollProgress());
        if (tab === "preview") {
          const viewport = host.current?.querySelector<HTMLElement>(
            ".reading-preview,.paged-preview-viewport",
          );
          if (viewport) followViewport(viewport);
        }
      });
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
    const codeBuffer = buffer;
    const contentDirty = !!buffer && buffer.content !== buffer.saved;
    const large = isMarkdown && isLargeDocument(markdown);
    const projectPreviewLarge = useMemo(
      () =>
        project?.mode !== "00" &&
        (project?.files.reduce(
          (bytes, item) => bytes + (item.kind === "markdown" ? item.bytes : 0),
          0,
        ) ?? 0) > 512_000,
      [project?.mode, project?.files],
    );
    const activeEntry = project?.contents.entries.find(
      (e) => e.path === activePath,
    );
    const reserved = useMemo(
      () =>
        reservedSectionNumbers(
          project?.contents.entries.map((entry) => entry.position) ?? [],
        ),
      [project?.contents.entries],
    );
    const activeFile = project?.files.find((f) => f.path === activePath);
    const [resourceData, setResourceData] = useState("");
    useEffect(() => {
      let live = true;
      setResourceData("");
      if (fileKind === "media") {
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
    }, [file, activePath, fileKind]);
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
    const paged =
      isMarkdown &&
      (markdown.length > pageLength ||
        !!buffer?.pagination ||
        (tab === "preview" && projectPreviewLarge)) &&
      (tab === "write" ||
        tab === "preview" ||
        (tab === "source" && splitPreview));
    const layoutText = tab === "write" ? markdown : previewMarkdown;
    const [pageIndex, setPageIndex] = useState(0);
    const [editingPageIndex, setEditingPage] = useState(0);
    const [windowSelection, setWindowSelection] = useState<EditPageWindow>();
    const queuedRichHeading = useRef<MarkdownHeading | null>(null);
    const queuedRichPoint = useRef<PagePoint | null | undefined>(undefined);
    const [cancelled, setCancelled] = useState(false);
    const [savedLayout, setSavedLayout] = useState<{
      text: string;
      layout: DocumentPages;
    }>();
    const storedLayout =
      layoutText === markdown
        ? buffer?.pagination
        : savedLayout?.text === layoutText
          ? savedLayout.layout
          : undefined;
    const layout =
      storedLayout?.length === pageLength ? storedLayout : undefined;
    const page = Math.min(
      pageIndex,
      Math.max(0, (layout?.pages.length ?? 1) - 1),
    );
    const editingPage = Math.min(
      editingPageIndex,
      Math.max(0, (layout?.pages.length ?? 1) - 1),
    );
    const currentPage = paged ? layout?.pages[editingPage] : undefined;
    const editWindow =
      layout && tab === "write" && currentPage && !currentPage.readOnly
        ? windowSelection &&
          windowSelection.last < layout.pages.length &&
          !layout.pages
            .slice(windowSelection.first, windowSelection.last + 1)
            .some(({ readOnly }) => readOnly)
          ? windowSelection
          : editWindowAt(layout, editingPage)
        : undefined;
    const windowPages = useMemo(() => {
      if (!editWindow || !layout) return undefined;
      return layout.pages
        .slice(editWindow.first, editWindow.last + 1)
        .map((entry, offset) => {
          const index = editWindow.first + offset;
          return {
            index,
            text: layoutText.slice(entry.start, layout.pages[index + 1]?.start),
            final: index === layout.pages.length - 1,
          };
        });
    }, [layout, layoutText, editWindow?.first, editWindow?.last]);
    const windowText =
      editWindow && layout
        ? layoutText.slice(
            layout.pages[editWindow.first].start,
            layout.pages[editWindow.last + 1]?.start,
          )
        : "";
    const layoutHeadings = sourceHeadings?.length
      ? sourceHeadings
      : layout?.headings;
    const offset =
      editWindow && layoutHeadings && layout
        ? headingOffsetAtLine(
            layoutHeadings,
            layout.pages[editWindow.first].line,
          )
        : 0;
    const priorHeadingLevels = useMemo(
      () => layoutHeadings?.slice(0, offset).map(({ level }) => level),
      [layoutHeadings, offset],
    );
    const unsupported = useMemo(
      () =>
        tab === "write" &&
        (paged
          ? !!currentPage?.readOnly
          : requiresSourceMode(buffer?.saved ?? "")),
      [tab, paged, currentPage?.readOnly, buffer?.saved],
    );
    const layoutReady = useRef(setPagination);
    layoutReady.current = setPagination;
    useEffect(() => {
      setCancelled(false);
      setPageIndex(0);
      setEditingPage(0);
      setWindowSelection(undefined);
      queuedRichHeading.current = null;
      queuedRichPoint.current = undefined;
    }, [activePath]);
    useLayoutEffect(() => {
      if (tab === "write") {
        setEditingPage(page);
        setWindowSelection(undefined);
      }
    }, [tab]);
    useEffect(() => {
      if (!paged || layout || cancelled) return;
      const timer = setTimeout(
        () => {
          stop = markdownTask<DocumentPages>(
            { kind: "pages", text: layoutText, length: pageLength },
            (result) => {
              if (layoutText === markdown)
                layoutReady.current(layoutText, result);
              else setSavedLayout({ text: layoutText, layout: result });
            },
            (error) => {
              setCancelled(true);
              notify(error, true);
            },
          );
        },
        tab === "source" ? 140 : 0,
      );
      let stop: (() => void) | undefined;
      return () => {
        clearTimeout(timer);
        stop?.();
      };
    }, [
      paged,
      layout,
      cancelled,
      layoutText,
      pageLength,
      activePath,
      tab,
      layoutText === markdown,
    ]);
    const previewMath = usePreviewMath(
      !paged &&
        ((tab === "source" && splitPreview) ||
          (tab === "write" && unsupported)) &&
        mayContainMath(previewMarkdown),
    );
    const previewSettings = useMemo(
      () => ({
        ...settings,
        preview: {
          ...settings.preview,
          show_toc: false,
          show_title:
            project?.mode === "00" || tab === "write" ||
            settings.preview.show_title,
        },
      }),
      [settings, project?.mode, tab],
    );
    const previewHtml = useMemo(() => {
      if (
        !isMarkdown ||
        paged ||
        !((tab === "source" && splitPreview) || unsupported)
      )
        return "";
      return renderPreview(
        previewMarkdown,
        previewSettings,
        activeEntry?.position,
        project?.mode,
        group.id + "-",
        activePath,
        standalone,
        reserved.get(activeEntry?.position ?? ""),
      );
    }, [
      tab,
      splitPreview,
      isMarkdown,
      paged,
      unsupported,
      previewMath,
      previewMarkdown,
      previewSettings,
      activeEntry?.position,
      project?.mode,
      group.id,
      activePath,
      standalone,
      reserved,
    ]);
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
            if (live) image.alt = t("资源不可用：") + src;
          });
      });
      return () => {
        live = false;
      };
    }, [previewHtml, tab, splitPreview, resolveResource]);
    function follow(lineOrViewport: number | HTMLElement) {
      if (!active || !followOutline) return;
      let index = -1;
      let path = activePath;
      if (typeof lineOrViewport === "number") {
        let lo = 0,
          hi = sourceHeadings?.length ?? 0;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (sourceHeadings![mid].line <= lineOrViewport) lo = mid + 1;
          else hi = mid;
        }
        index = sourceHeadings?.[lo - 1]?.index ?? -1;
      } else {
        const viewport = lineOrViewport;
        const rows =
          viewport.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6");
        const readingLine = viewport.getBoundingClientRect().top + 24;
        let lo = 0,
          hi = rows.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (rows[mid].getBoundingClientRect().top <= readingLine)
            lo = mid + 1;
          else hi = mid;
        }
        const row = rows[Math.max(0, lo - 1)];
        if (!row) return;
        path =
          row.closest<HTMLElement>("[data-source-path]")?.dataset.sourcePath ??
          path;
        const numbered = /mdk-heading-(\d+)$/.exec(row.id);
        if (numbered) index = Number(numbered[1]) - 1;
        else {
          const slice = row.closest<HTMLElement>("[data-heading-offset]");
          const localIndex = slice
            ? Array.from(slice.querySelectorAll("h1,h2,h3,h4,h5,h6")).indexOf(
                row,
              )
            : Math.max(0, lo - 1);
          index = Number(slice?.dataset.headingOffset ?? 0) + localIndex;
        }
      }
      if (
        index !== group.activeHeading ||
        path !== (group.outlinePath ?? activePath)
      )
        patch({ activeHeading: index, outlinePath: path });
    }
    const latestFollow = useRef(follow);
    latestFollow.current = follow;
    function followViewport(viewport: HTMLElement) {
      if (!followOutline || !active) return;
      cancelAnimationFrame(outlineFrame.current);
      outlineFrame.current = requestAnimationFrame(() =>
        latestFollow.current(viewport),
      );
    }
    useEffect(() => () => cancelAnimationFrame(outlineFrame.current), []);
    useEffect(() => {
      if (!active || !followOutline) return;
      if (tab === "source")
        follow(
          lastSourceLine.current?.path === activePath
            ? lastSourceLine.current.line
            : (sourceEditor.current?.firstVisibleLine() ?? group.cursor.line),
        );
      if (tab === "preview") {
        const viewport = host.current?.querySelector<HTMLElement>(
          ".reading-preview,.paged-preview-viewport",
        );
        if (viewport) followViewport(viewport);
      }
    }, [active, followOutline, tab, sourceHeadings]);
    useEffect(() => {
      if (!richEditor || !active || !followOutline || tab !== "write") return;
      const update = () => {
        const rows = richEditor.view.dom.querySelectorAll("h1,h2,h3,h4,h5,h6");
        let lo = 0,
          hi = rows.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (
            richEditor.view.posAtDOM(rows[mid], 0) <=
            richEditor.state.selection.from
          )
            lo = mid + 1;
          else hi = mid;
        }
        const index = offset + lo - 1;
        if (index !== group.activeHeading)
          patch({ activeHeading: index, outlinePath: activePath });
      };
      richEditor.on("selectionUpdate", update);
      return () => {
        richEditor.off("selectionUpdate", update);
      };
    }, [
      richEditor,
      active,
      followOutline,
      tab,
      activePath,
      group.activeHeading,
      offset,
    ]);
    useEffect(() => {
      if (previewHeading && previewHeading.path === activePath)
        pagedPreview.current?.jump("mdk-heading-" + (previewHeading.index + 1));
    }, [previewHeading, activePath]);
    function selectEditingPage(index: number) {
      setEditingPage(index);
      if (
        layout &&
        (!editWindow || index < editWindow.first || index > editWindow.last)
      )
        setWindowSelection(editWindowAt(layout, index));
    }
    function activatePage(index: number, point?: PagePoint) {
      queuedRichPoint.current = point ?? null;
      selectEditingPage(index);
    }
    function selectRichHeading(editor: Editor, index: number) {
      let current = 0,
        position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && current++ === index)
          position = pos + 1;
      });
      if (position >= 0)
        editor
          .chain()
          .focus()
          .setTextSelection(position)
          .scrollIntoView()
          .run();
    }
    useLayoutEffect(() => {
      if (!richEditor) return;
      if (queuedRichHeading.current) {
        const heading = queuedRichHeading.current;
        queuedRichHeading.current = null;
        selectRichHeading(richEditor, heading.index - offset);
      } else if (queuedRichPoint.current !== undefined) {
        const point = queuedRichPoint.current;
        queuedRichPoint.current = undefined;
        const position =
          point &&
          ((point.block !== undefined && point.textOffset !== undefined
            ? richPageTextPosition(
                richEditor,
                point.index,
                point.block,
                point.textOffset,
              )
            : undefined) ??
            richEditor.view.posAtCoords({ left: point.x, top: point.y })?.pos);
        richEditor.commands.focus(position ?? "start", {
          scrollIntoView: false,
        });
      }
    }, [richEditor, editWindow?.first, editWindow?.last]);
    useImperativeHandle(
      ref,
      () => ({
        scrollTo,
        jumpHeading(heading) {
          if (tab === "write" && layout && paged) {
            const target = pageAtLine(layout.pages, heading.line);
            if (layout.pages[target].readOnly) {
              pagedPreview.current?.jump("mdk-heading-" + (heading.index + 1));
              return;
            }
            if (
              !editWindow ||
              target < editWindow.first ||
              target > editWindow.last ||
              !richEditor
            ) {
              queuedRichHeading.current = heading;
              selectEditingPage(target);
              pagedPreview.current?.showPage(target);
              return;
            }
          }
          if (!richEditor) {
            previewRef.current
              ?.querySelector(`[id$="mdk-heading-${heading.index + 1}"]`)
              ?.scrollIntoView({ block: "start" });
            return;
          }
          selectRichHeading(richEditor, heading.index - offset);
        },
        dropDraft(x, y, marker) {
          if (tab === "write" && richEditor && editWindow && layout) {
            const transaction = richDropTransaction(richEditor, x, y, marker);
            return {
              marker,
              content: replacePages(
                markdown,
                layout,
                richPageDraft(richEditor, transaction),
              ).content,
            };
          }
          const draft =
            tab === "write" && richEditor
              ? richDropDraft(richEditor, x, y, marker)
              : sourceEditor.current?.dropDraft(x, y, marker);
          if (!draft) throw new Error(t("编辑器尚未就绪。"));
          return draft;
        },
        applyValue(content) {
          if (tab === "write" && paged) return;
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
        format(action) {
          if (!richEditor?.isEditable || !richEditor.view.hasFocus()) return;
          if (
            ("level" in action || "block" in action) &&
            richEditor.isActive("table")
          )
            return;
          if ("command" in action) richEditor.commands[action.command]();
          else if (action.level)
            richEditor.commands.setHeading({ level: action.level });
          else richEditor.commands.setParagraph();
        },
      }),
      [richEditor, tab, layout, editWindow, offset, paged, markdown],
    );
    const setCursor = (cursor: { line: number; column: number }) =>
      patch({ cursor });
    const style = {
      ...settingsToCss(settings),
      ...(projectFont ? { "--preview-font-family": projectFont } : {}),
      zoom: group.zoom / 100,
    } as CSSProperties;
    const projectTheme = settings.appearance.theme;
    const documentTheme = ["light", "dark", "warm", "system"].includes(
      projectTheme,
    )
      ? projectTheme
      : undefined;
    const choices = [
      ...new Set([
        activePath,
        ...(project?.files
          .filter((f) => f.kind !== "directory")
          .map((f) => f.path) ?? []),
        "settings.toml",
      ]),
    ].filter(Boolean);
    const renderRich = (text: string, paginated: boolean) => (
      <div
        className={paginated ? "paged-editor-slice" : "document-paper"}
        style={paginated ? undefined : style}
        data-document-drop-zone="write"
        data-document-path={activePath}
        onClick={(event) => {
          if (standalone && (event.ctrlKey || event.metaKey))
            followPreviewLink(
              event,
              activePath,
              true,
              () => {},
              (error) => notify(error, true),
            );
        }}
      >
        <RichEditor
          key={activePath + (paginated ? ":paged" : "")}
          content={text}
          chapterPosition={
            project?.mode === "01" && settings.mode.book.chapter_numbering
              ? activeEntry?.position
              : undefined
          }
          priorHeadingLevels={paginated ? priorHeadingLevels : undefined}
          reservedSections={reserved.get(activeEntry?.position ?? "")}
          revision={revision}
          editable={!editingBlocked && !project?.readonly}
          onChange={updateContent}
          pageWindow={
            paginated && windowPages && layout && editWindow
              ? {
                  pages: windowPages,
                  update: updatePages,
                  expand: (direction) => {
                    const next = shiftEditWindow(layout, editWindow, direction);
                    if (next === editWindow) return;
                    pagedPreview.current?.preserve();
                    setWindowSelection(next);
                  },
                }
              : undefined
          }
          onReady={setRichEditor}
          resolveResource={resolveResource}
        />
      </div>
    );
    return (
      <section
        ref={host}
        className={"editor-group " + (active ? "active-editor-group" : "")}
        data-editor-group={group.id}
        data-document-theme={documentTheme}
        role="region"
        aria-label={label + t("编辑组")}
        tabIndex={-1}
        onPointerDownCapture={() => {
          sourceCursorMoved.current = 0;
          onActivate();
        }}
        onFocusCapture={onActivate}
        onWheelCapture={() => {
          sourceCursorMoved.current = 0;
          onActivate();
        }}
        onLoadCapture={paged ? undefined : viewportReady}
        onScrollCapture={(event) => {
          const node = event.target;
          if (
            !(node instanceof HTMLElement) ||
            (paged && node.matches(".paged-inline")) ||
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
          followViewport(node);
        }}
      >
        {split && (
          <header className="editor-group-heading">
            <span>{label}</span>
            <Select
              aria-label={label + t("文件")}
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
              aria-label={t("关闭") + label}
              title={t("关闭") + label}
              disabled={busy}
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </header>
        )}
        <div className="document-tabs">
          <div
            className="document-mode-tabs"
            role="tablist"
            aria-label={t("编辑模式")}
          >
            {[
              { id: "source", name: t("源码"), icon: Braces },
              { id: "write", name: t("可视化"), icon: Pencil },
              { id: "preview", name: t("预览"), icon: Eye },
              { id: "settings", name: t("工程设置"), icon: Settings2 },
            ].map((item) => (
              <button
                role="tab"
                key={item.id}
                aria-label={item.name}
                aria-selected={tab === item.id}
                title={
                  item.id === "write" && isMarkdown && !visualAvailable
                    ? t("此文稿可使用源码编辑或分页预览")
                    : undefined
                }
                className={tab === item.id ? "active" : ""}
                disabled={
                  busy ||
                  !project ||
                  !fileKind ||
                  (item.id === "write" && !visualAvailable) ||
                  editorView(
                    fileKind,
                    item.id as EditorTab,
                    markdown,
                    standalone,
                  ) !== item.id
                }
                onClick={() =>
                  void execute(() => changeTab(item.id as EditorTab))
                }
              >
                <item.icon size={15} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
          <div className="document-view-actions">
            {tab === "source" && isMarkdown && (
              <button
                aria-label={t("切换源码与预览分栏")}
                title={t("源码与预览分栏")}
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
                {t("撤销文件更改")}
              </button>
            )}
            {tab === "write" && unsupported && (
              <button
                className="text-button"
                onClick={() => void execute(() => changeTab("source"))}
              >
                {t("切换到源码")}
              </button>
            )}
            <PageNavigation
              key={activePath}
              page={paged ? page : 0}
              count={
                paged
                  ? (layout?.pages.length ?? 0)
                  : isMarkdown &&
                      (tab === "write" ||
                        tab === "preview" ||
                        (tab === "source" && splitPreview))
                    ? 1
                    : 0
              }
              disabled={busy || !paged}
              onPage={(index) => {
                if (tab === "write") selectEditingPage(index);
                pagedPreview.current?.showPage(index);
              }}
            />
          </div>
        </div>
        {project && !["00", "01", "02"].includes(project.mode) && (
          <p className="source-warning">
            {t("未知 mode")} {project.mode}
            {t(
              "：只读显示基础内容，其附加约束未验证。可显式切换到 00 后编辑。",
            )}
          </p>
        )}
        {project &&
          project.issues.filter((issue) => issue.severity === "error").length >
            0 && (
            <details className="project-diagnostics">
              <summary>
                {t("工程有")}{" "}
                {
                  project.issues.filter((issue) => issue.severity === "error")
                    .length
                }{" "}
                {t("项待处理问题；允许保存，交付前须修复")}
              </summary>
              {project.issues
                .filter((issue) => issue.severity === "error")
                .map((issue, index) => (
                  <p key={index}>
                    {issue.path}
                    {t("：")}
                    {issue.message}
                  </p>
                ))}
            </details>
          )}
        {tab === "write" && richEditor && !unsupported && (
          <RichToolbar
            editor={richEditor}
            shortcutOverrides={shortcutOverrides}
            disabled={busy || !!project?.readonly}
            sourceEditable={!busy && !project?.readonly}
            sourceText={paged ? windowText : markdown}
            notify={notify}
            sourcePath={activePath}
            files={project?.files ?? []}
            onImport={importResources}
            onSourceInsert={async (text) => {
              const content =
                editWindow && layout
                  ? replacePage(
                      markdown,
                      layout,
                      editWindow.first,
                      text,
                      editWindow.last,
                    ).content
                  : text;
              await execute(async () => {
                await changeTab("source");
                if (sourceEditor.current)
                  sourceEditor.current.applyValue(content);
                else updateContent(content);
              });
              requestAnimationFrame(() => sourceEditor.current?.focus());
            }}
          />
        )}
        <div
          className={`document-canvas ${tab === "source" ? "source-canvas" : ""}`}
          onPasteCapture={(event) => {
            if (!isMarkdown || !["source", "write"].includes(tab)) return;
            if (tab === "write" && !richEditor) return;
            const image = Array.from(event.clipboardData.files).find((file) =>
              file.type.startsWith("image/"),
            );
            if (!image) return;
            event.preventDefault();
            event.stopPropagation();
            void pasteImage(image).catch((error) =>
              notify(String(error), true),
            );
          }}
        >
          {codeBuffer &&
            (tab === "source" || (!large && sourceEditor.current)) && (
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
                      {project?.encoding ?? "UTF-8"} ·{" "}
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
                          {t("按标题拆分")}
                        </button>
                      )}
                    <button
                      className="button small"
                      disabled={busy || !contentDirty}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void saveDocument()}
                    >
                      {t("保存源码")}
                    </button>
                  </div>
                  {project?.encoding === "GB18030" && (
                    <p className="source-warning">
                      {t("修改后保存时将转为 UTF-8。")}
                    </p>
                  )}
                  {["contents.toml", "mimetype"].includes(codeBuffer.path) && (
                    <p className="source-warning">
                      {directoryDirty && codeBuffer.path === "contents.toml"
                        ? t(
                            "目录有待同步变更，源码显示上次保存的版本。请先点击“更新目录”。",
                          )
                        : t("关键工程文件，保存前执行格式校验。")}
                    </p>
                  )}
                  <Suspense
                    fallback={
                      <p className="editor-loading">
                        {t("正在加载源码编辑器…")}
                      </p>
                    }
                  >
                    <SourceEditor
                      theme={theme}
                      ref={sourceEditor}
                      modelPool={modelPool}
                      onViewportReady={viewportReady}
                      onScroll={
                        tab === "source"
                          ? (ratio, line) => {
                              const expected = expectedSourceScroll.current;
                              const programmatic =
                                expected != null &&
                                Math.abs(expected - ratio) < 0.004;
                              reportScroll(ratio, "source");
                              // A keyboard caret jump also scrolls Monaco. Keep
                              // the caret's heading until scrolling resumes.
                              if (
                                !programmatic &&
                                Date.now() - sourceCursorMoved.current > 150
                              ) {
                                lastSourceLine.current = {
                                  path: activePath,
                                  line,
                                };
                                follow(line);
                              }
                            }
                          : undefined
                      }
                      reveal={headingReveal}
                      path={codeBuffer.path}
                      value={codeBuffer.content}
                      files={project?.files ?? []}
                      zoom={group.zoom}
                      largeDocument={large}
                      readOnly={
                        project?.readonly ||
                        (project?.settings_readonly &&
                          codeBuffer.path === "settings.toml") ||
                        editingBlocked ||
                        tab !== "source" ||
                        !buffer ||
                        (directoryDirty && codeBuffer.path === "contents.toml")
                      }
                      onChange={updateContent}
                      onPosition={(line, column) => {
                        if (tab !== "source") return;
                        sourceCursorMoved.current = Date.now();
                        lastSourceLine.current = { path: activePath, line };
                        setCursor({ line, column });
                        follow(line);
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
                  if (await flush()) notify(t("工程设置已保存。"));
                })
              }
              onSource={() => void execute(() => openFile("settings.toml"))}
            />
          ) : paged ? (
            <PagedPreview
              key={activePath + ":" + pageLength}
              ref={pagedPreview}
              className={tab === "source" ? "inline-preview paged-inline" : ""}
              args={[
                layoutText,
                previewSettings,
                activeEntry?.position,
                project?.mode,
                group.id + "-",
                activePath,
                standalone,
                reserved.get(activeEntry?.position ?? ""),
              ]}
              layout={layout}
              onPage={setPageIndex}
              headings={sourceHeadings}
              showMarkers={showPageMarkers}
              preparing={!cancelled}
              onTogglePreparing={() => setCancelled(!cancelled)}
              editor={
                tab === "write" && layout
                  ? {
                      range: editWindow,
                      content:
                        editWindow && !unsupported
                          ? renderRich(windowText, true)
                          : undefined,
                      activate: activatePage,
                    }
                  : undefined
              }
              initialFragment={initialFragment}
              style={style}
              resolveResource={resolveResource}
              onOpen={(path) => void execute(() => openFile(path))}
              onError={(error) => notify(error, true)}
              onScroll={(ratio, viewport, programmatic) => {
                if (!programmatic) reportScroll(ratio, viewport);
                followViewport(viewport);
              }}
            />
          ) : tab === "preview" &&
            fileKind === "media" &&
            activeFile &&
            project ? (
            <MediaPreview
              file={file}
              current={activeFile}
              data={resourceData}
              files={project.files}
              settings={settings}
              mode={project.mode}
              onSelect={(path) => void execute(() => openFile(path))}
            />
          ) : tab === "preview" && project ? (
            <ReadingPreview
              onLayout={viewportReady}
              file={file}
              project={project}
              settings={settings}
              style={style}
              onOpen={(path) => void execute(() => openFile(path))}
              onError={(error) => notify(error, true)}
              initialFragment={initialFragment}
              activeDocument={
                isMarkdown && buffer
                  ? { path: buffer.path, markdown: previewMarkdown }
                  : undefined
              }
              heading={previewHeading}
            />
          ) : buffer ? (
            <>
              {tab === "write" && (
                <div className="paper-wrapper">
                  {unsupported ? (
                    <article
                      className="document-paper preview-body"
                      style={style}
                      ref={previewRef}
                      onClick={(event) =>
                        followPreviewLink(
                          event,
                          activePath,
                          standalone,
                          (path) => void execute(() => openFile(path)),
                          (error) => notify(error, true),
                        )
                      }
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  ) : (
                    renderRich(buffer.content, false)
                  )}
                </div>
              )}
              {tab === "source" && splitPreview && isMarkdown && (
                <div
                  className={
                    tab === "source" ? "inline-preview" : "paper-wrapper"
                  }
                >
                  <article
                    className="document-paper preview-body"
                    style={style}
                    ref={previewRef}
                    onClick={(event) =>
                      followPreviewLink(
                        event,
                        activePath,
                        standalone,
                        (path) => void execute(() => openFile(path)),
                        (error) => notify(error, true),
                      )
                    }
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="workspace-empty">
              <p>
                {activeEntry
                  ? t("文稿文件缺失：") +
                    activeEntry.path +
                    t(
                      "。请在整体目录中恢复同名文件，或显式删除目录项；不会自动创建空白正文。",
                    )
                  : t("从左侧选择文稿或工程文件。")}
              </p>
            </div>
          )}
        </div>
      </section>
    );
  },
);
