import type { MdkProject } from "./mdk";

export const isMarkdownFile = (file: string) => /\.md$/i.test(file);
export const isSupportedDocument = (file: string) => /\.(mdk|md)$/i.test(file);
export function isManuscript(project: MdkProject | null, file: string) {
  return (
    isMarkdownFile(file) &&
    (project?.format === "markdown" || file.startsWith("markdown/"))
  );
}
