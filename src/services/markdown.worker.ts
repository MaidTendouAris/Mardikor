import { markdownHeadings } from "../../shared/markdown";
import { renderPreviewPages } from "./preview";
import type { MarkdownTask } from "./markdown-tasks";

self.onmessage = ({ data }: MessageEvent<MarkdownTask>) => {
  try {
    const result =
      data.kind === "headings"
        ? markdownHeadings(data.text)
        : renderPreviewPages(...data.args);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
