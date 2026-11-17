import { parentPort, workerData } from "node:worker_threads";
import { setAppLocale, type AppLocale } from "../shared/i18n";
import { convertMarkdownToMdk } from "./markdown-conversion";

const { source, output, locale } = workerData as {
  source: string;
  output: string;
  locale: AppLocale;
};
setAppLocale(locale);
convertMarkdownToMdk(source, output);
parentPort!.postMessage(null);
