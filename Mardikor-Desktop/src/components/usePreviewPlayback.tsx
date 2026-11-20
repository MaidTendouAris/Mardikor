import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  previewMediaKind,
  previewMediaMime,
  type PlaybackKind,
} from "../../shared/media-viewer";
import { resolveReference } from "../../shared/references";
import { MediaPlayer } from "./MediaPlayer";

interface PreviewPlayback {
  host: HTMLElement;
  path: string;
  kind: PlaybackKind;
  label: string;
}

export function usePreviewPlayback(
  content: RefObject<HTMLElement | null>,
  file: string | undefined,
  source: string | undefined,
  html: string,
) {
  const [players, setPlayers] = useState<PreviewPlayback[]>([]);
  useLayoutEffect(() => {
    const next: PreviewPlayback[] = [];
    const cleanup: (() => void)[] = [];
    if (file && source && html) {
      content.current
        ?.querySelectorAll<HTMLAnchorElement>("a[data-mdk-link]")
        .forEach((anchor) => {
          const reference = anchor.dataset.mdkLink ?? "";
          const target = resolveReference(source, reference);
          if (target.kind !== "local") return;
          const kind = previewMediaKind(previewMediaMime(target.path));
          if (kind !== "audio" && kind !== "video") return;

          const host = document.createElement("span");
          host.className = "preview-player-slot";
          host.dataset.mdkMediaRef = reference;
          host.dataset.findGenerated = "";
          anchor.after(host);
          const play = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const button = host.querySelector<HTMLButtonElement>(
              "button[data-media-toggle]",
            );
            button?.focus({ preventScroll: true });
            button?.click();
          };
          anchor.addEventListener("click", play);
          cleanup.push(() => {
            anchor.removeEventListener("click", play);
            host.remove();
          });
          next.push({
            host,
            path: target.path,
            kind,
            label: anchor.textContent?.trim() || target.path,
          });
        });
    }
    setPlayers(next);
    return () => cleanup.forEach((remove) => remove());
  }, [content, file, source, html]);
  return file
    ? players.map(({ host, path, kind, label }, index) =>
        createPortal(
          <MediaPlayer file={file} path={path} kind={kind} label={label} />,
          host,
          String(index),
        ),
      )
    : null;
}
