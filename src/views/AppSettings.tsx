import { useState } from "react";
import { Check } from "lucide-react";
import type { Preferences } from "../../shared/desktop";
import type { Notify } from "../App";
import { desktop } from "../services/desktop";
import { Select } from "../components/Select";
import { UpdateControls } from "../components/AppUpdate";
import type { UpdateStatus } from "../../shared/updates";

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
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      onChange(await desktop().preferences(draft));
      notify("应用设置已保存。");
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-page page-scroll">
      <h1>应用设置</h1>
      <div className="settings-card">
        <div className="settings-card-heading">
          <h2>编辑与保存</h2>
        </div>
        <label className="setting-row">
          <span>
            <strong>双击文件时打开的视图</strong>
            <small>
              从文件管理器打开 .md/.mdk
              或启动时直接打开文件时使用，不影响新建工程。可视化不支持的内容将以源码打开。
            </small>
          </span>
          <Select
            aria-label="双击文件时打开的视图"
            className="short-input"
            value={draft.externalOpenView ?? "preview"}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                externalOpenView: value as Preferences["externalOpenView"],
              })
            }
          >
            <option value="preview">预览</option>
            <option value="source">源码</option>
            <option value="write">可视化</option>
          </Select>
        </label>
        <label className="setting-row">
          <span>
            <strong>自动保存</strong>
            <small>自动保存当前正文或源码，有效校验后写入工程。</small>
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
            <strong>保存间隔</strong>
            <small>每隔指定秒数检查一次未保存内容。</small>
          </span>
          <div className="input-with-unit">
            <input
              aria-label="保存间隔"
              type="number"
              min={5}
              max={3600}
              value={draft.autosaveInterval}
              onChange={(e) =>
                setDraft({ ...draft, autosaveInterval: +e.target.value })
              }
            />
            <span>秒</span>
          </div>
        </label>
        <label className="setting-row">
          <span>
            <strong>目录实时同步阈值</strong>
            <small>目录项超过此数量时，调整顺序后手动更新目录。</small>
          </span>
          <input
            aria-label="目录实时同步阈值"
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
          <h2>应用更新</h2>
        </div>
        <label className="setting-row">
          <span>
            <strong>每日自动检查更新</strong>
            <small>
              每 24 小时检查一次 GitHub
              Releases。仅检查版本；下载与安装均需手动操作。更改后点击“保存偏好”生效。
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="每日自动检查更新"
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
          保存偏好
        </button>
      </div>
      <p className="settings-storage-note">
        应用设置保存在本机，不写入 .mdk 文件。
      </p>
    </section>
  );
}
