import { parentPort, workerData } from "node:worker_threads";
import { setAppLocale, type AppLocale } from "../shared/i18n";
import { runEnvelopeTask, type EnvelopeTask } from "./envelope-operations";

const { task, locale } = workerData as {
  task: EnvelopeTask;
  locale: AppLocale;
};
setAppLocale(locale);
void runEnvelopeTask(task).then(
  (result) => parentPort!.postMessage({ result }),
  (error: unknown) =>
    parentPort!.postMessage({
      error: error instanceof Error ? error.message : String(error),
    }),
);
