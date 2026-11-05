import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export interface ModalRequest {
  title: string;
  description?: string;
  initial?: string;
  confirm?: string;
  danger?: boolean;
  input?: boolean;
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
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  function finish(result: string | null) {
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
          finish(request.input ? value : "confirmed");
        }}
      >
        <div className="modal-heading">
          <h2>{request.title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="取消"
            onClick={() => finish(null)}
          >
            <X size={18} />
          </button>
        </div>
        {request.description && <p>{request.description}</p>}
        {request.input && (
          <input
            aria-label={request.title}
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={() => finish(null)}>
            取消
          </button>
          <button
            className={`button ${request.danger ? "danger" : "primary"}`}
            type="submit"
            disabled={request.input && !value.trim()}
          >
            {request.confirm ?? "确定"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
