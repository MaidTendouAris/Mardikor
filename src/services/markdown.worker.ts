import { markdownHeadings } from "../../shared/markdown";
import { renderPreview } from "./preview";
import { paginateMarkdown } from "./document-pages";
import type { MarkdownTask } from "./markdown-tasks";
import { setAppLocale, type AppLocale } from "../../shared/i18n";

self.onmessage = ({
  data,
}: MessageEvent<MarkdownTask & { locale: AppLocale }>) => {
  setAppLocale(data.locale);
  try {
    const result =
      data.kind === "headings"
        ? markdownHeadings(data.text)
        : data.kind === "pages"
          ? paginateMarkdown(data.text, data.length)
          : renderPreview(...data.args);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
