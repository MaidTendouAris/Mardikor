import { useEffect, useState } from "react";
import { enablePreviewMath } from "./preview";

let load: Promise<boolean> | undefined;
export function usePreviewMath(required: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!required) return;
    let live = true;
    load ??= import("@vscode/markdown-it-katex")
      .then((module) => {
        enablePreviewMath(module.default);
        return true;
      })
      .catch(() => false);
    void load.then((result) => {
      if (live) setReady(result);
    });
    return () => {
      live = false;
    };
  }, [required]);
  return ready;
}
