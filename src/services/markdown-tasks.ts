import { useEffect, useState } from "react";
import { markdownHeadings, type MarkdownHeading } from "../../shared/markdown";
import { previewTextLimit } from "./document-size";
import { mayContainMath, type renderPreview } from "./preview";

export type MarkdownTask =
  | { kind: "headings"; text: string }
  | { kind: "pages"; text: string; length: number }
  | { kind: "preview"; args: Parameters<typeof renderPreview> };

export function markdownTask<T>(
  task: MarkdownTask,
  result: (data: T) => void,
  failure: (message: string) => void = () => {},
) {
  let cancelled = false;
  let worker: Worker | undefined;
  const entry =
    task.kind === "preview" && mayContainMath(task.args[0])
      ? import("./markdown-math.worker?worker&inline")
      : import("./markdown.worker?worker&inline");
  void entry
    .then(({ default: MarkdownWorker }) => {
      if (cancelled) return;
      worker = new MarkdownWorker();
      worker.onmessage = ({ data }) => {
        worker?.terminate();
        if (data.error) failure(data.error);
        else result(data.result);
      };
      worker.onerror = (event) => {
        worker?.terminate();
        failure(event.message || "Markdown 处理失败。");
      };
      worker.postMessage(task);
    })
    .catch((error) => {
      if (!cancelled) failure(String(error));
    });
  return () => {
    cancelled = true;
    worker?.terminate();
  };
}

const empty: MarkdownHeading[] = [];
export function useMarkdownHeadings(path: string, text: string) {
  const [value, setValue] = useState<{
    path: string;
    headings: MarkdownHeading[];
  }>();
  useEffect(() => {
    if (text.length <= 4_000) {
      setValue({ path, headings: text ? markdownHeadings(text) : empty });
      return;
    }
    if (text.length > previewTextLimit) {
      setValue({ path, headings: empty });
      return;
    }
    let cancel: (() => void) | undefined;
    const timeout = setTimeout(() => {
      cancel = markdownTask<MarkdownHeading[]>(
        { kind: "headings", text },
        (headings) => setValue({ path, headings }),
      );
    }, 180);
    return () => {
      clearTimeout(timeout);
      cancel?.();
    };
  }, [path, text]);
  return value?.path === path ? value.headings : empty;
}
