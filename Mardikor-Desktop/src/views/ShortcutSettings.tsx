import { t } from "../../shared/i18n";
import { useState, type KeyboardEvent } from "react";
import { ArrowLeft, Check, RotateCcw } from "lucide-react";
import {
  shortcutError,
  shortcutFromEvent,
  shortcutKey,
  shortcuts,
  type ShortcutOverrides,
} from "../../shared/shortcuts";

export function ShortcutSettings({
  value,
  onSave,
  onBack,
}: {
  value: ShortcutOverrides | undefined;
  onSave: (value: ShortcutOverrides) => Promise<void>;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<ShortcutOverrides>(value ?? {});
  const [recording, setRecording] = useState<keyof ShortcutOverrides>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function record(
    event: KeyboardEvent<HTMLButtonElement>,
    id: keyof ShortcutOverrides,
  ) {
    if (recording !== id || event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(undefined);
      setError("");
      return;
    }
    if (["Control", "Meta", "Shift", "Alt"].includes(event.key) || event.repeat)
      return;
    const key = shortcutFromEvent(event.nativeEvent);
    if (!key) {
      setError(t("请按住 Ctrl，再按字母、数字、功能键或反斜杠。"));
      return;
    }
    const next = { ...draft, [id]: key };
    const conflict = shortcutError(next);
    if (conflict) {
      setError(conflict);
      return;
    }
    setDraft(next);
    setRecording(undefined);
    setError("");
  }

  async function save() {
    setBusy(true);
    try {
      await onSave(draft);
      setError("");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-page page-scroll">
      <button className="button small" onClick={onBack}>
        <ArrowLeft size={15} />
        {t("返回应用设置")}
      </button>
      <h1>{t("键盘快捷键")}</h1>
      <div className="settings-card">
        <p className="shortcut-help" id="shortcut-help">
          {t("点击当前组合键开始录制。可加入 Shift 或 Alt，按 Esc 取消录制。")}
        </p>
        {shortcuts.map((action) => {
          const key = shortcutKey(action, draft);
          const active = recording === action.id;
          return (
            <div className="setting-row" key={action.id}>
              <span>
                <strong>{action.label}</strong>
                <small>
                  {"level" in action || "command" in action
                    ? t("仅在可视化正文内生效")
                    : t("编辑工作区")}
                </small>
              </span>
              <div className="button-row">
                <button
                  className="button small shortcut-binding"
                  type="button"
                  aria-label={t("录制{0}快捷键", action.label)}
                  aria-describedby="shortcut-help"
                  aria-pressed={active}
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setRecording(active ? undefined : action.id);
                  }}
                  onKeyDown={(event) => record(event, action.id)}
                  onBlur={() => setRecording(undefined)}
                >
                  {active ? (
                    t("请按组合键…")
                  ) : key ? (
                    <kbd>{key}</kbd>
                  ) : (
                    t("未绑定")
                  )}
                </button>
                <button
                  className="button small"
                  aria-label={t("取消绑定{0}", action.label)}
                  disabled={busy || !key}
                  onClick={() => {
                    setDraft({ ...draft, [action.id]: null });
                    setError("");
                  }}
                >
                  {t("清除")}
                </button>
              </div>
            </div>
          );
        })}
        {error && (
          <p className="shortcut-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="settings-card-footer button-row">
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setDraft({});
            setError("");
          }}
        >
          <RotateCcw size={16} />
          {t("恢复默认")}
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void save()}
        >
          <Check size={16} />
          {t("保存快捷键")}
        </button>
      </div>
    </section>
  );
}
