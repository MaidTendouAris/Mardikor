import { appLocale, t, type LanguagePreference } from "../../shared/i18n";
import { useState } from "react";
import { Check, ChevronRight, ExternalLink, Keyboard } from "lucide-react";
import { version } from "../../package.json";
import license from "../../LICENSE?raw";
import cliGuide from "../../docs/CLI.md?raw";
import cliGuideEnglish from "../../docs/CLI.en.md?raw";
import {
  defaultPageLength,
  minPageLength,
  maxPageLength,
  type Preferences,
} from "../../shared/desktop";
import type { Notify } from "../App";
import { desktop } from "../services/desktop";
import { Select } from "../components/Select";
import { UpdateControls } from "../components/AppUpdate";
import { repositoryUrl, type UpdateStatus } from "../../shared/updates";
import { renderPreview } from "../services/preview";
import { ShortcutSettings } from "./ShortcutSettings";

const cliGuideHtml = renderPreview(
  appLocale() === "en" ? cliGuideEnglish : cliGuide,
);

export function AppSettings({
  value,
  onChange,
  notify,
  update,
}: {
  value: Preferences;
  onChange: (value: Preferences) => void;
  notify: Notify;
  update: UpdateStatus | null;
}) {
  const [draft, setDraft] = useState(value);
  const [draftLanguage, setDraftLanguage] = useState<LanguagePreference>();
  const language = draftLanguage ?? value.language ?? "system";
  const [busy, setBusy] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const changedLanguage = language !== (value.language ?? "system");
      onChange(
        await desktop().preferences({
          ...draft,
          shortcuts: value.shortcuts,
          language,
        }),
      );
      setDraftLanguage(undefined);
      notify(
        changedLanguage
          ? t("语言偏好已保存，重启应用后生效。")
          : t("应用设置已保存。"),
      );
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  }
  if (showShortcuts)
    return (
      <ShortcutSettings
        value={value.shortcuts}
        onBack={() => setShowShortcuts(false)}
        onSave={async (shortcuts) => {
          onChange(await desktop().preferences({ ...value, shortcuts }));
          notify(t("快捷键已保存。"));
        }}
      />
    );
  return (
    <section className="settings-page page-scroll">
      <h1>{t("应用设置")}</h1>
      <div className="settings-card">
        <label className="setting-row">
          <span>
            <strong>{t("应用语言")}</strong>
            <small>{t("语言设置将在重启应用后生效。")}</small>
          </span>
          <Select
            aria-label={t("应用语言")}
            className="short-input"
            value={language}
            onValueChange={(value) =>
              setDraftLanguage(value as LanguagePreference)
            }
          >
            <option value="system">{t("跟随系统")}</option>
            <option value="en">English</option>
            <option value="zh-CN">简体中文</option>
          </Select>
        </label>
      </div>
      <div className="settings-card">
        <div className="settings-card-heading">
          <h2>{t("编辑与保存")}</h2>
        </div>
        <div className="setting-row">
          <span>
            <strong>{t("键盘快捷键")}</strong>
            <small>{t("设置正文格式、保存和编辑组操作的组合键。")}</small>
          </span>
          <button
            className="button small"
            onClick={() => setShowShortcuts(true)}
          >
            <Keyboard size={16} />
            {t("配置快捷键")}
            <ChevronRight size={15} />
          </button>
        </div>
        <label className="setting-row">
          <span>
            <strong>{t("每页目标字符数")}</strong>
            <small>
              {t(
                "可视化编辑和预览共用此设置。实际页长会按 Markdown 块边界调整。",
              )}
            </small>
          </span>
          <input
            aria-label={t("每页目标字符数")}
            className="short-input"
            type="number"
            min={minPageLength}
            max={maxPageLength}
            step={1}
            value={
              Number.isNaN(draft.pageLength)
                ? ""
                : (draft.pageLength ?? defaultPageLength)
            }
            onChange={(event) =>
              setDraft({ ...draft, pageLength: event.target.valueAsNumber })
            }
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>{t("显示分页标记")}</strong>
            <small>{t("在连续滚动的正文旁标出每页起点。")}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label={t("显示分页标记")}
            checked={draft.showPageMarkers !== false}
            onChange={(event) =>
              setDraft({ ...draft, showPageMarkers: event.target.checked })
            }
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>{t("软件主题")}</strong>
            <small>
              {t("应用于窗口、侧栏和编辑器。工程可单独设置文稿配色。")}
            </small>
          </span>
          <Select
            aria-label={t("软件主题")}
            className="short-input"
            value={draft.appTheme ?? "light"}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                appTheme: value as Preferences["appTheme"],
              })
            }
          >
            <option value="light">{t("浅色")}</option>
            <option value="dark">{t("深色")}</option>
            <option value="warm">{t("护眼")}</option>
            <option value="system">{t("跟随系统")}</option>
          </Select>
        </label>
        <label className="setting-row">
          <span>
            <strong>{t("标题大纲跟随窗格")}</strong>
            <small>{t("按当前编辑光标或预览位置高亮标题并滚动大纲。")}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label={t("标题大纲跟随窗格")}
            checked={draft.followOutline !== false}
            onChange={(event) =>
              setDraft({ ...draft, followOutline: event.target.checked })
            }
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>{t("双击文件时打开的视图")}</strong>
            <small>
              {t(
                "从文件管理器打开 .md/.mdk 或启动时直接打开文件时使用，不影响新建工程。可视化不支持的内容将以源码打开。",
              )}
            </small>
          </span>
          <Select
            aria-label={t("双击文件时打开的视图")}
            className="short-input"
            value={draft.externalOpenView ?? "preview"}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                externalOpenView: value as Preferences["externalOpenView"],
              })
            }
          >
            <option value="preview">{t("预览")}</option>
            <option value="source">{t("源码")}</option>
            <option value="write">{t("可视化")}</option>
          </Select>
        </label>
        <label className="setting-row">
          <span>
            <strong>{t("自动保存")}</strong>
            <small>{t("自动保存当前正文或源码，有效校验后写入工程。")}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={draft.autosave}
            onChange={(e) => setDraft({ ...draft, autosave: e.target.checked })}
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>{t("保存间隔")}</strong>
            <small>{t("每隔指定秒数检查一次未保存内容。")}</small>
          </span>
          <div className="input-with-unit">
            <input
              aria-label={t("保存间隔")}
              type="number"
              min={5}
              max={3600}
              value={draft.autosaveInterval}
              onChange={(e) =>
                setDraft({ ...draft, autosaveInterval: +e.target.value })
              }
            />
            <span>{t("秒")}</span>
          </div>
        </label>
        <label className="setting-row">
          <span>
            <strong>{t("目录实时同步阈值")}</strong>
            <small>{t("目录项超过此数量时，调整顺序后手动更新目录。")}</small>
          </span>
          <input
            aria-label={t("目录实时同步阈值")}
            className="short-input"
            type="number"
            min={1}
            value={draft.directorySyncThreshold}
            onChange={(e) =>
              setDraft({ ...draft, directorySyncThreshold: +e.target.value })
            }
          />
        </label>
      </div>
      <div className="settings-card update-settings">
        <div className="settings-card-heading">
          <h2>{t("应用更新")}</h2>
        </div>
        <label className="setting-row">
          <span>
            <strong>{t("每日自动检查更新")}</strong>
            <small>
              {t(
                "每 24 小时检查一次 GitHub Releases。仅检查版本；下载与安装均需手动操作。更改后点击“保存偏好”生效。",
              )}
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label={t("每日自动检查更新")}
            checked={draft.autoCheckUpdates !== false}
            onChange={(event) =>
              setDraft({ ...draft, autoCheckUpdates: event.target.checked })
            }
          />
        </label>
        <UpdateControls status={update} notify={notify} />
      </div>
      <div className="settings-card-footer">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void save()}
        >
          <Check size={16} />
          {t("保存偏好")}
        </button>
      </div>
      <p className="settings-storage-note">
        {t("应用设置保存在本机，不写入 .mdk 文件。")}
      </p>
      <section
        className="settings-card app-information"
        aria-labelledby="app-information-heading"
      >
        <div className="settings-card-heading">
          <h2 id="app-information-heading">{t("关于 Mardikor")}</h2>
        </div>
        <div className="setting-row">
          <span>{t("版本号")}</span>
          <code>{update?.currentVersion ?? version}</code>
        </div>
        <details className="update-notes app-license">
          <summary>{t("许可证（GPL-3.0-only）")}</summary>
          <pre tabIndex={0} aria-label={t("GPLv3 许可证全文")}>
            {license}
          </pre>
        </details>
        <details className="app-license">
          <summary>{t("命令行使用指南")}</summary>
          <div
            className="preview-body cli-guide"
            role="region"
            tabIndex={0}
            aria-label={t("命令行指南全文")}
            dangerouslySetInnerHTML={{ __html: cliGuideHtml }}
          />
        </details>
        <div className="button-row">
          {[
            { label: t("GitHub 仓库"), url: repositoryUrl },
            { label: t("问题反馈"), url: repositoryUrl + "/issues" },
          ].map(({ label, url }) => (
            <a
              key={url}
              className="button"
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!window.mardikor) return;
                event.preventDefault();
                void desktop()
                  .openExternal(url)
                  .catch((error) => notify(String(error), true));
              }}
            >
              {label}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          ))}
        </div>
      </section>
    </section>
  );
}
