declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  const plugin: Parameters<MarkdownIt["use"]>[0];
  export default plugin;
}
