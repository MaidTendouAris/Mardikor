import { TriangleAlert } from "lucide-react";
import { t } from "../../shared/i18n";
import type { ValidationIssue } from "../../shared/mdk";

export function ValidationIssueRow({
  issue,
  fallback,
  onOpen,
}: {
  issue: ValidationIssue;
  fallback: string;
  onOpen?: (path: string) => void;
}) {
  const path = issue.path;
  return (
    <div className={`issue ${issue.severity}`}>
      <TriangleAlert size={18} />
      <div>
        <strong>
          {path && onOpen ? (
            <button
              className="text-button issue-file"
              onClick={() => onOpen(path)}
              title={t("打开 {0}", path)}
            >
              {path}
            </button>
          ) : (
            (path ?? fallback)
          )}
          <code>{issue.code}</code>
        </strong>
        <p>{issue.message}</p>
      </div>
    </div>
  );
}
