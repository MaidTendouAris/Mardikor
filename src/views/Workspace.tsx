import { appLocale, t } from "../../shared/i18n";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useMemo,
  lazy,
  Suspense,
} from "react";
import {
  Check,
  FileCode2,
  FilePlus2,
  FolderPlus,
  ListChecks,
  FolderOpen,
  FolderSearch,
  GripVertical,
  ImagePlus,
  LoaderCircle,
  Minus,
  PencilLine,
  Plus,
  Save,
  Search,
  Send,
  Settings2,
  Columns2,
  ListTree,
  Files,
} from "lucide-react";
import { stringify } from "smol-toml";
import { HeadingOutline } from "../components/HeadingOutline";
import { Select } from "../components/Select";
import { EditorGroup, type EditorGroupHandle } from "../components/EditorGroup";
import { SplitHandle } from "../components/SplitHandle";
import { EditorDialog } from "../components/EditorMenu";
import type { SourceModelPool } from "../components/SourceEditor";
import { isResourcePath, type NativeDocumentDrop } from "../../shared/resources";
import { ProjectTree, type TreeAction } from "../components/ProjectTree";
import { desktop } from "../services/desktop";
import {
  adjustOutline,
  moveOutline,
  moveOutlineToIndex,
} from "../../shared/tree";
import { comparePosition } from "../../shared/outline";
import {
  splitMarkdownByHeading,
  requiresSourceMode,
  type MarkdownHeading,
} from "../../shared/markdown";
import { defaultSettings } from "../../shared/defaults";
import { isManuscript } from "../../shared/workspace";
import {
  editorFileKind,
  editorView,
  newEditorGroup,
  textSnapshot,
  type EditorGroupState,
  type EditorTab as Tab,
  type TextBuffer as Buffer,
} from "../services/editor-groups";
import type {
  MdkEntry,
  MdkProject,
  MdkSettings,
  ResourceKind,
} from "../../shared/mdk";
import {
  defaultPageLength,
  type Preferences,
  type ResolvedAppTheme,
} from "../../shared/desktop";
import type { Ask, Notify } from "../App";
import { previewTextLimit } from "../services/document-size";
import { replacePages } from "../services/document-pages";
import { useMarkdownHeadings } from "../services/markdown-tasks";
import {
  shortcuts,
  shortcutKey,
  shortcutFromEvent,
  visualNativeKeys,
} from "../../shared/shortcuts";

export interface WorkspaceHandle {
  flush: () => Promise<boolean>;
  refresh: () => Promise<void>;
}
const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;
const sourceOnly = requiresSourceMode;
const [saveShortcut, splitShortcut] = shortcuts;
const ConflictDiff = lazy(async () => {
  if (document.documentElement.lang === "zh-CN")
    await import("monaco-editor/nls/lang/zh-cn.js");
  const module = await import("../components/SourceEditor");
  return { default: module.ConflictDiff };
});

export const Workspace = forwardRef<
  WorkspaceHandle,
  {
    file: string;
    initialProject?: MdkProject;
    initialView?: Tab;
    initialFragment?: string;
    preferences: Preferences;
    shortcutsEnabled: boolean;
    theme: ResolvedAppTheme;
    ask: Ask;
    notify: Notify;
    onDirty: (dirty: boolean) => void;
    onOpen: () => void;
    onRename: (path: string) => void;
    onDeliver: () => void;
  }
