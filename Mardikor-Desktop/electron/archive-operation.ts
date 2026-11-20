import { AsyncLocalStorage } from "node:async_hooks";
import { t } from "../shared/i18n";
import type { ArchiveProgress } from "../shared/archive-operation";

const operations = new AsyncLocalStorage<{
  state: Int32Array;
  report(progress: ArchiveProgress): void;
  bytes: number;
  last: number;
}>();

export function withArchiveOperation<T>(
  state: Int32Array,
  report: (progress: ArchiveProgress) => void,
  work: () => T,
) {
  return operations.run({ state, report, bytes: 0, last: 0 }, work);
}

export function archiveCheckpoint(bytes = 0, commit = false) {
  const task = operations.getStore();
  if (!task) return;
  const status = commit
    ? Atomics.compareExchange(task.state, 0, 0, 2)
    : Atomics.load(task.state, 0);
  if (status === 1) throw new Error(t("MDK 操作已取消。"));
  task.bytes += bytes;
  const now = Date.now();
  if (commit || now - task.last >= 125) {
    task.last = now;
    task.report({ bytes: task.bytes, committing: commit || status === 2 });
  }
}
