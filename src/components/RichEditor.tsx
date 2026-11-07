import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { editorExtensions } from "../services/rich-markdown";
import { chapterHeadingNumberer } from "../../shared/heading-numbering";
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
  chapterPosition,
  reservedSections,
}: {
  content: string;
  revision: number;
  editable: boolean;
  onChange: (value: string) => void;
  onReady: (editor: Editor | null) => void;
  resolveResource: (src: string) => Promise<string>;
  chapterPosition?: string;
  reservedSections?: ReadonlySet<string>;
}) {
  const changeRef = useRef(onChange);
  const editorText = useRef("");
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
    onUpdate: ({ editor }) => {
      editorText.current = editor.getMarkdown();
      changeRef.current(editorText.current);
    },
  });
  useEffect(() => {
    if (!editor) return;
    let previous: ProseMirrorNode | undefined;
    let decorations = DecorationSet.empty;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        decorations: chapterPosition
          ? ({ doc }) => {
              if (doc === previous) return decorations;
              previous = doc;
              const number = chapterHeadingNumberer(
                chapterPosition,
                reservedSections,
              );
              const headings: Decoration[] = [];
              doc.descendants((node, position) => {
                if (node.type.name === "heading")
                  headings.push(
                    Decoration.node(position, position + node.nodeSize, {
                      "data-heading-number": number(node.attrs.level),
                    }),
                  );
              });
              return (decorations = DecorationSet.create(doc, headings));
            }
          : undefined,
      },
    });
  }, [editor, chapterPosition, reservedSections]);
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable, false);
      editor.view.dom.setAttribute("aria-readonly", String(!editable));
    }
  }, [editor, editable]);
  useEffect(() => {
    if (editor && editorText.current !== content) {
      editor.commands.setContent(content, {
        contentType: "markdown",
        emitUpdate: false,
      });
      editorText.current = content;
    }
    // Shared buffers update sibling groups; local typing preserves the selection.
  }, [editor, revision, content]);
  useEffect(() => {
    onReady(editor);
    return () => onReady(null);
  }, [editor, onReady]);
  return <EditorContent editor={editor} />;
}
