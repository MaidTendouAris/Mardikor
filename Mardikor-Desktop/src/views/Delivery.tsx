import { t } from "../../shared/i18n";
import { useState } from "react";
import {
  CheckCircle2,
  FileCheck2,
  FolderOpen,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { desktop } from "../services/desktop";
import type { Ask, Notify } from "../App";
import type { ValidationReport, ExportPlan } from "../../shared/mdk";
import { isMarkdownFile } from "../../shared/workspace";
import { PublicationExport } from "../components/PublicationExport";

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
  file,
  flush,
  notify,
  ask,
  onConfigured,
}: {
  file: string;
  flush: () => Promise<boolean>;
  notify: Notify;
  ask: Ask;
  onConfigured: (file: string) => Promise<void>;
}) {
  const [input, setInput] = useState(file);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [exportPlan, setExportPlan] = useState<ExportPlan | null>(null);
  const [includeState, setIncludeState] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function unpack() {
    setBusy(true);
    try {
      if (!(await flush())) return;
      const source = input || (await desktop().dialog("open-project"));
      if (!source) return;
      const directory = await desktop().dialog("directory");
      if (!directory) return;
      await desktop().invoke("unpack", source, directory);
      notify(t("工程已解包。"));
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  }
  async function perform(action: "validate" | "preflight" | "export") {
    setBusy(true);
    try {
      if (!(await flush())) return;
      let selected = input;
      if (!selected) selected = (await desktop().dialog("open-project")) ?? "";
      if (!selected) return;
      setInput(selected);
      setReport(null);
      setExportPlan(null);
      const selection = { includeState, exclude: excluded };
      const plan =
        action !== "validate"
          ? await desktop().invoke("exportPlan", selected, selection)
          : null;
      const result =
        plan?.report ?? (await desktop().invoke("validate", selected));
      if (!plan || plan.preflight_report || !result.valid) {
        setReport(result);
        setExportPlan(plan);
      }
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
          selected.split(/[\\/]/).pop(),
        );
        if (output) {
          await desktop().invoke(
            "export",
            selected,
            output,
            plan?.revision ?? "",
            selection,
          );
          setReport(result);
          setExportPlan(plan);
          notify(t("工程已导出。"));
        }
      }
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="delivery-page page-scroll">
      <div className="delivery-heading">
        <div>
          <h1>{t("校验与导出")}</h1>
        </div>
      </div>
      <div className="delivery-file">
        <span className="recent-file">
          <FileCheck2 size={24} />
        </span>
        <div>
          <strong>{input.split(/[\\/]/).pop() || t("未选择工程")}</strong>
          <span>{input || t("支持 .mdk / .md 文件")}</span>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void (async () => {
              if (!(await flush())) return;
              const selected = await desktop().dialog("open-project");
              if (selected) {
                setInput(selected);
                setReport(null);
                setExportPlan(null);
                setExcluded([]);
                setIncludeState(false);
              }
            })().catch((error) => notify(String(error), true))
          }
        >
          <FolderOpen size={16} />
          {t("选择文件")}
        </button>
      </div>
      <PublicationExport
        file={input}
        flush={flush}
        notify={notify}
        onConfigured={async (path) => {
          setReport(null);
          setExportPlan(null);
          await onConfigured(path);
        }}
      />
      {!isMarkdownFile(input) && (
        <>
          <div className="section-heading">
            <h2>{t("MDK 工程容器交付")}</h2>
          </div>
          <div className="delivery-cards">
            <div className="validation-status">
              {report?.valid ? (
                <CheckCircle2 size={20} />
              ) : (
                <ShieldCheck size={20} />
              )}
              <h2>
                {report
                  ? report.valid
                    ? exportPlan
                      ? t("基础内容交付通过")
                      : t("工程校验通过")
                    : t("校验未通过")
                  : t("未校验")}
              </h2>
              <p>
                {report
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
                  disabled={busy}
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
                    onChange={(event) => setIncludeState(event.target.checked)}
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
                          checked={!excluded.includes(name)}
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
              <p>
                {t("保留：")}
                {exportPlan.included_meta.join("、") || t("无")}
              </p>
              <p>
                {t("剔除：")}
                {exportPlan.excluded_meta.join("、") || t("无")}
              </p>
            </div>
          )}
          {report?.scopes && (
            <dl className="validation-summary">
              {report.scopes.map(({ scope, status }) => (
                <div key={scope}>
                  <dt>{t(scopeLabels[scope])}</dt>
                  <dd>{t(statusLabels[status])}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="issues-list">
            {report?.issues.length ? (
              report.issues.map((issue, index) => (
                <div className={`issue ${issue.severity}`} key={index}>
                  <TriangleAlert size={18} />
                  <div>
                    <strong>
                      {issue.path ?? t("工程容器")}
                      <code>{issue.code}</code>
                    </strong>
                    <p>{issue.message}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="no-issues">
                <p>{report ? t("未发现问题。") : t("暂无校验结果。")}</p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
