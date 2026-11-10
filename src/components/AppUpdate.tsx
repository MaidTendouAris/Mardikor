import { appLocale, t } from "../../shared/i18n";
import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, RefreshCw, X } from "lucide-react";
import type { UpdateAction, UpdateStatus } from "../../shared/updates";
import { desktop } from "../services/desktop";
import { renderReleaseNotes } from "../services/release-notes";
import type { Notify } from "../App";

export function useAppUpdate() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    if (!window.mardikor) return;
    const unsubscribe = window.mardikor.onUpdate(setStatus);
    void window.mardikor
      .update("status")
      .then(setStatus)
      .catch(() => {});
    return unsubscribe;
  }, []);
  return status;
}
export function UpdateControls({
  status,
  notify,
}: {
  status: UpdateStatus | null;
  notify: Notify;
}) {
  const [pending, setPending] = useState(false);
  const notes = status?.releaseNotes;
  const releaseUrl = status?.releaseUrl;
  const notesHtml = useMemo(
    () => (notes && releaseUrl ? renderReleaseNotes(notes, releaseUrl) : ""),
    [notes, releaseUrl],
  );
  async function perform(action: UpdateAction) {
    setPending(true);
    try {
      await desktop().update(action);
    } catch (error) {
      notify(String(error), true);
    } finally {
      setPending(false);
    }
  }
  const busy =
    pending ||
    (!!status &&
      ["checking", "downloading", "preparing"].includes(status.phase));
  return (
    <>
      <p>
        {t("当前版本：")}
        {status?.currentVersion ?? "—"}
        {status?.latestVersion ? t(" · 新版本：{0}", status.latestVersion) : ""}
      </p>
      <p role="status" aria-label={t("更新状态")}>
        {status?.message ?? t("正在读取更新状态…")}
      </p>
      {status?.lastChecked ? (
        <p className="muted">
          {t("上次检查：")}
          {new Date(status.lastChecked).toLocaleString(appLocale())}
        </p>
      ) : null}
      {status?.phase === "downloading" && (
        <progress
          aria-label={t("更新下载进度")}
          max={100}
          value={status.percent}
        />
      )}
      <div className="update-actions">
        <button
          className="button"
          disabled={!status || busy}
          onClick={() => void perform("check")}
        >
          <RefreshCw size={15} />
          {t("立即检查更新")}
        </button>
        {status?.canInstall &&
          status.latestVersion &&
          ["available", "error"].includes(status.phase) && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void perform("download")}
            >
              <Download size={15} />
              {t("下载更新")}
            </button>
          )}
        {status?.phase === "downloaded" && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void perform("install")}
          >
            {t("安装并重启")}
          </button>
        )}
        <button
          className="button"
          onClick={() =>
            void desktop()
              .openExternal(
                status?.releaseUrl ??
                  "https://github.com/MaidTendouAris/Mardikor/releases",
              )
              .catch((error) => notify(String(error), true))
          }
        >
          <ExternalLink size={15} />
          {t("查看发布页")}
        </button>
      </div>
      {status && !status.canInstall && (
        <p className="muted">
          {t("便携版及当前运行环境请在发布页下载对应版本。")}
        </p>
      )}
      {notesHtml && (
        <details className="update-notes">
          <summary>{t("版本说明")}</summary>
          <div
            className="update-notes-content"
            dangerouslySetInnerHTML={{ __html: notesHtml }}
            onClick={(event) => {
              const href = (event.target as Element).closest<HTMLAnchorElement>(
                "a[href]",
              )?.href;
              if (!href) return;
              event.preventDefault();
              void desktop().openExternal(href)
                .catch((error) => notify(String(error), true));
            }}
          />
        </details>
      )}
    </>
  );
}
export function UpdateNotice({
  status,
  onOpen,
}: {
  status: UpdateStatus | null;
  onOpen: () => void;
}) {
  const [dismissed, setDismissed] = useState("");
  if (
    !status?.latestVersion ||
    dismissed === `${status.latestVersion}:${status.phase}` ||
    !["available", "downloading", "downloaded"].includes(status.phase)
  )
    return null;
  return (
    <aside
      className="update-notice"
      role="status"
      aria-label={t("发现应用更新")}
    >
      <button
        className="icon-button update-dismiss"
        aria-label={t("暂不处理更新")}
        onClick={() => setDismissed(`${status.latestVersion}:${status.phase}`)}
      >
        <X size={16} />
      </button>
      <strong>
        {status.phase === "downloaded"
          ? t("更新已准备好")
          : t("发现新版本 {0}", status.latestVersion)}
      </strong>
      <p>
        {status.phase === "downloading"
          ? t("正在下载 {0}%", Math.round(status.percent))
          : status.phase === "downloaded"
            ? t("请手动安装并重启，退出时不会自动安装。")
            : t("可在应用设置中查看并手动下载更新。")}
      </p>
      <button className="button" onClick={onOpen}>
        {t("查看更新")}
      </button>
    </aside>
  );
}