>(function Workspace(
  {
    file,
    initialProject,
    initialView = "preview",
    initialFragment,
    preferences,
    shortcutsEnabled,
    theme,
    ask,
    notify,
    onDirty,
    onOpen,
    onRename,
    onDeliver,
  },
  ref,
) {
  const [draftReady, setDraftReady] = useState(false);
  const [project, setProjectState] = useState<MdkProject | null>(null);
  const projectRef = useRef(project);
  function setProject(loaded: MdkProject) {
    projectRef.current = loaded;
    setProjectState(loaded);
  }
  const standalone = project?.format === "markdown";
  const [treeView, setTreeView] = useState<"outline" | "files">("outline");
  const [settings, setSettings] = useState<MdkSettings>(defaultSettings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [directoryDirty, setDirectoryDirty] = useState(false);
  const [operation, setOperation] = useState<"work" | "save" | null>(null);
  const busy = operation !== null;
  const [query, setQuery] = useState("");
  const [resourceKind, setResourceKind] = useState<ResourceKind>("image");
  const [fileSelection, setFileSelection] = useState<Set<string>>();
  useEffect(() => setFileSelection(undefined), [file]);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [lastSaved, setLastSaved] = useState("");
  const [manualSave, setManualSave] = useState<"saving" | "saved">();
  const manualSavePending = useRef(false);
  const saveFeedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(saveFeedbackTimer.current), []);
  const [diskChange, setDiskChange] = useState<{ revision: string | null }>();
  const lastAutoReload = useRef<typeof diskChange>(undefined);
  const [comparison, setComparison] = useState<{
    path: string;
    local: string;
    disk: string;
    truncated: boolean;
  }>();
  const [cliInfo, setCliInfo] = useState(false);
  const [projectFont, setProjectFont] = useState("");
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const [groups, setGroups] = useState<EditorGroupState[]>(() => [
    newEditorGroup(),
  ]);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const [activeId, setActiveId] = useState(groups[0].id);
  const activeGroup = groups.find((g) => g.id === activeId) ?? groups[0];
  const activePath = activeGroup.path,
    tab = activeGroup.tab,
    zoom = activeGroup.zoom,
    cursor = activeGroup.cursor,
    activeHeading = activeGroup.activeHeading;
  const buffer = buffers[activePath] ?? null;
  const groupEditors = useRef<Record<string, EditorGroupHandle | null>>({});
  const [modelPool] = useState<SourceModelPool>(() => ({
    id: crypto.randomUUID(),
    models: new Map(),
  }));
  useEffect(
    () => () => {
      modelPool.models.forEach((model) => model.dispose());
      modelPool.models.clear();
    },
    [modelPool],
  );
  const [sidebarRatio, setSidebarRatio] = useState(0.5);
  const pageLength = preferences.pageLength ?? defaultPageLength;
  const saveKey = shortcutKey(saveShortcut, preferences.shortcuts);
  const splitKey = shortcutKey(splitShortcut, preferences.shortcuts);
  const sidebarSections = useRef<HTMLDivElement>(null);
  const [groupRatio, setGroupRatio] = useState(0.5);
  const groupContainer = useRef<HTMLDivElement>(null);
  const scrollProgress = useRef(0);
  const fileProgress = useRef(new Map<string, number>());
  function syncScroll(origin: string, ratio: number) {
    const source = groupsRef.current.find((g) => g.id === origin);
    if (!source) return;
    scrollProgress.current = Math.max(0, Math.min(1, ratio));
    for (const group of groupsRef.current) {
      fileProgress.current.set(group.path, scrollProgress.current);
      if (group.id !== origin)
        groupEditors.current[group.id]?.scrollTo(scrollProgress.current);
    }
  }
  function patchGroup(
    id: string,
    patch:
      | Partial<EditorGroupState>
      | ((g: EditorGroupState) => Partial<EditorGroupState>),
  ) {
    const next = groupsRef.current.map((g) =>
      g.id === id
        ? { ...g, ...(typeof patch === "function" ? patch(g) : patch) }
        : g,
    );
    groupsRef.current = next;
    setGroups(next);
  }
  function putBuffer(next: Buffer) {
    buffersRef.current = { ...buffersRef.current, [next.path]: next };
    setBuffers(buffersRef.current);
  }
  const setBuffer = putBuffer;
  const setActivePath = (path: string) => patchGroup(activeId, { path });
  const setTab = (tab: Tab) => patchGroup(activeId, { tab });
  const setRevision = (update: (n: number) => number) =>
    patchGroup(activeId, (g) => ({ revision: update(g.revision) }));
  const setActiveHeading = (activeHeading: number) =>
    patchGroup(activeId, { activeHeading });
  const setZoom = (zoom: number) => patchGroup(activeId, { zoom });
  const locked = useRef(false);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const contentDirty = !!buffer && buffer.content !== buffer.saved;
  const dirtyBuffers = Object.values(buffers).filter(
    (b) => b.content !== b.saved,
  );
  const dirty = dirtyBuffers.length > 0 || directoryDirty || settingsDirty;
  const activeEntry = project?.contents.entries.find(
    (entry) => entry.path === activePath,
  );
  const isMarkdown = !!buffer && isManuscript(project, buffer.path);
  const markdown = isMarkdown ? buffer.content : "";
  const followOutline = preferences.followOutline !== false;
  const outlinePath =
    followOutline && tab === "preview"
      ? (activeGroup.outlinePath ?? activePath)
      : activePath;
  const outlineBuffer = buffers[outlinePath];
  const [outlineText, setOutlineText] = useState<{
    path: string;
    text: string;
  }>();
  useEffect(() => {
    if (
      !outlinePath ||
      outlinePath === activePath ||
      outlineBuffer ||
      !isManuscript(project, outlinePath)
    )
      return;
    let live = true;
    void desktop()
      .invoke("readText", file, outlinePath)
      .then(
        ({ content }) => {
          if (live) setOutlineText({ path: outlinePath, text: content });
        },
        () => {
          if (live) setOutlineText(undefined);
        },
      );
    return () => {
      live = false;
    };
  }, [file, outlinePath, activePath, outlineBuffer, project?.revision]);
  const outlineSource =
    outlinePath === activePath
      ? markdown
      : (outlineBuffer?.content ??
        (outlineText?.path === outlinePath ? outlineText.text : ""));
  const headings = useMarkdownHeadings(outlinePath, outlineSource);
  const groupPaths = groups.map((group) => group.path).join("\0");
  useEffect(() => {
    const open = new Set(groupPaths.split("\0"));
    const current = buffersRef.current;
    const next = Object.fromEntries(
      Object.entries(current).filter(
        ([path, buffer]) => open.has(path) || buffer.content !== buffer.saved,
      ),
    );
    if (Object.keys(current).length !== Object.keys(next).length) {
      buffersRef.current = next;
      setBuffers(next);
    }
  }, [groupPaths]);
  const characterCount = useMemo(() => {
    if (markdown.length > previewTextLimit) return markdown.length;
    let count = 0;
    for (const _character of markdown) count++;
    return count;
  }, [markdown]);
  useEffect(() => {
    const source = settings.appearance.font_family;
    if (!source.startsWith("resources/font/")) {
      setProjectFont("");
      return;
    }
    let live = true;
    let font: FontFace | null = null;
    void desktop()
      .invoke("readResource", file, source)
      .then(async (data) => {
        font = new FontFace("MardikorProjectFont", `url(${data})`);
        await font.load();
        if (live) {
          document.fonts.add(font);
          setProjectFont("MardikorProjectFont");
        }
      })
      .catch((error) => {
        if (live) {
          setProjectFont("");
          notify(String(error), true);
        }
      });
    return () => {
      live = false;
      if (font) document.fonts.delete(font);
    };
  }, [file, settings.appearance.font_family, notify]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(
    () =>
      window.mardikor?.onProjectChanged((target, revision) => {
        if (target === file) setDiskChange({ revision });
      }),
    [file],
  );

  useEffect(() => {
    if (!draftReady || !project || busy) return;
    const delay = dirtyBuffers.some(
      ({ content }) => content.length > previewTextLimit,
    )
      ? 3000
      : 500;
    const timer = setTimeout(() => {
      void desktop()
        .recovery(
          file,
          dirty
            ? {
                revision: project.revision,
                ...textSnapshot(dirtyBuffers),
                ...(directoryDirty
                  ? {
                      positions: project.contents.entries.map(
                        ({ id, position }) => ({ id, position }),
                      ),
                    }
                  : {}),
                ...(settingsDirty ? { settings } : {}),
              }
            : null,
        )
        .catch((error) =>
          notify(t("恢复草稿保存失败：") + String(error), true),
        );
    }, delay);
    return () => clearTimeout(timer);
  }, [
    draftReady,
    file,
    dirty,
    buffers,
    settings,
    settingsDirty,
    directoryDirty,
    project,
    busy,
    notify,
  ]);
  async function execute(work: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true;
    setOperation("work");
    try {
      await work();
    } catch (error) {
      notify(String(error).replace(/^Error: /, ""), true);
    } finally {
      locked.current = false;
      setOperation(null);
    }
  }
  async function jumpHeading(heading: MarkdownHeading) {
    setActiveHeading(heading.index);
    if (tab === "write") {
      groupEditors.current[activeId]?.jumpHeading(heading);
      return;
    }
    if (tab === "preview") {
      patchGroup(activeId, {
        heading: { path: outlinePath, index: heading.index, key: Date.now() },
      });
      return;
    }
    if (tab !== "source" && !(await flush(false))) return;
    patchGroup(activeId, {
      tab: "source",
      reveal: { path: activePath, line: heading.line, key: Date.now() },
    });
  }
  async function insertDrop(drop: NativeDocumentDrop) {
    if (drop.error) {
      notify(drop.error, true);
      return;
    }
    const target = groupsRef.current.find(
      (g) => g.id === (drop.group ?? activeId),
    );
    const current = target && buffersRef.current[target.path];
    if (
      !drop.token ||
      !project ||
      !target ||
      !current ||
      project.readonly ||
      drop.document !== current.path ||
      drop.target !== target.tab ||
      !isManuscript(project, current.path)
    ) {
      notify(
        t("当前文稿不可插入资源，请在可编辑的 Markdown 正文中重试。"),
        true,
      );
      return;
    }
    if (locked.current) {
      notify(t("正在处理工程，请稍后重新拖入。"), true);
      return;
    }
    const marker = "MDKDROP" + crypto.randomUUID().replaceAll("-", "");
    const editor = groupEditors.current[target.id];
    const draft = editor?.dropDraft(drop.x, drop.y, marker);
    if (!draft || !editor) throw new Error(t("编辑器尚未就绪。"));
    setActiveId(target.id);
    await execute(async () => {
      const others = Object.values(buffersRef.current).filter(
        (b) => b.path !== current.path && b.content !== b.saved,
      );
      const result = await desktop().invoke(
        "insertResources",
        file,
        drop.token!,
        {
          revision: project.revision,
          text: { path: current.path, content: draft.content },
          marker,
          ...(others.length
            ? { texts: others.map(({ path, content }) => ({ path, content })) }
            : {}),
          ...(directoryDirty
            ? {
                positions: project.contents.entries.map(({ id, position }) => ({
                  id,
                  position,
                })),
              }
            : {}),
          ...(settingsDirty ? { settings } : {}),
        },
      );
      editor.applyValue(result.content);
      for (const b of others)
        putBuffer({ ...buffersRef.current[b.path], saved: b.content });
      putBuffer({
        path: current.path,
        content: result.content,
        saved: result.content,
      });
      setProject(result.project);
      setSettings(result.project.settings);
      setDirectoryDirty(false);
      setSettingsDirty(false);
      await desktop().recovery(file, null);
      notify(t("已插入 ") + result.resources.length + t(" 个资源。"));
    });
  }
  async function insertFromPicker(groupId: string) {
    const group = groupsRef.current.find((item) => item.id === groupId);
    if (!group || project?.readonly || locked.current) return;
    const picked = await desktop().pickDocumentResources();
    if (picked)
      await insertDrop({
        ...picked,
        group: groupId,
        document: group.path,
        target: group.tab === "write" ? "write" : "source",
        x: -1,
        y: -1,
      });
  }
  async function pasteImage(groupId: string, image: File) {
    const group = groupsRef.current.find((item) => item.id === groupId);
    if (!group || project?.readonly || locked.current) return;
    if (image.size > 16 * 1024 * 1024)
      throw new Error(t("剪贴板图片超过 16 MiB。"));
    const pasted = await desktop().pasteDocumentImage(
      new Uint8Array(await image.arrayBuffer()),
      image.type,
    );
    await insertDrop({
      ...pasted,
      group: groupId,
      document: group.path,
      target: group.tab === "write" ? "write" : "source",
      x: -1,
      y: -1,
    });
  }
  const dropHandler = useRef(insertDrop);
  dropHandler.current = insertDrop;
  useEffect(
    () =>
      window.mardikor?.onDocumentDrop((drop) => {
        void dropHandler
          .current(drop)
          .catch((error) => notify(String(error), true));
      }),
    [file, notify],
  );
  async function loadFile(
    path: string,
    loaded: MdkProject,
    view: Tab = "source",
    groupId = activeId,
  ) {
    const item = loaded.files.find((f) => f.path === path);
    if (item?.kind === "directory") return;
    const kind = editorFileKind(loaded, path);
    let current: Buffer | undefined = buffersRef.current[path];
    if (kind === "markdown" || kind === "text") {
      if (!current || current.content === current.saved) {
        const content = item
          ? (await desktop().invoke("readText", file, path)).content
          : stringify(loaded.settings);
        current = {
          path,
          content,
          saved: item ? content : "",
          pagination:
            current?.content === content ? current.pagination : undefined,
        };
        putBuffer(current);
      }
    } else if (current) {
      const next = { ...buffersRef.current };
      delete next[path];
      buffersRef.current = next;
      setBuffers(next);
      current = undefined;
    }
    const tab = editorView(
      kind,
      view,
      current?.content,
      loaded.format === "markdown",
    );
    patchGroup(groupId, (g) => ({
      path,
      tab:
        tab === "write" &&
        current &&
        current.content.length <= pageLength &&
        sourceOnly(current.content)
          ? "source"
          : tab,
      activeHeading: -1,
      outlinePath: undefined,
      revision: g.revision + 1,
      reveal: undefined,
      heading: undefined,
    }));
  }
  async function refreshBuffers(
    loaded: MdkProject,
    from?: string,
    to?: string,
  ) {
    const remap = (p: string) =>
      from && to && (p === from || p.startsWith(from + "/"))
        ? to + p.slice(from.length)
        : p;
    if (from && to) {
      // oxlint-disable-next-line unicorn/no-useless-spread -- Snapshot entries before replacing keys in this Map.
      for (const [path, progress] of [...fileProgress.current]) {
        const next = remap(path);
        if (next !== path) {
          fileProgress.current.delete(path);
          fileProgress.current.set(next, progress);
        }
      }
    }
    const next: Record<string, Buffer> = {};
    for (const current of Object.values(buffersRef.current)) {
      const path = remap(current.path);
      if (!loaded.files.some((f) => f.path === path && f.is_text)) continue;
      if (current.content !== current.saved) next[path] = { ...current, path };
      else {
        const content = (await desktop().invoke("readText", file, path))
          .content;
        next[path] = { path, content, saved: content };
      }
    }
    buffersRef.current = next;
    setBuffers(next);
    const fallback = loaded.contents.entries[0]?.path ?? "contents.toml";
    for (const group of groupsRef.current) {
      const path = remap(group.path);
      if (!loaded.files.some((f) => f.path === path))
        await loadFile(fallback, loaded, "source", group.id);
      else patchGroup(group.id, (g) => ({ path, revision: g.revision + 1 }));
    }
  }
  const openedPath = useRef(file);
  useEffect(() => {
    const file = openedPath.current;
    if (!file || !initialProject) return;
    let live = true;
    setOperation("work");
    void (async () => {
      const loaded = {
        ...initialProject,
        contents: { ...initialProject.contents },
      };
      if (!live) return;
      setProject(loaded);
      setSettings(loaded.settings);
      const first = [...loaded.contents.entries].sort((a, b) =>
        comparePosition(a.position, b.position),
      )[0];
      await loadFile(first?.path ?? "contents.toml", loaded, initialView);
      if (!live) return;
      const draft = await desktop().recovery(file);
      if (!live) return;
      if (
        draft &&
        (await ask({
          title: t("恢复未提交的草稿？"),
          description:
            draft.revision === loaded.revision
              ? t("检测到上次未提交的正文、控制文件或目录更改。")
              : t(
                  "检测到草稿，但磁盘工程已有其他修改。恢复后将保留冲突保护，不能直接覆盖磁盘。",
                ),
          confirm: t("恢复草稿"),
        }))
      ) {
        if (!live) return;
        if (draft.positions) {
          const positions = new Map(
            draft.positions.map((item) => [item.id, item.position]),
          );
          loaded.contents.entries = loaded.contents.entries.map((entry) => ({
            ...entry,
            position: positions.get(entry.id) ?? entry.position,
          }));
          setDirectoryDirty(true);
        }
        const texts = [
          ...(draft.text ? [draft.text] : []),
          ...(draft.texts ?? []),
        ];
        for (const text of texts) {
          let saved = "";
          try {
            saved = (await desktop().invoke("readText", file, text.path))
              .content;
          } catch {
            /* Missing source retained in recovery. */
          }
          if (!live) return;
          putBuffer({ ...text, saved });
        }
        if (texts.length) {
          setActivePath(texts[0].path);
          setTab("source");
          if (texts.length > 1) {
            const recovered = texts
              .slice(0, 2)
              .map((text) => newEditorGroup(text.path));
            groupsRef.current = recovered;
            setGroups(recovered);
            setActiveId(recovered[0].id);
          }
        }
        if (draft.settings) {
          setSettings(draft.settings);
          setSettingsDirty(true);
        }
        loaded.revision = draft.revision;
        setProject({ ...loaded });
      } else if (live && draft) await desktop().recovery(file, null);
      if (live) setDraftReady(true);
    })()
      .catch((error) => notify(String(error), true))
      .finally(() => {
        if (live) setOperation(null);
      });
    return () => {
      live = false;
    };
  }, [initialProject, initialView, initialFragment]);

  function makeSnapshot(submitted = Object.values(buffersRef.current)) {
    const project = projectRef.current!;
    return {
      revision: project.revision,
      ...textSnapshot(submitted),
      ...(directoryDirty
        ? {
            positions: project.contents.entries.map(({ id, position }) => ({
              id,
              position,
            })),
          }
        : {}),
      ...(settingsDirty ? { settings } : {}),
    };
  }
  async function reloadDisk(discard = false) {
    if (
      discard &&
      dirty &&
      !(await ask({
        title: t("丢弃本地修改并重新加载？"),
        description: t(
          "重新加载将使用磁盘版本。需要保留本地修改时，可以先另存草稿副本。",
        ),
        confirm: t("重新加载磁盘版本"),
        danger: true,
      }))
    )
      return;
    await execute(async () => {
      const loaded = await desktop().invoke("open", file);
      const fallback = loaded.contents.entries[0]?.path ?? "contents.toml";
      const next: Record<string, Buffer> = {};
      const updated = [];
      for (const group of groupsRef.current) {
        const path =
          loaded.files.some((item) => item.path === group.path) ||
          (group.path === "settings.toml" && loaded.format !== "markdown")
            ? group.path
            : fallback;
        const item = loaded.files.find((item) => item.path === path);
        if (
          !next[path] &&
          (item?.is_text || (path === "settings.toml" && !item))
        ) {
          const content = item
            ? (await desktop().invoke("readText", file, path)).content
            : stringify(loaded.settings);
          next[path] = { path, content, saved: item ? content : "" };
        }
        updated.push({
          ...group,
          path,
          outlinePath: undefined,
          activeHeading: -1,
          heading: undefined,
          reveal: undefined,
          revision: group.revision + 1,
        });
      }
      await desktop().recovery(file, null);
      buffersRef.current = next;
      groupsRef.current = updated;
      setBuffers(next);
      setGroups(updated);
      setProject(loaded);
      setSettings(loaded.settings);
      setSettingsDirty(false);
      setDirectoryDirty(false);
      setLastSaved("");
      setDiskChange((previous) =>
        !previous ||
        previous === diskChange ||
        previous.revision === loaded.revision
          ? undefined
          : previous,
      );
      notify(t("已加载磁盘中的最新版本。"));
    });
  }
  useEffect(() => {
    if (!diskChange || !project || !draftReady) return;
    if (diskChange.revision === project.revision) setDiskChange(undefined);
    else if (diskChange.revision && !dirty && !busy && !locked.current) {
      // Mark this revision attempted so a failed reload can be retried explicitly.
      const change = diskChange;
      if (lastAutoReload.current === change) return;
      lastAutoReload.current = change;
      void reloadDisk();
    }
  }, [diskChange, project?.revision, draftReady, dirty, busy]);

  async function saveDraftCopy() {
    const extension = standalone ? ".md" : ".mdk";
    const output = await desktop().dialog(
      standalone ? "save-markdown" : "save-project",
      basename(file).replace(/\.(mdk|md)$/i, "") + t("-草稿") + extension,
    );
    if (!output) return;
    await desktop().invoke("copyDraft", file, output, makeSnapshot());
    notify(t("已另存草稿副本。"));
  }
  async function compareDisk() {
    if (!buffer) return;
    const { content } = await desktop().invoke("readText", file, activePath);
    setComparison({
      path: activePath,
      local: buffer.content.slice(0, 200_000),
      disk: content.slice(0, 200_000),
      truncated: Math.max(buffer.content.length, content.length) > 200_000,
    });
  }

  async function flush(syncDirectory = true): Promise<boolean> {
    const project = projectRef.current;
    // The watcher is advisory. The atomic save verifies the current revision,
    // even if the original bytes were restored after a conflict notification.
    const submitted = Object.values(buffersRef.current).filter(
      (b) => b.content !== b.saved,
    );
    if (
      !project ||
      !file ||
      !(submitted.length || directoryDirty || settingsDirty)
    )
      return true;
    const snapshot = makeSnapshot(submitted);
    await desktop()
      .recovery(file, snapshot)
      .catch((error) => notify(t("恢复草稿保存失败：") + String(error), true));
    const loaded = await desktop().invoke("saveSnapshot", file, {
      ...snapshot,
      ...(!syncDirectory ? { positions: undefined } : {}),
    });
    for (const b of submitted)
      putBuffer({ ...buffersRef.current[b.path], saved: b.content });
    if (directoryDirty && syncDirectory) setDirectoryDirty(false);
    if (directoryDirty && !syncDirectory)
      loaded.contents.entries = project.contents.entries;
    if (settingsDirty) setSettingsDirty(false);
    setProject(loaded);
    setSettings(loaded.settings);
    setDiskChange((previous) =>
      previous === diskChange ? undefined : previous,
    );
    for (const control of [
      directoryDirty && syncDirectory ? "contents.toml" : "",
      settingsDirty ? "settings.toml" : "",
    ]) {
      const current = buffersRef.current[control];
      if (current && current.content === current.saved) {
        const content = (await desktop().invoke("readText", file, control))
          .content;
        const latest = buffersRef.current[control];
        if (latest)
          putBuffer(
            latest === current
              ? { path: control, content, saved: content }
              : { ...latest, saved: content },
          );
      }
    }
    if (syncDirectory) {
      const unsaved = textSnapshot(Object.values(buffersRef.current));
      await desktop().recovery(
        file,
        unsaved.text || unsaved.texts
          ? { revision: loaded.revision, ...unsaved }
          : null,
      );
    }
    setLastSaved(
      new Date().toLocaleTimeString(appLocale(), {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    return true;
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;
  function startSave() {
    if (pendingSave.current) return pendingSave.current;
    if (locked.current) return Promise.resolve(false);
    locked.current = true;
    setOperation("save");
    const saving = flushRef
      .current()
      .catch((error) => {
        notify(String(error).replace(/^Error: /, ""), true);
        return false;
      })
      .finally(() => {
        pendingSave.current = null;
        locked.current = false;
        setOperation(null);
      });
    pendingSave.current = saving;
    return saving;
  }
  async function saveDocument() {
    if (
      !projectRef.current ||
      manualSavePending.current ||
      (locked.current && !pendingSave.current)
    )
      return;
    manualSavePending.current = true;
    clearTimeout(saveFeedbackTimer.current);
    setManualSave("saving");
    const saved =
      (!pendingSave.current || (await pendingSave.current)) &&
      (await startSave());
    manualSavePending.current = false;
    setManualSave(saved ? "saved" : undefined);
    if (saved)
      saveFeedbackTimer.current = setTimeout(() => setManualSave(undefined), 2400);
  }
  async function renameArchive() {
    if (standalone || !projectRef.current) return;
    const name = await ask({
      title: t("重命名 MDK 工程"),
      description: t("修改当前文件夹内的工程文件名。"),
      initial: basename(file).replace(/\.mdk$/i, ""),
      input: true,
      confirm: t("重命名"),
    });
    if (!name || !(await flush())) return;
    const target = await desktop().renameArchive(
      name,
      projectRef.current!.revision,
      projectRef.current!.mode,
    );
    if (target !== file) {
      setDiskChange(undefined);
      onRename(target);
    }
  }
  const refreshRef = useRef(async () => {});
  refreshRef.current = async () => {
    const loaded = await desktop().invoke("open", file);
    setProject(loaded);
    setSettings(loaded.settings);
    setSettingsDirty(false);
    await refreshBuffers(loaded);
  };
  const saveState = useRef({
    hasTextChanges: false,
    criticalDirty: false,
    settingsDirty,
    directoryDirty,
    externalChange: false,
  });
  saveState.current = {
    hasTextChanges: dirtyBuffers.length > 0,
    criticalDirty: dirtyBuffers.some((b) =>
      ["contents.toml", "mimetype"].includes(b.path),
    ),
    settingsDirty,
    directoryDirty,
    externalChange: !!diskChange && diskChange.revision !== project?.revision,
  };
  useImperativeHandle(
    ref,
    () => ({
      refresh: () => refreshRef.current(),
      flush: async () => {
        while (pendingSave.current)
          if (!(await pendingSave.current)) return false;
        if (locked.current) throw new Error(t("正在处理工程，请稍后再试。"));
        locked.current = true;
        setOperation("work");
        try {
          return await flushRef.current();
        } finally {
          locked.current = false;
          setOperation(null);
        }
      },
    }),
    [],
  );
  useEffect(() => {
    if (!preferences.autosave) return;
    const timer = setInterval(() => {
      const state = saveState.current;
      if (
        !(
          state.hasTextChanges ||
          state.settingsDirty ||
          state.directoryDirty
        ) ||
        state.criticalDirty ||
        state.externalChange
      )
        return;
      void startSave();
    }, preferences.autosaveInterval * 1000);
    return () => clearInterval(timer);
  }, [file, preferences.autosave, preferences.autosaveInterval]);
  async function openFile(path: string, groupId = activeId) {
    if (!project) return;
    if (groupsRef.current.find((group) => group.id === groupId)?.path === path)
      return;
    if (path === "contents.toml" && directoryDirty) {
      if (
        !(await ask({
          title: t("更新目录后打开源码？"),
          description: t(
            "当前目录有待同步变更。先写入 contents.toml，再打开源码。",
          ),
          confirm: t("更新目录"),
        }))
      )
        return;
      if (!(await flush(true))) return;
    } else if (!(await flush(false))) return;
    let loaded = dirty ? await desktop().invoke("open", file) : project;
    if (directoryDirty && path !== "contents.toml")
      loaded = {
        ...loaded,
        contents: { ...loaded.contents, entries: project.contents.entries },
      };
    setProject(loaded);
    await loadFile(path, loaded, "preview", groupId);
  }
  async function changeTab(next: Tab, groupId = activeId) {
    if (standalone && next === "settings")
      throw new Error(t("单 Markdown 工程没有 settings.toml。"));
    if (!(await flush(false))) return;
    const target = groupsRef.current.find((g) => g.id === groupId)!;
    const targetBuffer = buffersRef.current[target.path];
    next = editorView(
      editorFileKind(project, target.path),
      next,
      targetBuffer?.content,
      standalone,
    );
    patchGroup(groupId, (g) => ({
      tab: next,
      outlinePath: undefined,
      revision: g.revision + 1,
    }));
  }
  function updateContent(path: string, content: string) {
    const current = buffersRef.current[path];
    if (current && current.content !== content)
      putBuffer({ ...current, content, pagination: undefined });
  }
  async function revert() {
    if (
      !buffer ||
      !contentDirty ||
      !(await ask({
        title: t("放弃当前文件的更改？"),
        description: buffer.path,
        confirm: t("放弃更改"),
        danger: true,
      }))
    )
      return;
    setBuffer({ ...buffer, content: buffer.saved, pagination: undefined });
    setRevision((value) => value + 1);
  }
  async function applyOutline(entries: MdkEntry[]) {
    if (!project) return;
    if (project.readonly)
      throw new Error(t("未知 mode 的内容只读，请显式切换到 00 后编辑。"));
    if (dirtyBuffers.some((b) => b.path === "contents.toml"))
      throw new Error(t("请先保存或撤销 contents.toml 的源码更改。"));
    if (settingsDirty) throw new Error(t("请先保存工程设置，再调整目录。"));
    if (
      project.files.filter(
        (item) =>
          item.path.startsWith("markdown/") && item.path.endsWith(".md"),
      ).length > preferences.directorySyncThreshold
    ) {
      setProject({ ...project, contents: { ...project.contents, entries } });
      setDirectoryDirty(true);
    } else {
      const loaded = await desktop().invoke(
        "reorderEntries",
        file,
        entries.map(({ id, position }) => ({ id, position })),
      );
      setProject(loaded);
      setDirectoryDirty(false);
      await refreshBuffers(loaded);
    }
  }
  async function addEntry(parent?: MdkEntry) {
    if (parent && parent.position.split(".").length >= 6)
      throw new Error(t("目录最多允许 6 层。"));
    if (!project || !(await flush())) return;
    let index = 1;
    while (
      project.files.some(
        (item) => item.path === `markdown/${String(index).padStart(3, "0")}.md`,
      )
    )
      index++;
    const filename = await ask({
      title: t("新建文稿"),
      input: true,
      initial: String(index).padStart(3, "0") + ".md",
      confirm: t("创建文稿"),
    });
    if (!filename) return;
    const before = new Set(project.contents.entries.map((entry) => entry.id));
    let loaded = await desktop().invoke(
      "addEntry",
      file,
      filename,
      parent?.id ?? activeEntry?.id,
    );
    const added = loaded.contents.entries.find(
      (entry) => !before.has(entry.id),
    )!;
    if (parent)
      loaded = await desktop().invoke(
        "reorderEntries",
        file,
        moveOutline(
          loaded.contents.entries,
          added.id,
          parent.position,
          "inside",
        ).map(({ id, position }) => ({ id, position })),
      );
    setProject(loaded);
    await refreshBuffers(loaded);
    await loadFile(added.path, loaded);
  }
  async function splitEntry() {
    if (!project || !activeEntry || !buffer) return;
    const parts = splitMarkdownByHeading(buffer.content);
    if (parts.length < 2)
      throw new Error(t("至少需要两个同级的最浅层标题才能拆分。"));
    if (
      !(await ask({
        title: t("按标题拆分当前文稿？"),
        description: t(
          "将按最浅层标题拆成 {0} 篇文稿，插入当前文稿之后。首篇保留原文件和 ID，子目录保持原位；正文、换行和相对资源路径保持原样。",
          parts.length,
        ),
        confirm: t("保存并拆分"),
      })) ||
      !(await flush())
    )
      return;
    const loaded = await desktop().invoke("splitEntry", file, activeEntry.id);
    setProject(loaded);
    await refreshBuffers(loaded);
    await loadFile(buffer.path, loaded);
    notify(t("已拆分为 {0} 篇文稿。", parts.length));
  }
  async function treeAction(
    action: TreeAction,
    path: string,
    entry?: MdkEntry,
  ) {
    if (!project) return;
    if (action === "open-side") {
      const target = splitEditor();
      await openFile(path, target);
      return;
    }
    if (standalone)
      throw new Error(t("单 Markdown 工程不支持文稿编排或工程文件管理。"));
    if (action === "extract-resources") return extractResources([path]);
    if (action === "extract-file") return extractResources([path], true);
    if (action === "import-files" || action === "import-folders")
      return importResource(path, action === "import-files" ? "files" : "folders");
    if (entry && ["up", "down", "indent", "outdent"].includes(action))
      return applyOutline(
        adjustOutline(
          project.contents.entries,
          entry.id,
          action as "up" | "down" | "indent" | "outdent",
        ),
      );
    if (action === "child") return addEntry(entry);
    if (!(await flush())) return;
    if (action === "index") {
      const loaded = await desktop().invoke("indexFile", file, path);
      setProject(loaded);
      await refreshBuffers(loaded);
      await loadFile(path, loaded, "preview");
      return;
    }
    if (action === "new-folder") {
      if (!isResourcePath(path)) throw new Error(t("此操作仅限 resources 目录。"));
      const target = await ask({
        title: t("新建文件夹"),
        description: path,
        input: true,
        initial: t("新建文件夹"),
        confirm: t("创建"),
      });
      if (!target) return;
      const loaded = await desktop().invoke(
        "createResourceFolder", file, path, target, projectRef.current!.revision,
      );
      setProject(loaded);
      return;
    }
    if (action === "rename") {
      const target = await ask({
        title: entry ? t("重命名文稿") : t("重命名文件或目录"),
        description: entry ? t(
          "将保留稳定 ID。造成已知断链时保留原路径并拒绝操作；未知扩展可能按路径关联内容，请先确认其依赖或保留原路径。",
        ) : t("将同步可识别的 Markdown、工程字体和封面引用。未知扩展或附件内部的引用需手动确认。"),
        input: true,
        initial: basename(path),
        confirm: t("重命名"),
      });
      if (!target) return;
      const loaded = entry
        ? await desktop().invoke("renameEntry", file, entry.id, target)
        : await desktop().invoke("renameResource", file, path, target, projectRef.current!.revision);
      setProject(loaded);
      setSettings(loaded.settings);
      await refreshBuffers(
        loaded,
        path,
        entry
          ? loaded.contents.entries.find((item) => item.id === entry.id)!.path
          : path.slice(0, path.lastIndexOf("/") + 1) + target,
      );
      setFileSelection(undefined);
      return;
    }
    if (action === "delete") {
      if (
        !(await ask({
          title: entry ? t("删除文稿？") : t("删除文件或目录？"),
          description:
            path +
            t(
              "。删除后无法撤销；子文稿将提升一级。被引用资源删除后会报告缺失，严格交付前须处理。",
            ),
          confirm: t("删除"),
          danger: true,
        }))
      )
        return;
      const loaded = entry
        ? await desktop().invoke("deleteEntry", file, entry.id)
        : await desktop().invoke("deleteResource", file, path, projectRef.current!.revision);
      setProject(loaded);
      setSettings(loaded.settings);
      await refreshBuffers(loaded);
      setFileSelection(undefined);
    }
  }
  async function importResource(folder: string, mode: "files" | "folders" = "files") {
    if (!(await flush())) return;
    const result = await desktop().invoke(
      "importResourcesTo", file, folder, mode, projectRef.current!.revision,
    );
    if (!result) return;
    setProject(result.project);
    notify(t("已导入 {0} 项资源至 {1}。", result.count, folder));
  }
  async function extractResources(paths: string[], projectFiles = false) {
    if (!project) return;
    const result = await desktop().invoke(
      projectFiles ? "extractProjectFiles" : "extractResources",
      file, paths, project.revision,
    );
    if (!result) return;
    notify(t("已提取 {0} 个文件至 {1}。", result.count, result.path));
  }
  async function setMode(mode?: string) {
    if (!project || !(await flush())) return;
    const next =
      mode ??
      (await ask({
        title: t("工程 mode"),
        description: t(
          "输入两位十六进制数。00 通用，01 书籍，02 漫画，其他值按兼容模式打开。",
        ),
        input: true,
        initial: project.mode,
        confirm: t("应用"),
      }));
    if (!next) return;
    const loaded = await desktop().invoke("setMode", file, next);
    setProject(loaded);
    await refreshBuffers(loaded);
  }
  function splitEditor(path?: string) {
    if (!project) return activeId;
    if (groupsRef.current.length === 2) {
      const other = groupsRef.current.find((g) => g.id !== activeId)!;
      setActiveId(other.id);
      groupEditors.current[other.id]?.focus();
      return other.id;
    }
    const source =
      groupsRef.current.find((g) => g.id === activeId) ?? groupsRef.current[0];
    const next = {
      ...newEditorGroup(path ?? source.path),
      tab: source.tab,
      zoom: source.zoom,
    };
    const updated = [source, next];
    groupsRef.current = updated;
    setGroups(updated);
    setActiveId(next.id);
    setGroupRatio(0.5);
    return next.id;
  }
  function closeGroup(id: string) {
    if (groupsRef.current.length < 2) return;
    const next = groupsRef.current.filter((g) => g.id !== id);
    groupsRef.current = next;
    setGroups(next);
    setActiveId(next[0].id);
  }
  const shortcutActions = useRef({ splitEditor, saveDocument });
  shortcutActions.current = { splitEditor, saveDocument };
  useEffect(() => {
    if (!shortcutsEnabled) return;
    const bindings = new Map(
      shortcuts.map((action) => [
        shortcutKey(action, preferences.shortcuts),
        action,
      ]),
    );
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        !projectRef.current ||
        event.defaultPrevented ||
        target?.closest('dialog, [role="dialog"], [role="listbox"]')
      )
        return;
      const key = shortcutFromEvent(event);
      if (!key) return;
      const action = bindings.get(key);
      const groupId = target
        ?.closest('.document-body[contenteditable="true"]')
        ?.closest<HTMLElement>("[data-editor-group]")?.dataset.editorGroup;
      if (!action) {
        if (groupId && visualNativeKeys.has(key)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const state = shortcutActions.current;
      if ("level" in action || "command" in action) {
        if (!groupId) return;
        if (!event.repeat) groupEditors.current[groupId]?.format(action);
      } else if (!event.repeat) {
        if (action.id === "save") void state.saveDocument();
        else if (!locked.current) {
          if (action.id === "split") state.splitEditor();
          else {
            const group = groupsRef.current[action.id === "left" ? 0 : 1];
            if (!group) return;
            setActiveId(group.id);
            groupEditors.current[group.id]?.focus();
          }
        }
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [shortcutsEnabled, preferences.shortcuts]);
  function startResize(event: React.MouseEvent) {
    const start = event.clientX,
      width = sidebarWidth;
    const move = (event: MouseEvent) =>
      setSidebarWidth(
        Math.min(480, Math.max(240, width + event.clientX - start)),
      );
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  }
  if (!file)
    return (
      <div className="workspace-empty">
        <h1>{t("未打开工程")}</h1>
        <button className="button primary" onClick={onOpen}>
          <FolderOpen size={17} />
          {t("打开工程")}
        </button>
      </div>
    );
  return (
    <div
      className={`editor-workspace ${project?.mode === "00" ? "mode-default" : ""} ${busy ? "is-busy" : ""}`}
    >
      <aside className="outline-panel" style={{ width: sidebarWidth }}>
        <div className="project-heading">
          <span className="project-caption">{t("当前工程")}</span>
          <strong title={file}>
            {basename(file).replace(/\.(mdk|md)$/i, "")}
          </strong>
          <div className="project-mode-controls">
            <Select
              aria-label={t("工程模式")}
              value={project?.mode ?? "00"}
              disabled={busy || standalone}
              onValueChange={(value) => void execute(() => setMode(value))}
            >
              <option value="00">
                {standalone ? t("单 Markdown 文件") : t("00 通用")}
              </option>
              <option value="01">{t("01 书籍")}</option>
              <option value="02">{t("02 漫画")}</option>
              {project && !["00", "01", "02"].includes(project.mode) && (
                <option value={project.mode}>
                  {project.mode} {t("兼容模式")}
                </option>
              )}
            </Select>
            <button
              className="icon-button"
              aria-label={t("自定义工程模式")}
              disabled={busy || standalone}
              onClick={() => void execute(() => setMode())}
            >
              <Settings2 size={14} />
            </button>
          </div>
        </div>
        <div
          className="explorer-tabs"
          role="tablist"
          aria-label={t("目录视图")}
        >
          <button
            role="tab"
            aria-selected={treeView === "outline"}
            className={treeView === "outline" ? "active" : ""}
            onClick={() => setTreeView("outline")}
          >
            <ListTree size={15} />
            {t("文稿目录")}
          </button>
          <button
            role="tab"
            aria-selected={treeView === "files"}
            className={treeView === "files" ? "active" : ""}
            onClick={() => setTreeView("files")}
          >
            <Files size={15} />
            {t("整体目录")}
          </button>
        </div>
        <label className="tree-search">
          <Search size={15} />
          <input
            aria-label={t("搜索工程目录")}
            placeholder={t("筛选目录…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div
          className="sidebar-sections"
          ref={sidebarSections}
          style={{
            gridTemplateRows:
              "minmax(0, " +
              sidebarRatio +
              "fr) 6px minmax(0, " +
              (1 - sidebarRatio) +
              "fr)",
          }}
        >
          <section
            className="directory-section"
            aria-label={t("文稿与工程目录")}
          >
            <div className="outline-heading">
              <strong>
                {treeView === "outline" ? t("文稿目录") : t("工程文件")}{" "}
                <small>
                  {treeView === "outline"
                    ? (project?.contents.entries.length ?? 0)
                    : (project?.files.length ?? 0)}
                </small>
              </strong>
              <div className="button-row">
                {treeView === "outline" ? <button
                  className="icon-button"
                  aria-label={t("新建文稿")}
                  disabled={busy || !project || standalone || project.readonly}
                  onClick={() => void execute(() => addEntry())}
                >
                  <FilePlus2 size={16} />
                </button> : (
                  <>
                  <button
                    className="icon-button"
                    aria-label={t("在 resources 新建文件夹")}
                    title={t("在 resources 新建文件夹")}
                    disabled={busy || !project || standalone || project.readonly}
                    onClick={() =>
                      void execute(() => treeAction("new-folder", "resources"))
                    }
                  >
                    <FolderPlus size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t("多选")}
                    title={t("多选")}
                    aria-pressed={!!fileSelection}
                    disabled={busy || !project || standalone}
                    onClick={() => setFileSelection(
                      fileSelection ? undefined : new Set(),
                    )}
                  >
                    <ListChecks size={16} />
                  </button>
                  </>
                )}
              </div>
            </div>
            <ProjectTree
              view={treeView}
              entries={project?.contents.entries ?? []}
              files={project?.files ?? []}
              selected={activePath}
              query={query}
              busy={busy}
              readOnly={standalone || project?.readonly}
              showResources={!!project && !standalone}
              fileSelection={fileSelection}
              onFileSelection={setFileSelection}
              onExtractSelection={(paths) => void execute(() => extractResources(paths, true))}
              onOpen={(path) => void execute(() => openFile(path))}
              onMove={(id, parent, index) =>
                void execute(() =>
                  applyOutline(
                    moveOutlineToIndex(
                      project!.contents.entries,
                      id,
                      parent,
                      index,
                    ),
                  ),
                )
              }
              onAction={(action, path, entry) =>
                void execute(() => treeAction(action, path, entry))
              }
            />
          </section>
          <SplitHandle
            axis="horizontal"
            label={t("调整文稿目录与标题大纲高度")}
            value={sidebarRatio}
            onChange={setSidebarRatio}
            container={sidebarSections}
          />
          <HeadingOutline
            headings={headings}
            active={activeHeading}
            enabled={isMarkdown}
            follow={followOutline}
            emptyMessage={
              outlineSource.length > previewTextLimit
                ? t("文稿较大，实时大纲已暂停。")
                : undefined
            }
            onSelect={(heading) => {
              void jumpHeading(heading).catch((error) =>
                notify(String(error), true),
              );
            }}
          />
        </div>
        {directoryDirty && (
          <button
            className="pending-directory"
            onClick={() => void execute(() => flush())}
          >
            {t("目录有待同步变更 · 更新目录")}
          </button>
        )}
        <div className="control-shortcuts">
          <button
            disabled={standalone}
            onClick={() => {
              setTreeView("files");
              void execute(() => openFile("contents.toml"));
            }}
          >
            contents.toml
          </button>
          <button
            disabled={standalone}
            onClick={() => {
              setTreeView("files");
              void execute(() => openFile("settings.toml"));
            }}
          >
            settings.toml
          </button>
        </div>
        <div className="import-resource">
          <Select
            aria-label={t("资源类型")}
            disabled={standalone || project?.readonly}
            value={resourceKind}
            onValueChange={(value) => setResourceKind(value as ResourceKind)}
          >
            {Object.entries({
              image: t("图片"),
              video: t("视频"),
              audio: t("音频"),
              font: t("字体"),
              other: t("其他"),
            }).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </Select>
          <button
            className="button small"
            disabled={busy || !project || standalone || project.readonly}
            onClick={() => void execute(() => importResource("resources/" + resourceKind))}
          >
            <ImagePlus size={14} />
            {t("导入资源")}
          </button>
        </div>
      </aside>
      <div className="outline-resizer" onMouseDown={startResize}>
        <GripVertical size={10} />
      </div>
      <div className="writing-area">
        <div className="document-topbar">
          <div className="document-title">
            <FileCode2 size={17} />
            <strong>{activePath || t("未选择文件")}</strong>
            <span>
              {dirty
                ? t("未保存")
                : lastSaved
                  ? t("已保存 {0}", lastSaved)
                  : t("已就绪")}
            </span>
          </div>
          <div className="button-row">
            <button
              className="icon-button"
              aria-label={t("打开文件所在位置")}
              title={
                standalone ? t("打开文件所在位置") : t("打开工程文件所在位置")
              }
              disabled={!project}
              onClick={() =>
                void desktop()
                  .revealFile(activePath)
                  .catch((error) => notify(String(error), true))
              }
            >
              <FolderSearch size={17} />
            </button>
            {project && !standalone && (
              <>
                <button
                  className="icon-button"
                  aria-label={t("重命名 MDK 工程")}
                  title={t("重命名 MDK 工程")}
                  disabled={busy}
                  onClick={() => void execute(renameArchive)}
                >
                  <PencilLine size={17} />
                </button>
                <button className="button small" onClick={() => setCliInfo(true)}>
                  {t("CLI 信息")}
                </button>
              </>
            )}
            <button
              className="icon-button"
              aria-label={t("向右拆分编辑器")}
              title={[t("向右拆分编辑器"), splitKey]
                .filter(Boolean)
                .join(" · ")}
              disabled={busy || !project}
              onClick={() => splitEditor()}
            >
              <Columns2 size={17} />
            </button>
            <button
              className="button small"
              aria-label={t("保存")}
              disabled={busy || !project}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void saveDocument()}
            >
              {manualSave === "saving" ? (
                <LoaderCircle size={15} className="save-spinner" />
              ) : manualSave === "saved" ? (
                <Check size={15} />
              ) : (
                <Save size={15} />
              )}
              <span role="status" className="save-label">
                {manualSave === "saving"
                  ? t("正在保存…")
                  : manualSave === "saved"
                    ? t("已保存")
                    : t("保存")}
              </span>
              {saveKey && <kbd>{saveKey}</kbd>}
            </button>
            <button className="button primary small" onClick={onDeliver}>
              <Send size={14} />
              {standalone ? t("导出") : t("交付")}
            </button>
          </div>
        </div>
        {diskChange && (
          <div className="disk-change-bar" role="status">
            <strong>
              {diskChange.revision
                ? t("磁盘文件已变化")
                : t("磁盘文件暂不可读取")}
            </strong>
            {dirty && (
              <span>
                {t("本地修改已保留。另存副本将把本地草稿应用到磁盘版本。")}
              </span>
            )}
            <button
              className="button small"
              disabled={busy}
              onClick={() => void reloadDisk(true)}
            >
              {t("重新加载")}
            </button>
            {dirty && (
              <button
                className="button small"
                disabled={busy}
                onClick={() => void execute(saveDraftCopy)}
              >
                {t("另存草稿副本")}
              </button>
            )}
            {buffer && diskChange.revision && (
              <button
                className="button small"
                disabled={busy}
                onClick={() => void execute(compareDisk)}
              >
                {t("对比当前文稿")}
              </button>
            )}
          </div>
        )}
        <div
          className={
            "editor-groups " + (groups.length === 2 ? "two-editor-groups" : "")
          }
          ref={groupContainer}
          style={
            groups.length === 2
              ? {
                  gridTemplateColumns:
                    "minmax(0, " +
                    groupRatio +
                    "fr) 6px minmax(0, " +
                    (1 - groupRatio) +
                    "fr)",
                }
              : undefined
          }
        >
          {groups.map((group, index) => (
            <div
              className="editor-group-slot"
              key={group.id}
              style={{ gridColumn: index === 0 ? 1 : 3 }}
            >
              <EditorGroup
                ref={(editor) => {
                  groupEditors.current[group.id] = editor;
                }}
                group={group}
                buffer={buffers[group.path] ?? null}
                project={project}
                file={file}
                initialFragment={index === 0 ? initialFragment : undefined}
                settings={settings}
                projectFont={projectFont}
                modelPool={modelPool}
                onScroll={(ratio) => syncScroll(group.id, ratio)}
                getScrollProgress={() =>
                  groupsRef.current.length === 2
                    ? scrollProgress.current
                    : (fileProgress.current.get(group.path) ?? 0)
                }
                active={activeGroup.id === group.id}
                followOutline={followOutline}
                theme={theme}
                pageLength={pageLength}
                showPageMarkers={preferences.showPageMarkers !== false}
                headings={outlinePath === group.path ? headings : undefined}
                split={groups.length === 2}
                label={index === 0 ? t("左栏") : t("右栏")}
                busy={busy}
                editingBlocked={operation === "work"}
                shortcutOverrides={preferences.shortcuts}
                directoryDirty={directoryDirty}
                notify={notify}
                execute={execute}
                flush={() => flushRef.current()}
                saveDocument={saveDocument}
                openFile={(path) => openFile(path, group.id)}
                changeTab={(tab) => changeTab(tab, group.id)}
                updateContent={(content) => updateContent(group.path, content)}
                setPagination={(content, pagination) => {
                  const current = buffersRef.current[group.path];
                  if (
                    current?.content === content &&
                    current.pagination?.length !== pagination.length
                  )
                    putBuffer({ ...current, pagination });
                }}
                updatePages={(changes) => {
                  const current = buffersRef.current[group.path];
                  if (
                    !current?.pagination ||
                    changes.some(({ index }) =>
                      !current.pagination?.pages[index] ||
                      current.pagination.pages[index].readOnly)
                  )
                    return [];
                  const next = replacePages(
                    current.content,
                    current.pagination,
                    changes,
                  );
                  if (next.content !== current.content)
                    putBuffer({
                      ...current,
                      content: next.content,
                      pagination: next.pagination,
                    });
                  return next.applied;
                }}
                importResources={() => insertFromPicker(group.id)}
                pasteImage={(image) => pasteImage(group.id, image)}
                revert={revert}
                splitEntry={splitEntry}
                setSettings={setSettings}
                setSettingsDirty={setSettingsDirty}
                patch={(patch) => patchGroup(group.id, patch)}
                onActivate={() => {
                  if (activeGroup.id !== group.id) setActiveId(group.id);
                }}
                onClose={() => closeGroup(group.id)}
              />
            </div>
          ))}
          {groups.length === 2 && (
            <SplitHandle
              axis="vertical"
              label={t("调整左右编辑组宽度")}
              value={groupRatio}
              onChange={setGroupRatio}
              container={groupContainer}
            />
          )}
        </div>
        <footer className="editor-statusbar">
          <div>
            <span className={`status-dot ${dirty ? "unsaved" : ""}`} />
            {dirty ? t("有未保存的更改") : t("所有更改已保存")}
            {busy ? t(" · 正在处理") : ""}
          </div>
          <span>
            {tab === "source"
              ? t("行 {0}，列 {1}", cursor.line, cursor.column)
              : ""}
            {settings.preview.show_word_count && isMarkdown
              ? t(
                  " · {0}{1} 字符",
                  markdown.length > previewTextLimit ? t("约 ") : "",
                  characterCount.toLocaleString(appLocale()),
                )
              : ""}
          </span>
          <div className="zoom-control">
            <button
              aria-label={t("缩小")}
              onClick={() => setZoom(Math.max(60, zoom - 10))}
            >
              <Minus size={13} />
            </button>
            <button onClick={() => setZoom(100)}>{zoom}%</button>
            <button
              aria-label={t("放大")}
              onClick={() => setZoom(Math.min(160, zoom + 10))}
            >
              <Plus size={13} />
            </button>
          </div>
        </footer>
      </div>
      {comparison && (
        <EditorDialog
          title={t("对比磁盘与本地 · ") + comparison.path}
          onClose={() => setComparison(undefined)}
        >
          <div className="disk-compare">
            <strong>{t("磁盘版本")}</strong>
            <strong>{t("本地缓冲区")}</strong>
            {comparison.truncated && <p>{t("长文稿仅对比前 20 万字符。")}</p>}
            <Suspense fallback={<p role="status">{t("正在加载差异…")}</p>}>
              <ConflictDiff
                theme={theme}
                path={comparison.path}
                disk={comparison.disk}
                local={comparison.local}
              />
            </Suspense>
          </div>
        </EditorDialog>
      )}
      {cliInfo && project && (
        <EditorDialog
          title={t("CLI 工程信息")}
          onClose={() => setCliInfo(false)}
        >
          <div className="cli-project-info">
            <label>
              {t("工程路径")} <input readOnly value={file} />
            </label>
            <label>
              {t("文稿 ID")} <input readOnly value={activeEntry?.id ?? ""} />
            </label>
            <label>
              {t("修订号")} <input readOnly value={project.revision} />
            </label>
            <button
              className="button"
              disabled={!activeEntry}
              onClick={() => {
                if (!activeEntry) return;
                const quote = (value: string) =>
                  "'" + value.replaceAll("'", "''") + "'";
                void desktop()
                  .edit(
                    "copy-text",
                    `mardikor read ${quote(file)} ${quote(activeEntry.id)}`,
                  )
                  .then(
                    () => notify(t("已复制 PowerShell 读取命令。")),
                    (error) => notify(String(error), true),
                  );
              }}
            >
              {t("复制读取命令（PowerShell）")}
            </button>
            <button
              className="button"
              onClick={() => {
                void desktop()
                  .edit(
                    "copy-text",
                    JSON.stringify(
                      {
                        path: file,
                        id: activeEntry?.id,
                        revision: project.revision,
                      },
                      null,
                      2,
                    ),
                  )
                  .then(
                    () => notify(t("已复制 CLI 工程信息。")),
                    (error) => notify(String(error), true),
                  );
              }}
            >
              {t("复制 JSON")}
            </button>
          </div>
        </EditorDialog>
      )}
    </div>
  );
});
