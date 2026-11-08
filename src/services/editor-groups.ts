import type { MdkProject, SaveSnapshot } from "../../shared/mdk";
import { isManuscript } from "../../shared/workspace";
import { canEditVisually } from "./document-size";
import type { DocumentPages } from "./document-pages";

export type EditorTab = "source" | "write" | "preview" | "settings";
export function editorFileKind(project: MdkProject | null, path: string) {
  const file = project?.files.find((item) => item.path === path);
  if (file?.kind === "directory") return;
  if (file && (/\.svg$/i.test(path) || !file.is_text)) return "media";
  if (file?.is_text) return isManuscript(project, path) ? "markdown" : "text";
  if (project && project.format !== "markdown" && path === "settings.toml")
    return "text";
}
export function editorView(
  kind: ReturnType<typeof editorFileKind>,
  requested: EditorTab,
  text = "",
  standalone = false,
): EditorTab {
  if (kind === "media") return "preview";
  if (kind !== "markdown") return "source";
  if (requested === "write" && !canEditVisually(text)) return "preview";
  if (requested === "settings" && standalone) return "source";
  return requested;
}
export interface TextBuffer {
  path: string;
  content: string;
  saved: string;
  pagination?: DocumentPages;
}
export interface EditorGroupState {
  id: string;
  path: string;
  tab: EditorTab;
  revision: number;
  zoom: number;
  cursor: { line: number; column: number };
  activeHeading: number;
  outlinePath?: string;
  reveal?: { path: string; line: number; key: number };
  heading?: { path: string; index: number; key: number };
}
export function newEditorGroup(path = ""): EditorGroupState {
  return {
    id: crypto.randomUUID(),
    path,
    tab: "source",
    revision: 0,
    zoom: 100,
    cursor: { line: 1, column: 1 },
    activeHeading: -1,
  };
}
export function textSnapshot(
  buffers: TextBuffer[],
): Pick<SaveSnapshot, "text" | "texts"> {
  const texts = buffers
    .filter((b) => b.content !== b.saved)
    .map(({ path, content }) => ({ path, content }));
  return texts.length === 1
    ? { text: texts[0] }
    : texts.length
      ? { texts }
      : {};
}
