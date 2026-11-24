import { appLocale, t } from "../../shared/i18n";
import { useEffect, useState } from "react";
import { markdownHeadings, type MarkdownHeading } from "../../shared/markdown";
import { previewTextLimit } from "./document-size";
import { mayContainMath, type renderPreview } from "./preview";

export type MarkdownTask =
  | { kind: "headings"; text: string; v2?: boolean }
  | { kind: "pages"; text: string; length: number; v2?: boolean }
  | { kind: "preview"; args: Parameters<typeof renderPreview> };

export function markdownTask<T>(
  task: MarkdownTask,
  result: (data: T) => void,
  failure: (message: string) => void = () => {},
) {
  let cancelled = false;
  let worker: Worker | undefined;
  const dispose = () => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = undefined;
  };
  const entry =
    task.kind === "preview" && !task.args[1]?.v2 && mayContainMath(task.args[0])
      ? import("./markdown-math.worker?worker&inline")
      : import("./markdown.worker?worker&inline");
  void entry
    .then(({ default: MarkdownWorker }) => {
      if (cancelled) return;
      worker = new MarkdownWorker();
      worker.onmessage = ({ data }) => {
        dispose();
        if (cancelled) return;
        if (data.error) failure(data.error);
        else result(data.result);
      };
      worker.onerror = (event) => {
        dispose();
        if (!cancelled) failure(event.message || t("Markdown 处理失败。"));
      };
      worker.postMessage({ ...task, locale: appLocale() });
    })
    .catch((error) => {
      if (!cancelled) failure(String(error));
    });
  return () => {
    cancelled = true;
    dispose();
  };
}

const empty: MarkdownHeading[] = [];
export function useMarkdownHeadings(path: string, text: string, v2 = false) {
  const [value, setValue] = useState<{
    path: string;
    text: string;
    v2: boolean;
    headings: MarkdownHeading[];
  }>();
  useEffect(() => {
    if (text.length <= 4_000) {
      setValue({
        path,
        text,
        v2,
        headings: text ? markdownHeadings(text, v2) : empty,
      });
      return;
    }
    if (text.length > previewTextLimit) {
      setValue({ path, text, v2, headings: empty });
      return;
    }
    let cancel: (() => void) | undefined;
    const timeout = setTimeout(() => {
      cancel = markdownTask<MarkdownHeading[]>(
        { kind: "headings", text, v2 },
        (headings) => setValue({ path, text, v2, headings }),
      );
    }, 180);
    return () => {
      clearTimeout(timeout);
      cancel?.();
    };
  }, [path, text, v2]);
  return {
    headings: value?.path === path && value.v2 === v2 ? value.headings : empty,
    fresh:
      value?.path === path &&
      value.v2 === v2 &&
      value.text === text &&
      text.length <= previewTextLimit,
  };
}
