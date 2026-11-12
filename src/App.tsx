import { appLocale, t } from "../shared/i18n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  Maximize2,
  Minus,
  PanelLeft,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { desktop } from "./services/desktop";
import { Modal, type ModalRequest } from "./components/Modal";
import { DocumentIcon } from "./components/DocumentIcon";
import appIcon from "../assets/icon.svg";
import { Workspace, type WorkspaceHandle } from "./views/Workspace";
import { Delivery } from "./views/Delivery";
import { AppSettings } from "./views/AppSettings";
import { UpdateNotice, useAppUpdate } from "./components/AppUpdate";
import type { Preferences, RecentProject } from "../shared/desktop";
import type { MdkProject } from "../shared/mdk";
import { isMarkdownFile } from "../shared/workspace";
import {
  defaultReadingPreferences,
  type ReadingChange,
} from "../shared/reading";
import type { EditorTab } from "./services/editor-groups";

export type Ask = (
  options: Omit<ModalRequest, "resolve">,
) => Promise<string | null>;
export type Notify = (message: string, error?: boolean) => void;
type Page = "home" | "editor" | "delivery" | "settings";

const modes = [
  { value: "markdown", title: t("单 Markdown 工程") },
  {
    value: "00",
    title: t("通用工程"),
  },
  {
    value: "01",
    title: t("书籍工程"),
  },
  {
    value: "02",
    title: t("漫画工程"),
  },
];

