import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { editorExtensions } from "../services/rich-markdown";
export { editorExtensions } from "../services/rich-markdown";
export { RichToolbar } from "./RichToolbar";
export { richDropDraft } from "../services/rich-markdown";
export function RichEditor({
  content,
  revision,
  editable,
  onChange,
  onReady,
  resolveResource,
}: {
  content: string;
  revision: number;
  editable: boolean;
  onChange: (value: string) => void;
  onReady: (editor: Editor | null) => void;
  resolveResource: (src: string) => Promise<string>;
}) {
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const resolveRef = useRef(resolveResource);
  resolveRef.current = resolveResource;
  const editor = useEditor({
    extensions: editorExtensions((src) => resolveRef.current(src)),
    content: "",
    contentType: "markdown",
    editable,
    editorProps: {
      attributes: {
        class: "document-body",
        spellcheck: "false",
        "aria-label": "正文编辑器",
      },
    },
    onUpdate: ({ editor }) => changeRef.current(editor.getMarkdown()),
  });
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable, false);
      editor.view.dom.setAttribute("aria-readonly", String(!editable));
    }
  }, [editor, editable]);
  useEffect(() => {
    if (editor && editor.getMarkdown() !== content)
      editor.commands.setContent(content, {
        contentType: "markdown",
        emitUpdate: false,
      });
    // Shared buffers update sibling groups; local typing preserves the selection.
  }, [editor, revision, content]);
  useEffect(() => {
    onReady(editor);
    return () => onReady(null);
  }, [editor, onReady]);
  return <EditorContent editor={editor} />;
}
