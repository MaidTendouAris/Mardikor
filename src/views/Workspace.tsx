import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  FileCode2,
  FilePlus2,
  FolderPlus,
  FolderOpen,
  GripVertical,
  ImagePlus,
  Minus,
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
import type { SourceModelPool } from "../components/SourceEditor";
import type { NativeDocumentDrop } from "../../shared/resources";
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
  markdownHeadings,
  type MarkdownHeading,
} from "../../shared/markdown";
import { defaultSettings } from "../../shared/defaults";
import { isManuscript } from "../../shared/workspace";
import {
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
import type { Preferences } from "../../shared/desktop";
import type { Ask, Notify } from "../App";

export interface WorkspaceHandle {
  flush: () => Promise<boolean>;
  refresh: () => Promise<void>;
}
const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;
const sourceOnly = requiresSourceMode;

export const Workspace = forwardRef<
  WorkspaceHandle,
  {
    file: string;
    initialView?: Tab;
    initialFragment?: string;
    preferences: Preferences;
    ask: Ask;
    notify: Notify;
    onDirty: (dirty: boolean) => void;
    onOpen: () => void;
    onDeliver: () => void;
  }
>(function Workspace(
  {
    file,
    initialView = "source",
    initialFragment,
    preferences,
    ask,
    notify,
    onDirty,
    onOpen,
    onDeliver,
  },
  ref,
) {
  const [draftReady, setDraftReady] = useState(false);
  const [project, setProject] = useState<MdkProject | null>(null);
  const standalone = project?.format === "markdown";
  const [treeView, setTreeView] = useState<"outline" | "files">("outline");
  const [settings, setSettings] = useState<MdkSettings>(defaultSettings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [directoryDirty, setDirectoryDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [resourceKind, setResourceKind] = useState<ResourceKind>("image");
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [lastSaved, setLastSaved] = useState("");
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
  const headings = useMemo(() => markdownHeadings(markdown), [markdown]);
  const characterCount = useMemo(() => {
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

  useEffect(() => {
    if (!draftReady || !project) return;
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
        .catch((error) => notify("恢复草稿保存失败：" + String(error), true));
    }, 500);
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
    notify,
  ]);
  async function execute(work: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      notify(String(error).replace(/^Error: /, ""), true);
    } finally {
      locked.current = false;
      setBusy(false);
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
        heading: { path: activePath, index: heading.index, key: Date.now() },
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
      !isManuscript(project, current.path) ||
      (target.tab === "write" && sourceOnly(current.content))
    ) {
      notify("当前文稿不可插入资源，请在可编辑的 Markdown 正文中重试。", true);
      return;
    }
    if (locked.current) {
      notify("正在处理工程，请稍后重新拖入。", true);
      return;
    }
    const marker = "MDKDROP" + crypto.randomUUID().replaceAll("-", "");
    const editor = groupEditors.current[target.id];
    const draft = editor?.dropDraft(drop.x, drop.y, marker);
    if (!draft || !editor) throw new Error("编辑器尚未就绪。");
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
      notify("已插入 " + result.resources.length + " 个资源。");
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
      throw new Error("剪贴板图片超过 16 MiB。");
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
    let current: Buffer | undefined = buffersRef.current[path];
    if (item?.is_text || (path === "settings.toml" && !item)) {
      if (!current || current.content === current.saved) {
        const content = item
          ? (await desktop().invoke("readText", file, path)).content
          : stringify(loaded.settings);
        current = { path, content, saved: item ? content : "" };
        putBuffer(current);
      }
    } else if (current) {
      const next = { ...buffersRef.current };
      delete next[path];
      buffersRef.current = next;
      setBuffers(next);
      current = undefined;
    }
    patchGroup(groupId, (g) => ({
      path,
      tab: current
        ? view === "write" &&
          (!isManuscript(loaded, path) || sourceOnly(current.content))
          ? "source"
          : view
        : "source",
      activeHeading: -1,
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
  useEffect(() => {
    if (!file) return;
    let live = true;
    setBusy(true);
    void desktop()
      .invoke("open", file)
      .then(async (loaded) => {
        if (!live) return;
        setProject(loaded);
        setSettings(loaded.settings);
        const first = [...loaded.contents.entries].sort((a, b) =>
          comparePosition(a.position, b.position),
        )[0];
        await loadFile(first?.path ?? "contents.toml", loaded, initialView);
        const draft = await desktop().recovery(file);
        if (
          draft &&
          (await ask({
            title: "恢复未提交的草稿？",
            description:
              draft.revision === loaded.revision
                ? "检测到上次未提交的正文、控制文件或目录更改。"
                : "检测到草稿，但磁盘工程已有其他修改。恢复后将保留冲突保护，不能直接覆盖磁盘。",
            confirm: "恢复草稿",
          }))
        ) {
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
        } else if (draft) await desktop().recovery(file, null);
        setDraftReady(true);
      })
      .catch((error) => notify(String(error), true))
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [file]);

  async function flush(syncDirectory = true): Promise<boolean> {
    if (!project || !file || !dirty) return true;
    const submitted = Object.values(buffersRef.current).filter(
      (b) => b.content !== b.saved,
    );
    const snapshot = {
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
    await desktop().recovery(file, snapshot);
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
    for (const control of [
      directoryDirty && syncDirectory ? "contents.toml" : "",
      settingsDirty ? "settings.toml" : "",
    ]) {
      const current = buffersRef.current[control];
      if (current && current.content === current.saved) {
        const content = (await desktop().invoke("readText", file, control))
          .content;
        putBuffer({ path: control, content, saved: content });
      }
    }
    if (syncDirectory) await desktop().recovery(file, null);
    setLastSaved(
      new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    return true;
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;
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
  });
  saveState.current = {
    hasTextChanges: dirtyBuffers.length > 0,
    criticalDirty: dirtyBuffers.some((b) =>
      ["contents.toml", "mimetype"].includes(b.path),
    ),
    settingsDirty,
    directoryDirty,
  };
  useImperativeHandle(
    ref,
    () => ({
      refresh: () => refreshRef.current(),
      flush: async () => {
        if (locked.current) throw new Error("正在处理工程，请稍后再试。");
        locked.current = true;
        setBusy(true);
        try {
          return await flushRef.current();
        } finally {
          locked.current = false;
          setBusy(false);
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
        state.criticalDirty
      )
        return;
      void execute(() => flushRef.current(true));
    }, preferences.autosaveInterval * 1000);
    return () => clearInterval(timer);
  }, [file, preferences.autosave, preferences.autosaveInterval]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        void execute(async () => {
          if (await flushRef.current()) notify("工程已保存。");
        });
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [notify]);
  async function openFile(path: string, groupId = activeId) {
    if (!project) return;
    const previousTab = groupsRef.current.find(
      (group) => group.id === groupId,
    )?.tab;
    if (path === "contents.toml" && directoryDirty) {
      if (
        !(await ask({
          title: "更新目录后打开源码？",
          description:
            "当前目录有待同步变更。先写入 contents.toml，再打开源码。",
          confirm: "更新目录",
        }))
      )
        return;
      if (!(await flush(true))) return;
    } else if (!(await flush(false))) return;
    let loaded = await desktop().invoke("open", file);
    if (directoryDirty && path !== "contents.toml")
      loaded = {
        ...loaded,
        contents: { ...loaded.contents, entries: project.contents.entries },
      };
    setProject(loaded);
    const view =
      isManuscript(loaded, path) &&
      (previousTab === "write" || previousTab === "preview")
        ? previousTab
        : "source";
    await loadFile(path, loaded, view, groupId);
  }
  async function changeTab(next: Tab, groupId = activeId) {
    if (standalone && next === "settings")
      throw new Error("单 Markdown 工程没有 settings.toml。");
    if (!(await flush(false))) return;
    const target = groupsRef.current.find((g) => g.id === groupId)!;
    if (next === "write" && !isManuscript(project, target.path))
      throw new Error("请选择 Markdown 文稿。");
    patchGroup(groupId, (g) => ({ tab: next, revision: g.revision + 1 }));
  }
  function updateContent(path: string, content: string) {
    const current = buffersRef.current[path];
    if (current && current.content !== content)
      putBuffer({ ...current, content });
  }
  async function revert() {
    if (
      !buffer ||
      !contentDirty ||
      !(await ask({
        title: "放弃当前文件的更改？",
        description: buffer.path,
        confirm: "放弃更改",
        danger: true,
      }))
    )
      return;
    setBuffer({ ...buffer, content: buffer.saved });
    setRevision((value) => value + 1);
  }
  async function applyOutline(entries: MdkEntry[]) {
    if (!project) return;
    if (project.readonly)
      throw new Error("未知 mode 的内容只读，请显式切换到 00 后编辑。");
    if (dirtyBuffers.some((b) => b.path === "contents.toml"))
      throw new Error("请先保存或撤销 contents.toml 的源码更改。");
    if (settingsDirty) throw new Error("请先保存工程设置，再调整目录。");
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
      throw new Error("目录最多允许 6 层。");
    if (!project || !(await flush())) return;
    let index = 1;
    while (
      project.files.some(
        (item) => item.path === `markdown/${String(index).padStart(3, "0")}.md`,
      )
    )
      index++;
    const filename = await ask({
      title: "新建文稿",
      input: true,
      initial: String(index).padStart(3, "0") + ".md",
      confirm: "创建文稿",
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
      throw new Error("至少需要两个同级的最浅层标题才能拆分。");
    if (
      !(await ask({
        title: "按标题拆分当前文稿？",
        description: `将按最浅层标题拆成 ${parts.length} 篇文稿，插入当前文稿之后。首篇保留原文件和 ID，子目录保持原位；正文、换行和相对资源路径保持原样。`,
        confirm: "保存并拆分",
      })) ||
      !(await flush())
    )
      return;
    const loaded = await desktop().invoke("splitEntry", file, activeEntry.id);
    setProject(loaded);
    await refreshBuffers(loaded);
    await loadFile(buffer.path, loaded);
    notify(`已拆分为 ${parts.length} 篇文稿。`);
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
      throw new Error("单 Markdown 工程不支持文稿编排或工程文件管理。");
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
      await loadFile(path, loaded);
      return;
    }
    if (action === "new-file" || action === "new-folder") {
      const directory =
        project.files.find((item) => item.path === path)?.kind ===
          "directory" ||
        project.files.some((item) => item.path.startsWith(path + "/"));
      const prefix = path
        ? directory
          ? path + "/"
          : path.split("/").slice(0, -1).join("/") + "/"
        : "";
      const target = await ask({
        title: action === "new-file" ? "新建文本文件" : "新建文件夹",
        input: true,
        initial:
          prefix.replace(/^\//, "") +
          (action === "new-file" ? "untitled.txt" : "新建文件夹"),
        confirm: "创建",
      });
      if (!target) return;
      const content = target.endsWith(".json")
        ? "{}\n"
        : target.endsWith(".toml")
          ? "schema_version = 1\n"
          : target.endsWith(".md")
            ? `# ${basename(target).slice(0, -3)}\n\n`
            : "";
      const loaded =
        action === "new-file"
          ? await desktop().invoke("createText", file, target, content)
          : await desktop().invoke("createDirectory", file, target);
      setProject(loaded);
      setSettings(loaded.settings);
      await refreshBuffers(loaded);
      if (action === "new-file") await loadFile(target, loaded);
      return;
    }
    if (action === "rename") {
      const target = await ask({
        title: entry ? "重命名文稿" : "重命名文件或目录",
        description:
          "将保留稳定 ID。造成已知断链时保留原路径并拒绝操作；未知扩展可能按路径关联内容，请先确认其依赖或保留原路径。",
        input: true,
        initial: entry ? basename(path) : path,
        confirm: "重命名",
      });
      if (!target) return;
      const loaded = entry
        ? await desktop().invoke("renameEntry", file, entry.id, target)
        : await desktop().invoke("renameFile", file, path, target);
      setProject(loaded);
      setSettings(loaded.settings);
      await refreshBuffers(
        loaded,
        path,
        entry
          ? loaded.contents.entries.find((item) => item.id === entry.id)!.path
          : target,
      );
      return;
    }
    if (action === "delete") {
      if (
        !(await ask({
          title: entry ? "删除文稿？" : "删除文件或目录？",
          description:
            path +
            "。删除后无法撤销；子文稿将提升一级。被引用资源删除后会报告缺失，严格交付前须处理。",
          confirm: "删除",
          danger: true,
        }))
      )
        return;
      const loaded = entry
        ? await desktop().invoke("deleteEntry", file, entry.id)
        : await desktop().invoke("deleteFile", file, path);
      setProject(loaded);
      setSettings(loaded.settings);
      await refreshBuffers(loaded);
    }
  }
  async function importResource() {
    if (!(await flush())) return;
    const selected = await desktop().dialog("resource");
    if (!selected) return;
    const resource = await desktop().invoke(
      "importResource",
      file,
      selected,
      resourceKind,
    );
    setProject(await desktop().invoke("open", file));
    notify(`已导入 ${basename(resource.path)}`);
  }
  async function setMode(mode?: string) {
    if (!project || !(await flush())) return;
    const next =
      mode ??
      (await ask({
        title: "工程 mode",
        description:
          "输入两位十六进制数。00 通用，01 书籍，02 漫画，其他值按兼容模式打开。",
        input: true,
        initial: project.mode,
        confirm: "应用",
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
  const layoutActions = useRef({ splitEditor, groups, activeId });
  layoutActions.current = { splitEditor, groups, activeId };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const state = layoutActions.current;
      if (locked.current) return;
      if (event.key === "\\") {
        event.preventDefault();
        state.splitEditor();
      } else if (["1", "2"].includes(event.key)) {
        const target = state.groups[Number(event.key) - 1];
        if (target) {
          event.preventDefault();
          setActiveId(target.id);
          groupEditors.current[target.id]?.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
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
        <h1>未打开工程</h1>
        <button className="button primary" onClick={onOpen}>
          <FolderOpen size={17} />
          打开工程
        </button>
      </div>
    );
  return (
    <div
      className={`editor-workspace ${project?.mode === "00" ? "mode-default" : ""} ${busy ? "is-busy" : ""}`}
    >
      <aside className="outline-panel" style={{ width: sidebarWidth }}>
        <div className="project-heading">
          <span className="project-caption">当前工程</span>
          <strong title={file}>
            {basename(file).replace(/\.(mdk|md)$/i, "")}
          </strong>
          <div className="project-mode-controls">
            <Select
              aria-label="工程模式"
              value={project?.mode ?? "00"}
              disabled={busy || standalone}
              onValueChange={(value) => void execute(() => setMode(value))}
            >
              <option value="00">
                {standalone ? "单 Markdown 文件" : "00 通用"}
              </option>
              <option value="01">01 书籍</option>
              <option value="02">02 漫画</option>
              {project && !["00", "01", "02"].includes(project.mode) && (
                <option value={project.mode}>{project.mode} 兼容模式</option>
              )}
            </Select>
            <button
              className="icon-button"
              aria-label="自定义工程模式"
              disabled={busy || standalone}
              onClick={() => void execute(() => setMode())}
            >
              <Settings2 size={14} />
            </button>
          </div>
        </div>
        <div className="explorer-tabs" role="tablist" aria-label="目录视图">
          <button
            role="tab"
            aria-selected={treeView === "outline"}
            className={treeView === "outline" ? "active" : ""}
            onClick={() => setTreeView("outline")}
          >
            <ListTree size={15} />
            文稿目录
          </button>
          <button
            role="tab"
            aria-selected={treeView === "files"}
            className={treeView === "files" ? "active" : ""}
            onClick={() => setTreeView("files")}
          >
            <Files size={15} />
            整体目录
          </button>
        </div>
        <label className="tree-search">
          <Search size={15} />
          <input
            aria-label="搜索工程目录"
            placeholder="筛选目录…"
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
          <section className="directory-section" aria-label="文稿与工程目录">
            <div className="outline-heading">
              <strong>
                {treeView === "outline" ? "文稿目录" : "工程文件"}{" "}
                <small>
                  {treeView === "outline"
                    ? (project?.contents.entries.length ?? 0)
                    : (project?.files.length ?? 0)}
                </small>
              </strong>
              <div className="button-row">
                <button
                  className="icon-button"
                  aria-label={
                    treeView === "outline" ? "新建文稿" : "新建文本文件"
                  }
                  disabled={busy || !project || standalone}
                  onClick={() =>
                    void execute(() =>
                      treeView === "outline"
                        ? addEntry()
                        : treeAction("new-file", ""),
                    )
                  }
                >
                  <FilePlus2 size={16} />
                </button>
                {treeView === "files" && (
                  <button
                    className="icon-button"
                    aria-label="新建文件夹"
                    disabled={busy || standalone}
                    onClick={() =>
                      void execute(() => treeAction("new-folder", ""))
                    }
                  >
                    <FolderPlus size={16} />
                  </button>
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
              readOnly={standalone}
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
            {treeView === "outline" && !standalone && (
              <p className="outline-help">
                拖到文稿中间设为子级，上下边缘调整顺序。
              </p>
            )}
          </section>
          <SplitHandle
            axis="horizontal"
            label="调整文稿目录与标题大纲高度"
            value={sidebarRatio}
            onChange={setSidebarRatio}
            container={sidebarSections}
          />
          <HeadingOutline
            headings={headings}
            active={activeHeading}
            enabled={isMarkdown}
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
            目录有待同步变更 · 更新目录
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
            aria-label="资源类型"
            disabled={standalone}
            value={resourceKind}
            onValueChange={(value) => setResourceKind(value as ResourceKind)}
          >
            {Object.entries({
              image: "图片",
              video: "视频",
              audio: "音频",
              font: "字体",
              other: "其他",
            }).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </Select>
          <button
            className="button small"
            disabled={busy || !project || standalone}
            onClick={() => void execute(importResource)}
          >
            <ImagePlus size={14} />
            导入资源
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
            <strong>{activePath || "未选择文件"}</strong>
            <span>
              {dirty ? "未保存" : lastSaved ? `已保存 ${lastSaved}` : "已就绪"}
            </span>
          </div>
          <div className="button-row">
            <button
              className="icon-button"
              aria-label="向右拆分编辑器"
              title="向右拆分编辑器 (Ctrl+\\)"
              disabled={busy || !project}
              onClick={() => splitEditor()}
            >
              <Columns2 size={17} />
            </button>
            <button
              className="button small"
              disabled={busy || !project}
              onClick={() =>
                void execute(async () => {
                  if (await flush()) notify("工程已保存。");
                })
              }
            >
              <Save size={15} />
              保存<kbd>Ctrl S</kbd>
            </button>
            <button className="button primary small" onClick={onDeliver}>
              <Send size={14} />
              {standalone ? "导出" : "交付"}
            </button>
          </div>
        </div>
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
                split={groups.length === 2}
                label={index === 0 ? "左栏" : "右栏"}
                busy={busy}
                directoryDirty={directoryDirty}
                notify={notify}
                execute={execute}
                flush={() => flushRef.current()}
                openFile={(path) => openFile(path, group.id)}
                changeTab={(tab) => changeTab(tab, group.id)}
                updateContent={(content) => updateContent(group.path, content)}
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
              label="调整左右编辑组宽度"
              value={groupRatio}
              onChange={setGroupRatio}
              container={groupContainer}
            />
          )}
        </div>
        <footer className="editor-statusbar">
          <div>
            <span className={`status-dot ${dirty ? "unsaved" : ""}`} />
            {dirty ? "有未保存的更改" : "所有更改已保存"}
            {busy ? " · 正在处理" : ""}
          </div>
          <span>
            {tab === "source" ? `行 ${cursor.line}，列 ${cursor.column}` : ""}
            {settings.preview.show_word_count && isMarkdown
              ? ` · ${characterCount.toLocaleString()} 字符`
              : ""}
          </span>
          <div className="zoom-control">
            <button
              aria-label="缩小"
              onClick={() => setZoom(Math.max(60, zoom - 10))}
            >
              <Minus size={13} />
            </button>
            <button onClick={() => setZoom(100)}>{zoom}%</button>
            <button
              aria-label="放大"
              onClick={() => setZoom(Math.min(160, zoom + 10))}
            >
              <Plus size={13} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
});
