import { t } from "../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Select } from "./Select";

export interface ModalRequest {
  title: string;
  description?: string;
  initial?: string;
  confirm?: string;
  danger?: boolean;
  input?: boolean;
  password?: "new" | "existing";
  choices?: { value: string; label: string }[];
  select?: {
    label: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  };
  resolve: (value: string | null) => void;
}
export function Modal({
  request,
  close,
}: {
  request: ModalRequest;
  close: () => void;
}) {
  const [value, setValue] = useState(request.initial ?? "");
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  function finish(result: string | null) {
    setValue("");
    request.resolve(result);
    close();
  }
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        finish(null);
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!request.choices)
            finish(request.input || request.password ? value : "confirmed");
        }}
      >
        <div className="modal-heading">
          <h2>{request.title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t("取消")}
            onClick={() => finish(null)}
          >
            <X size={18} />
          </button>
        </div>
        {request.description && <p>{request.description}</p>}
        {request.select && (
          <div className="modal-field">
            <span>{request.select.label}</span>
            <Select
              aria-label={request.select.label}
              value={value}
              onValueChange={(next) => {
                setValue(next);
                request.select?.onChange(next);
              }}
            >
              {request.select.options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
        )}
        {(request.input || request.password) && (
          <>
            <input
              aria-label={request.title}
              autoFocus
              type={request.password && !visible ? "password" : "text"}
              autoComplete={request.password ? (request.password === "new" ? "new-password" : "current-password") : undefined}
              maxLength={request.password ? 4096 : undefined}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {request.password && (
              <div className="button-row">
                <button type="button" className="text-button" onClick={() => setVisible(!visible)}>
                  {visible ? t("隐藏口令") : t("显示口令")}
                </button>
                {request.password === "new" && (
                  <button type="button" className="text-button" onClick={() => {
                    const random = crypto.getRandomValues(new Uint8Array(24));
                    setValue(Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join(""));
                    setVisible(true);
                  }}>
                    {t("生成随机口令")}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={() => finish(null)}>
            {t("取消")}
          </button>
          {request.choices ? request.choices.map(({ value, label }) => (
            <button key={value} type="button" className="button" onClick={() => finish(value)}>
              {label}
            </button>
          )) : <button
            className={`button ${request.danger ? "danger" : "primary"}`}
            type="submit"
            disabled={request.password ? !value.length : request.input && !value.trim()}
          >
            {request.confirm ?? t("确定")}
          </button>}
        </div>
      </form>
    </dialog>
  );
}
