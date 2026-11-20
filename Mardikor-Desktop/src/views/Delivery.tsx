import { t } from "../../shared/i18n";
import { useState, type Ref } from "react";
import { Archive, CheckCircle2, ShieldCheck } from "lucide-react";
import { desktop } from "../services/desktop";
import type { Ask, Notify } from "../App";
import type { ValidationReport, ExportPlan } from "../../shared/mdk";
import { isMarkdownFile } from "../../shared/workspace";
import {
  PublicationExport,
  type PublicationHandle,
} from "../components/PublicationExport";
import { ValidationIssueRow } from "../components/ValidationIssueRow";

const scopeLabels = {
  container: "容器",
  core: "核心结构",
  content: "基础内容",
  presentation: "显示效果",
  publication: "出版配置",
  portability: "可移植性",
} as const;
const statusLabels = {
  pass: "通过",
  fail: "失败",
  unverified: "未验证",
} as const;

export function Delivery({
  hidden,
  file,
  revision,
  getRevision,
  flush,
  notify,
  ask,
  onConfigured,
  onPackDistribution,
  publicationRef,
  onPublicationDirty,
  onPublicationBusy,
  issueFiles,
  onOpenIssue,
  busy: workspaceBusy,
}: {
  hidden: boolean;
  file: string;
  revision: string;
  getRevision: () => string | undefined;
  flush: () => Promise<boolean>;
  notify: Notify;
  ask: Ask;
  onConfigured: () => Promise<void>;
  onPackDistribution: () => void;
  publicationRef: Ref<PublicationHandle>;
  onPublicationDirty: (dirty: boolean) => void;
  onPublicationBusy: (busy: boolean) => void;
  issueFiles: ReadonlySet<string>;
  onOpenIssue: (path: string) => void;
  busy: boolean;
}) {
  const standalone = isMarkdownFile(file);
  const [section, setSection] = useState<"publication" | "project">(
    "publication",
  );
  const [check, setCheck] = useState<{
    revision?: string;
    report: ValidationReport;
    plan: ExportPlan | null;
    selectionKey: string;
  }>();
  const currentCheck = check?.revision === revision ? check : undefined;
  const report = currentCheck?.report;
  const exportPlan = currentCheck?.plan;
  const [includeState, setIncludeState] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const selection = {
    includeState,
    exclude: excluded.filter((path) => issueFiles.has(path)),
  };
  const selectionKey = JSON.stringify([
    includeState,
    [...selection.exclude].sort(),
  ]);
  const stale = Boolean(
    exportPlan && currentCheck?.selectionKey !== selectionKey,
  );
  const deliveryFiles = exportPlan
    ? [...exportPlan.included_meta, ...exportPlan.excluded_meta].sort()
    : [];
  const omitted = new Set(selection.exclude);
  const excludedFiles = deliveryFiles.filter(
    (path) => omitted.has(path) || (path.startsWith("state/") && !includeState),
  );
  const omittedFiles = new Set(excludedFiles);
  const includedFiles = deliveryFiles.filter((path) => !omittedFiles.has(path));
  const [working, setWorking] = useState(false);
  const busy = working || workspaceBusy;
  async function unpack() {
    setWorking(true);
    try {
      if (!(await flush())) return;
      if (
        (await desktop().inspectEnvelope(file)).kind === "MDKP" &&
        !(await ask({
          title: t("解包受保护工程"),
          description: t("选定目录将写入明文正文和资源。"),
          danger: true,
        }))
      )
        return;
      const directory = await desktop().dialog("directory");
      if (!directory) return;
      await desktop().invoke("unpack", file, directory);
      notify(t("工程已解包。"));
    } catch (error) {
      notify(String(error), true);
    } finally {
      setWorking(false);
    }
  }
  async function perform(action: "validate" | "preflight" | "export") {
    setWorking(true);
    try {
      if (!(await flush())) return;
      const checkedRevision = getRevision();
      setCheck(undefined);
      const plan =
        action !== "validate"
          ? await desktop().invoke("exportPlan", file, selection)
          : null;
      const result = plan?.report ?? (await desktop().invoke("validate", file));
      setCheck({
        revision: plan?.revision ?? checkedRevision,
        report: result,
        plan,
        selectionKey,
      });
      if (action === "export") {
        if (!result.valid) throw new Error(t("请先修复校验错误。"));
        if (
          plan?.confirmation_required &&
          !(await ask({
            title: t("确认本次交付剔除持久资料？"),
            description:
              t("交付副本将剔除以下持久或未知数据，源工程仍保留：\n") +
              plan.excluded_persistent.join("\n"),
            confirm: t("确认剔除并交付"),
            danger: true,
          }))
        )
          return;
        const output = await desktop().dialog(
          "save-project",
          file.split(/[\\/]/).pop(),
        );
        if (output) {
          await desktop().invoke(
            "export",
            file,
            output,
            plan?.revision ?? "",
            selection,
          );
          notify(t("工程已导出。"));
        }
      }
    } catch (error) {
      notify(String(error), true);
    } finally {
      setWorking(false);
    }
  }
  return (
    <section
      className="delivery-page page-scroll"
      hidden={hidden}
      aria-label={t("校验与导出")}
    >
      <div className="delivery-heading">
        <div>
          <h1>{t("校验与导出")}</h1>
          <p title={file}>{file.split(/[\\/]/).pop()}</p>
        </div>
      </div>
      {!standalone && (
        <div
          className="delivery-sections"
          role="group"
          aria-label={t("校验与导出")}
        >
          <button
            className="button"
            aria-pressed={section === "publication"}
            onClick={() => setSection("publication")}
          >
            PDF / EPUB
          </button>
          <button
            className="button"
            aria-pressed={section === "project"}
            onClick={() => setSection("project")}
          >
            MDK / MDKE
          </button>
        </div>
      )}
      <div hidden={section !== "publication"}>
        <PublicationExport
          file={file}
          flush={flush}
          notify={notify}
          onConfigured={onConfigured}
          ask={ask}
          handleRef={publicationRef}
          onDirty={onPublicationDirty}
          onBusy={onPublicationBusy}
          issueFiles={issueFiles}
          onOpenIssue={onOpenIssue}
        />
      </div>
      {!standalone && section === "project" && (
        <>
          <div className="section-heading">
            <h2>{t("MDK 工程容器交付")}</h2>
          </div>
          <div className="delivery-cards">
            <div className="validation-status">
              {report?.valid && !stale ? (
                <CheckCircle2 size={20} />
              ) : (
                <ShieldCheck size={20} />
              )}
              <h2>
                {stale
                  ? t("交付范围已更改，请重新预检")
                  : report
                    ? report.valid
                      ? exportPlan
                        ? t("基础内容交付通过")
                        : t("工程校验通过")
                      : t("校验未通过")
                    : t("未校验")}
              </h2>
              <p>
                {report && !stale
                  ? t(
                      "{0} 个错误 · {1} 个警告 · {2} 条提示",
                      report.issues.filter((i) => i.severity === "error")
                        .length,
                      report.issues.filter((i) => i.severity === "warning")
                        .length,
                      report.issues.filter((i) => i.severity === "info").length,
                    )
                  : t("检查容器、目录结构与资源引用是否完整。")}
              </p>
              <div className="button-row">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void unpack()}
                >
                  {t("解包工程目录")}
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void perform("validate")}
                >
                  {t("校验工程")}
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void perform("preflight")}
                >
                  {t("交付预检")}
                </button>
                <button
                  className="button primary"
                  disabled={busy || stale}
                  onClick={() => void perform("export")}
                >
                  {t("导出 .mdk")}
                </button>
              </div>
            </div>
            <dl className="validation-summary">
              {[
                [t("工程模式"), report?.mode ?? "—"],
                [t("目录项"), report?.summary?.entries ?? "—"],
                [t("文件总数"), report?.summary?.files ?? "—"],
                [t("资源数量"), report?.summary?.resources ?? "—"],
              ].map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="delivery-distribution">
            <div>
              <h2>{t("MDKE 分发包")}</h2>
              <p>{t("封装当前工程，可选择压缩方式和解包口令。")}</p>
            </div>
            <button
              className="button"
              disabled={busy}
              onClick={onPackDistribution}
            >
              <Archive size={16} />
              {t("生成 MDKE")}
            </button>
          </div>
          {report && (
            <>
              <div className="section-heading">
                <h2>{t("MDK 容器校验详情")}</h2>
              </div>
              {exportPlan && (
                <div className="export-meta-plan">
                  <strong>{t("本次交付范围")}</strong>
                  <p>
                    <label>
                      <input
                        type="checkbox"
                        checked={includeState}
                        disabled={busy}
                        onChange={(event) =>
                          setIncludeState(event.target.checked)
                        }
                      />{" "}
                      {t("携带可重建状态")}
                    </label>
                  </p>
                  {exportPlan.selectable.length > 0 && (
                    <fieldset>
                      <legend>{t("随副本携带的附加文件")}</legend>
                      {exportPlan.selectable.map((name) => (
                        <div key={name}>
                          <label>
                            <input
                              type="checkbox"
                              checked={!omitted.has(name)}
                              disabled={busy}
                              onChange={(event) => {
                                const keep = event.target.checked;
                                setExcluded((old) =>
                                  keep
                                    ? old.filter((item) => item !== name)
                                    : [...old, name],
                                );
                              }}
                            />{" "}
                            {name}
                          </label>
                        </div>
                      ))}
                    </fieldset>
                  )}
                  <p aria-live="polite">
                    {t("保留：")}
                    {includedFiles.join("、") || t("无")}
                  </p>
                  <p aria-live="polite">
                    {t("剔除：")}
                    {excludedFiles.join("、") || t("无")}
                  </p>
                </div>
              )}
              {!stale && report?.scopes && (
                <dl className="validation-summary">
                  {report.scopes.map(({ scope, status }) => (
                    <div key={scope}>
                      <dt>{t(scopeLabels[scope])}</dt>
                      <dd>{t(statusLabels[status])}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {!stale && (
                <div className="issues-list">
                  {report?.issues.length ? (
                    report.issues.map((issue, index) => (
                      <ValidationIssueRow
                        key={index}
                        issue={issue}
                        fallback={t("工程容器")}
                        onOpen={
                          issue.path && issueFiles.has(issue.path)
                            ? onOpenIssue
                            : undefined
                        }
                      />
                    ))
                  ) : (
                    <div className="no-issues">
                      <p>{report ? t("未发现问题。") : t("暂无校验结果。")}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
