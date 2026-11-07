// Above these bounds ProseMirror and fully laid-out preview are more expensive
// than a virtual source editor. Sizes are UTF-16 code units in the renderer.
export const richTextLimit = 160_000;
export const previewTextLimit = 2_000_000;
export const isLargeDocument = (text: string) =>
  text.length >= richTextLimit || /(?:^|[\r\n])[^\r\n]{8192}/.test(text);
export const canRenderPreview = (text: string) =>
  text.length <= previewTextLimit && !/(?:^|[\r\n])[^\r\n]{65536}/.test(text);
