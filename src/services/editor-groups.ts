import type { SaveSnapshot } from "../../shared/mdk";

export type EditorTab = "source" | "write" | "preview" | "settings";
export interface TextBuffer {
  path: string;
  content: string;
  saved: string;
}
export interface EditorGroupState {
  id: string;
  path: string;
  tab: EditorTab;
  revision: number;
  zoom: number;
  cursor: { line: number; column: number };
  activeHeading: number;
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
