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
  FileInput,
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  Maximize2,
  Minus,
  PanelLeft,
  Settings2,
  X,
} from "lucide-react";
import { desktop, desktopErrorMessage } from "./services/desktop";
import { Modal, type ModalRequest } from "./components/Modal";
import { DocumentIcon } from "./components/DocumentIcon";
import appIcon from "../assets/icon.svg";
import { Workspace, type WorkspaceHandle } from "./views/Workspace";
import { AppSettings, type AppSettingsDraft } from "./views/AppSettings";
import { UpdateNotice, useAppUpdate } from "./components/AppUpdate";
import type { Preferences, RecentProject } from "../shared/desktop";
import type { MdkProject } from "../shared/mdk";
import type { ArchiveProgress } from "../shared/archive-operation";
import { isMarkdownFile } from "../shared/workspace";
import {
  defaultReadingPreferences,
  type ReadingChange,
} from "../shared/reading";
import type { EditorTab } from "./services/editor-groups";
import { isMdkeCompression, mdkeCompressionOptions, type EnvelopeAction, type MdkeCompression } from "../shared/envelopes";
import { normalizeUnicode151 } from "../shared/mdk-anchors";

export type Ask = (
  options: Omit<ModalRequest, "resolve">,
) => Promise<string | null>;
export type Notify = (message: string, error?: boolean) => void;
type Page = "home" | "editor" | "settings";

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
  const [settingsDraft, setSettingsDraft] = useState<AppSettingsDraft>({});
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
  const [converting, setConverting] = useState(false);
  const [processingEnvelope, setProcessingEnvelope] = useState(false);
  const [archiveProgress, setArchiveProgress] = useState<ArchiveProgress | null>(null);
  useEffect(() => window.mardikor?.onArchiveProgress(setArchiveProgress), []);
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
        text: desktopErrorMessage(text),
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
    if (!isMarkdownFile(file)) {
      const api = desktop();
      const info = await api.inspectEnvelope(file);
      if (info.kind === "MDKE") {
        await openDistribution(file, info.encrypted, view);
        return;
      }
      if (info.kind === "MDKP") {
        const passphrase = await ask({
          title: t("访问口令"),
          password: "existing",
          confirm: t("解锁工程"),
        });
        if (passphrase === null) return;
        await envelopeAction(file, { kind: "unlock", passphrase });
      } else if (/\.mdke$/i.test(file)) {
        throw new Error(t("请选择有效的 MDKE 分发包。"));
      }
    }
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
  async function envelopeAction(file: string, action: EnvelopeAction) {
    setProcessingEnvelope(true);
    try {
      return await desktop().envelope(file, action);
    } finally {
      setProcessingEnvelope(false);
    }
  }
  async function newPassphrase(title: string) {
    const first = await ask({ title, password: "new", description: t("口令使用 NFC 规范化，保留首尾空格。请妥善保存口令。") });
    if (first === null) return null;
    const second = await ask({ title: t("确认口令"), password: "existing" });
    if (second === null) return null;
    if (normalizeUnicode151(first) !== normalizeUnicode151(second))
      throw new Error(t("两次输入的口令不一致。"));
    return first;
  }
  function showEnvelopeReport(report: Awaited<ReturnType<typeof envelopeAction>>) {
    if (!report || !("outer" in report)) return;
    const status = report.innerProject === "unverified" ? t("未验证") :
      report.innerProject === "pass" ? t("通过") : t("失败");
    notify(t("外层校验通过。内层类型 {0}。工程校验 {1}。", report.innerIdentity, status));
  }
  async function openDistribution(file: string, encrypted: boolean, view: EditorTab) {
    const choice = await ask({
      title: t("MDKE 分发包"),
      choices: [
        { value: "extract", label: t("提取并打开") },
        { value: "set", label: encrypted ? t("更改解包口令") : t("添加解包口令") },
        ...(encrypted ? [{ value: "remove", label: t("移除解包口令") }] : []),
      ],
    });
    if (choice === null) return;
    if (choice === "extract" && encrypted && !await ask({
      title: t("提取 MDK"),
      description: t("仅有外层保护时，提取的工程是明文。内层访问保护会随工程保留。"),
    })) return;
    let passphrase: string | undefined;
    if (encrypted) {
      const entered = await ask({ title: t("解包口令"), password: "existing" });
      if (entered === null) return;
      passphrase = entered;
    }
    if (choice === "extract") {
      const output = await desktop().dialog("save-project", file.replace(/\.(mdke|mdk)$/i, "") + "-extracted.mdk");
      if (!output) return;
      showEnvelopeReport(await envelopeAction(file, { kind: "extract", passphrase, output }));
      await activate(output, view);
      return;
    }
    let nextPassphrase: string | undefined;
    if (choice === "set") {
      const entered = await newPassphrase(t("新解包口令"));
      if (entered === null) return;
      nextPassphrase = entered;
    }
    const output = await desktop().dialog("save-mdke", file.replace(/\.(mdke|mdk)$/i, "") + "-copy.mdke");
    if (output)
      showEnvelopeReport(await envelopeAction(file, { kind: "rekey", passphrase, nextPassphrase, output }));
  }
  async function packDistribution(chosen?: string) {
    const source = chosen ?? await desktop().dialog("open-project");
    if (!source) return;
    if (!/\.mdk$/i.test(source)) throw new Error(t("请选择要打包的 MDK 工程。"));
    let compression: MdkeCompression = "auto";
    const labels: Record<MdkeCompression, string> = {
      auto: t("自动（普通 MDK 压缩，受保护 MDK 原样存储）"),
      store: t("STORE（原样存储）"),
      "zstd-3": t("Zstandard（等级 3）"),
      "zstd-9": t("Zstandard（等级 9）"),
    };
    const choice = await ask({
      title: t("生成 MDKE"),
      description: t("MDKE 保留原工程字节及其访问保护。请为两层使用不同口令。"),
      initial: compression,
      select: {
        label: t("压缩方式"),
        options: mdkeCompressionOptions.map((value) => ({ value, label: labels[value] })),
        onChange: (value) => {
          if (isMdkeCompression(value)) compression = value;
        },
      },
      choices: [
        { value: "plain", label: t("直接打包") },
        { value: "encrypted", label: t("设置解包口令") },
      ],
    });
    if (!choice) return;
    let passphrase: string | undefined;
    if (choice === "encrypted") {
      const entered = await newPassphrase(t("新解包口令"));
      if (entered === null) return;
      passphrase = entered;
    }
    const output = await desktop().dialog("save-mdke", source.replace(/\.mdk$/i, ".mdke"));
    if (!output) return;
    if (source === currentPath && workspace.current && !(await workspace.current.flush())) return;
    const action = { kind: "pack", passphrase, output, compression } as const;
    let report = await envelopeAction(source, action);
    if (report && "overlap" in report) {
      if (!await ask({
        title: t("两层口令相同"),
        description: t("使用同一口令会减弱两层保护。继续打包？"),
      })) return;
      report = await envelopeAction(source, { ...action, allowOverlap: true });
    }
    showEnvelopeReport(report);
  }
  async function manageAccess(isProtected: boolean) {
    if (!documentProject || !workspace.current) return;
    const { file } = documentProject;
    const editor = workspace.current;
    const choice = await ask({
      title: t("访问保护"),
      choices: isProtected
        ? [
            { value: "lock", label: t("锁定工程") },
            { value: "set", label: t("更改访问口令") },
            { value: "remove", label: t("移除访问保护") },
          ]
        : [{ value: "set", label: t("设置访问口令") }],
    });
    if (choice === null) return;
    if (choice === "lock") {
      if (!(await editor.flush())) return;
      desktop().setDirty(false);
      await desktop().lockEnvelope(file);
      setDocumentProject(undefined);
      setIsDirty(false);
      setGeneration((n) => n + 1);
      setPage("home");
      return;
    }
    let passphrase: string | null = null;
    if (choice === "set") {
      passphrase = await newPassphrase(t("新访问口令"));
      if (passphrase === null) return;
    } else if (!await ask({
      title: t("移除访问保护"),
      description: t("此操作会将工程保存为明文。"),
      danger: true,
    })) return;
    await editor.changeAccess(async (snapshot) => {
      const result = await envelopeAction(file, { kind: "set-access", passphrase, snapshot });
      if (!result || !("project" in result)) throw new Error(t("封装操作参数无效。"));
      return result;
    });
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
    await desktop().invoke("pack", directory, output);
    await activate(output);
    notify(t("目录已打包为 MDK 工程。"));
  }
  async function convertMarkdown() {
    setConverting(true);
    try {
      if (await desktop().convertMarkdown()) {
        setRecent(await desktop().recent());
        notify(t("已生成 MDK，转换报告位于文稿目录首位。"));
      }
    } finally {
      setConverting(false);
    }
  }
  async function windowAction(action: "minimize" | "maximize" | "close") {
    setMaximized(await desktop().window(action));
  }
  return (
    <>
      <div
        className={`app-shell ${compact ? "compact-nav" : ""}`}
        inert={(update?.phase === "preparing" || processingEnvelope || !!archiveProgress) && !request}
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
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                title={item.title}
                className={`nav-item ${page === item.id ? "active" : ""}`}
                onClick={() => {
                  if (item.id === "editor") workspace.current?.showEditor();
                  setPage(item.id);
                }}
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
                  <button className="button" disabled={busy} onClick={() => void run(() => packDistribution())}>
                    {t("生成 MDKE")}
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void run(convertMarkdown)}
                  >
                    <FileInput size={17} />
                    {converting ? t("正在转换…") : t("Markdown 转 MDK")}
                  </button>
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
              visible={page === "editor"}
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
              onManageAccess={(isProtected) => void run(() => manageAccess(isProtected))}
              onPackDistribution={() => void run(() => packDistribution(currentPath))}
              onRename={(file) => {
                setDocumentProject((current) => current && { ...current, file });
                void desktop()
                  .recent()
                  .then(setRecent)
                  .catch((error) => notify(String(error), true));
              }}
            />
          </div>
          {page === "settings" && (
            <AppSettings
              value={preferences}
              draftState={settingsDraft}
              onDraftChange={setSettingsDraft}
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
        {request && <Modal key={request.title} request={request} close={() => setRequest(null)} />}
        <UpdateNotice status={update} onOpen={() => setPage("settings")} />
      </div>
      {processingEnvelope && (
        <div className="update-preparing" role="dialog" aria-label={t("正在处理封装")}>
          <div className="button-row">
            <span role="status">{t("正在处理封装")}</span>
            <button className="button" onClick={() => void desktop().cancelEnvelope()}>{t("取消")}</button>
          </div>
        </div>
      )}
      {archiveProgress && (
        <div className="update-preparing" role="dialog" aria-label={t("正在处理 MDK 文件")}>
          <div className="button-row">
            <span role="status">{archiveProgress.committing ? t("正在提交 MDK 文件") :
              t("正在处理 MDK 文件：已处理 {0} MiB", Math.round(archiveProgress.bytes / 1048576).toLocaleString(appLocale()))}</span>
            <button className="button" disabled={archiveProgress.committing} onClick={() => void desktop().cancelArchive()}>{t("取消")}</button>
          </div>
        </div>
      )}
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