export default function App() {
  const update = useAppUpdate();
  const [page, setPage] = useState<Page>("home");
  const [documentProject, setDocumentProject] = useState<{
    file: string;
    project: MdkProject;
  }>();
  const currentPath = documentProject?.file ?? "";
  const [generation, setGeneration] = useState(0);
  const [initialView, setInitialView] = useState<EditorTab>("preview");
  const [initialFragment, setInitialFragment] = useState<string>();
  const [mode, setMode] = useState("00");
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [preferences, setPreferences] = useState<Preferences>({
    autosave: true,
    autosaveInterval: 30,
    directorySyncThreshold: 200,
    externalOpenView: "preview",
  });
  const preferencesRef = useRef(preferences);
  const [reading, setReading] = useState(defaultReadingPreferences);
  const changeReading = useCallback(async (change: ReadingChange) => {
    const value = await desktop().readingPreferences(change);
    setReading(value);
    return value;
  }, []);
  const preferencesReady = useRef<Promise<void> | null>(null);
  const receivePreferences = useCallback((value: Preferences) => {
    preferencesRef.current = value;
    setPreferences(value);
  }, []);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const theme =
    preferences.appTheme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : (preferences.appTheme ?? "light");
  useEffect(() => {
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const updateScheme = () => setSystemDark(scheme.matches);
    scheme.addEventListener("change", updateScheme);
    return () => scheme.removeEventListener("change", updateScheme);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.appTheme = theme;
  }, [theme]);
  const [request, setRequest] = useState<ModalRequest | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const api = window.mardikor;
    if (!api) return;
    const unsubscribe = api.onWindowMaximized(setMaximized);
    void api
      .window("isMaximized")
      .then(setMaximized)
      .catch(() => {});
    return unsubscribe;
  }, []);
  const [compact, setCompact] = useState(false);
  const workspace = useRef<WorkspaceHandle>(null);
  const ask: Ask = useCallback(
    (options) => new Promise((resolve) => setRequest({ ...options, resolve })),
    [],
  );
  const notify: Notify = useCallback(
    (text, error = false) =>
      setToast({
        text: text
          .replace(
            /^(?:Error:\s*)?Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
            "",
          )
          .replace(/^Error:\s*/, ""),
        error,
      }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        notify(String(error).replace(/^Error: /, ""), true);
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );
  useEffect(() => {
    if (!window.mardikor) return;
    const unsubscribe = desktop().onPreferencesChanged(receivePreferences);
    const unsubscribeReading = desktop().onReadingPreferencesChanged(setReading);
    preferencesReady.current = Promise.all([
      desktop().recent(),
      desktop().preferences(),
      desktop().readingPreferences(),
    ])
      .then(([r, p, reader]) => {
        setRecent(r);
        receivePreferences(p);
        setReading(reader);
      })
      .catch((error) => notify(String(error), true));
    return () => {
      unsubscribe();
      unsubscribeReading();
    };
  }, [notify, receivePreferences]);
  useEffect(() => {
    window.mardikor?.setDirty(isDirty);
  }, [isDirty]);
  useEffect(() => {
    if (window.mardikor) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [isDirty]);
  async function activate(
    file: string,
    view: EditorTab = "preview",
    fragment?: string,
  ) {
    if (workspace.current && !(await workspace.current.flush())) return;
    const project = await desktop().invoke("open", file);
    setDocumentProject({ file, project });
    setInitialView(view);
    setInitialFragment(fragment);
    setGeneration((n) => n + 1);
    setPage("editor");
    setIsDirty(false);
    setRecent(await desktop().recent());
  }
  const activateRef = useRef(activate);
  activateRef.current = activate;
  useEffect(
    () =>
      window.mardikor?.onSaveBeforeClose(async () => {
        try {
          return (await workspace.current?.flush()) ?? true;
        } catch (error) {
          notify(String(error), true);
          return false;
        }
      }),
    [notify],
  );
  useEffect(
    () =>
      window.mardikor?.onSaveForUpdate(async () => {
        try {
          return (await workspace.current?.flush()) ?? true;
        } catch (error) {
          notify(String(error), true);
          return false;
        }
      }),
    [notify],
  );
  useEffect(
    () =>
      window.mardikor?.onOpenProject((file, fragment) => {
        void run(async () => {
          await preferencesReady.current;
          await activateRef.current(
            file,
            fragment
              ? "preview"
              : (preferencesRef.current.externalOpenView ?? "preview"),
            fragment,
          );
        });
      }),
    [run],
  );
  async function chooseProject() {
    const file = await desktop().dialog("open-project");
    if (file) await activate(file);
  }
  async function createProject() {
    if (workspace.current && !(await workspace.current.flush())) return;
    const single = mode === "markdown";
    const file = await desktop().dialog(
      single ? "save-markdown" : "save-project",
      single ? t("未命名.md") : t("未命名.mdk"),
    );
    if (!file) return;
    if (single && !isMarkdownFile(file))
      throw new Error(t("单 Markdown 工程请使用 .md 扩展名。"));
    await desktop().invoke("create", file, single ? "00" : mode);
    await activate(file, "source");
    notify(t("工程已创建。"));
  }
  async function packDirectory() {
    if (workspace.current && !(await workspace.current.flush())) return;
    const directory = await desktop().dialog("directory");
    if (!directory) return;
    await desktop().invoke("checkPackDirectory", directory);
    const output = await desktop().dialog("save-project", t("工程.mdk"));
    if (!output) return;
    await desktop().invoke("pack", directory, output, mode);
    await activate(output);
    notify(t("目录已打包为 MDK 工程。"));
  }
  async function windowAction(action: "minimize" | "maximize" | "close") {
    setMaximized(await desktop().window(action));
  }
  return (
    <>
      <div
        className={`app-shell ${compact ? "compact-nav" : ""}`}
        inert={update?.phase === "preparing" && !request}
      >
        <header className="titlebar">
          <div className="titlebar-brand">
            <img
              className="brand-mark"
              src={appIcon}
              alt=""
              draggable={false}
            />
            <span>Mardikor</span>
          </div>
          {currentPath && (
            <div className="titlebar-caption">
              {currentPath.split(/[\\/]/).pop()}
              {isDirty ? " *" : ""}
            </div>
          )}
          <div className="window-controls">
            <button
              aria-label={t("最小化")}
              onClick={() => void run(() => windowAction("minimize"))}
            >
              <Minus size={15} />
            </button>
            <button
              aria-label={maximized ? t("还原") : t("最大化")}
              onClick={() => void run(() => windowAction("maximize"))}
            >
              <Maximize2 size={13} />
            </button>
            <button
              aria-label={t("关闭窗口")}
              className="window-close"
              onClick={() => void run(() => windowAction("close"))}
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <aside className="navigation">
          <button
            className="workspace-label"
            onClick={() => setCompact(!compact)}
            aria-label={t("收起或展开导航")}
            aria-expanded={!compact}
            aria-controls="primary-navigation"
            title={compact ? t("展开导航") : t("收起导航")}
          >
            <PanelLeft size={16} />
            <span>{t("导航")}</span>
          </button>
          <nav id="primary-navigation" aria-label={t("主导航")}>
            {(
              [
                { id: "home", icon: LayoutGrid, title: t("工程") },
                { id: "editor", icon: BookOpen, title: t("编辑器") },
                { id: "delivery", icon: ShieldCheck, title: t("校验与导出") },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                title={item.title}
                className={`nav-item ${page === item.id ? "active" : ""}`}
                onClick={() => setPage(item.id)}
              >
                <item.icon size={19} strokeWidth={1.7} />
                <span>{item.title}</span>
                {item.id === "editor" && isDirty && <i className="dirty-dot" />}
              </button>
            ))}
          </nav>
          <div className="nav-projects" inert={compact} aria-hidden={compact}>
            <span className="nav-caption">{t("最近使用")}</span>
            {recent.slice(0, 5).map((item) => (
              <button
                title={item.path}
                key={item.path}
                onClick={() => void run(() => activate(item.path))}
              >
                <span className="project-dot" />
                <span>{item.title}</span>
              </button>
            ))}
            {!recent.length && <p>{t("暂无记录")}</p>}
          </div>
          <div className="nav-bottom">
            <button
              className="nav-item"
              title={t("打开工程")}
              disabled={busy}
              onClick={() => void run(chooseProject)}
            >
              <FolderOpen size={19} />
              <span>{t("打开工程")}</span>
            </button>
            <button
              className={`nav-item ${page === "settings" ? "active" : ""}`}
              title={t("应用设置")}
              onClick={() => setPage("settings")}
            >
              <Settings2 size={19} strokeWidth={1.7} />
              <span>{t("应用设置")}</span>
            </button>
          </div>
        </aside>
        <main className="main-area">
          {!window.mardikor && (
            <div className="browser-notice">
              {t(
                "此页面为界面预览。请运行桌面应用以创建、打开和保存本地工程。",
              )}
            </div>
          )}
          {page === "home" && (
            <div className="home-page page-scroll">
              <div className="home-heading">
                <h1>{t("工程")}</h1>
              </div>
              <section className="new-project-panel" aria-label={t("新建工程")}>
                <fieldset className="mode-options">
                  <legend>{t("新建工程 · 工程类型")}</legend>
                  <div className="mode-options-list">
                    {modes.map((item) => (
                      <label
                        key={item.value}
                        className={`mode-option ${mode === item.value ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="project-mode"
                          value={item.value}
                          checked={mode === item.value}
                          onChange={() => setMode(item.value)}
                        />
                        <DocumentIcon mode={item.value} />
                        <span>{item.title}</span>
                        <code>
                          {item.value === "markdown" ? ".md" : item.value}
                        </code>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="create-action">
                  <button
                    className="button"
                    disabled={busy || mode === "markdown"}
                    onClick={() => void run(packDirectory)}
                  >
                    {t("打包已解包的 MDK 目录")}
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void run(createProject)}
                  >
                    <FilePlus2 size={17} />
                    {t("创建新工程")}
                  </button>
                </div>
              </section>
              <div className="section-heading recent-heading">
                <h2>
                  {t("最近工程")}{" "}
                  <span className="count-badge">{recent.length}</span>
                </h2>
                <button
                  className="text-button"
                  onClick={() => void run(chooseProject)}
                >
                  {t("打开其他工程")}
                </button>
              </div>
              <div className="recent-list">
                <div className="recent-columns" aria-hidden="true">
                  <span>{t("名称 / 路径")}</span>
                  <span>{t("工程类型")}</span>
                  <span>{t("修改日期")}</span>
                  <span />
                </div>
                {recent.length ? (
                  recent.map((item) => (
                    <button
                      key={item.path}
                      className="recent-row"
                      disabled={busy}
                      onClick={() => void run(() => activate(item.path))}
                    >
                      <span className="recent-file">
                        <DocumentIcon
                          mode={
                            isMarkdownFile(item.path) ? "markdown" : item.mode
                          }
                        />
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.path}</span>
                      </div>
                      <span className="mode-chip">
                        {modes.find((m) => m.value === item.mode)?.title ??
                          item.mode}
                      </span>
                      <time>
                        {new Date(item.updatedAt).toLocaleDateString(
                          appLocale(),
                        )}
                      </time>
                      <ChevronRight size={16} />
                    </button>
                  ))
                ) : (
                  <div className="empty-recent">
                    <p>{t("暂无最近工程")}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="workspace-container" hidden={page !== "editor"}>
            <Workspace
              key={generation}
              ref={workspace}
              file={currentPath}
              initialProject={documentProject?.project}
              initialView={initialView}
              initialFragment={initialFragment}
              preferences={preferences}
              reading={reading}
              changeReading={changeReading}
              shortcutsEnabled={
                page === "editor" && !request && update?.phase !== "preparing"
              }
              theme={theme}
              ask={ask}
              notify={notify}
              onDirty={setIsDirty}
              onOpen={() => void run(chooseProject)}
              onRename={(file) => {
                setDocumentProject((current) => current && { ...current, file });
                void desktop()
                  .recent()
                  .then(setRecent)
                  .catch((error) => notify(String(error), true));
              }}
              onDeliver={() => setPage("delivery")}
            />
          </div>
          {page === "delivery" && (
            <Delivery
              file={currentPath}
              onConfigured={async (selected) => {
                if (selected === currentPath)
                  await workspace.current?.refresh();
              }}
              flush={() => workspace.current?.flush() ?? Promise.resolve(true)}
              notify={notify}
              ask={ask}
            />
          )}
          {page === "settings" && (
            <AppSettings
              value={preferences}
              onChange={receivePreferences}
              notify={notify}
              update={update}
            />
          )}
        </main>
        {busy && (
          <div
            className="progress-line"
            role="progressbar"
            aria-label={t("正在处理")}
          />
        )}
        {toast && (
          <div
            className={`toast ${toast.error ? "error" : ""}`}
            role={toast.error ? "alert" : "status"}
          >
            <span>{toast.error ? "!" : <Check size={15} />}</span>
            <p>{toast.text}</p>
            <button aria-label={t("关闭提示")} onClick={() => setToast(null)}>
              <X size={15} />
            </button>
          </div>
        )}
        {request && <Modal request={request} close={() => setRequest(null)} />}
        <UpdateNotice status={update} onOpen={() => setPage("settings")} />
      </div>
      {update?.phase === "preparing" && !request && (
        <div
          className="update-preparing"
          role="progressbar"
          aria-label={t("正在准备更新")}
        >
          <p>{t("正在处理所有窗口的未保存内容…")}</p>
        </div>
      )}
    </>
  );
}
