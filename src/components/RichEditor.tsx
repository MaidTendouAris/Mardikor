import { t } from "../../shared/i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { editorExtensions } from "../services/rich-markdown";
import { chapterHeadingNumberer } from "../../shared/heading-numbering";
import {
  loadRichPages,
  richPageChanges,
  richPageParts,
  RichPages,
  type RichPage,
  type RichPageChange,
} from "../services/rich-pages";
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
  priorHeadingLevels,
  reservedSections,
  pageWindow,
}: {
  content: string;
  revision: number;
  editable: boolean;
  onChange: (value: string) => string | void;
  onReady: (editor: Editor | null) => void;
  resolveResource: (src: string) => Promise<string>;
  chapterPosition?: string;
  priorHeadingLevels?: number[];
  reservedSections?: ReadonlySet<string>;
  pageWindow?: {
    pages: RichPage[];
    update: (changes: RichPageChange[]) => RichPageChange[];
    expand: (direction: -1 | 1) => void;
  };
}) {
  const changeRef = useRef(onChange);
  const editorText = useRef("");
  const pagesRef = useRef(pageWindow);
  pagesRef.current = pageWindow;
  const loadedPages = useRef(new Map<number, string>());
  const lastState = useRef<EditorState>(undefined);
  const previousState = useRef<EditorState>(undefined);
  changeRef.current = onChange;
  const resolveRef = useRef(resolveResource);
  resolveRef.current = resolveResource;
  const [extensions] = useState(() => [
    ...editorExtensions((src) => resolveRef.current(src), !!pageWindow),
    ...(pageWindow ? [RichPages] : []),
  ]);
  const editor = useEditor({
    extensions,
    shouldRerenderOnTransaction: false,
    content: "",
    contentType: "markdown",
    editable,
    editorProps: {
      attributes: {
        class: "document-body",
        spellcheck: "false",
        "aria-label": t("正文编辑器"),
      },
    },
    onTransaction: ({ editor }) => {
      previousState.current = lastState.current;
      lastState.current = editor.state;
    },
    onUpdate: ({ editor }) => {
      if (pagesRef.current) {
        if (!previousState.current) return;
        const changes = richPageChanges(
          editor,
          previousState.current,
          editor.state.doc,
          richPageParts(editor.state),
        );
        if (changes.length)
          for (const change of pagesRef.current.update(changes))
            loadedPages.current.set(change.index, change.text);
        return;
      }
      const markdown = editor.getMarkdown();
      editorText.current = changeRef.current(markdown) ?? markdown;
    },
  });
  useLayoutEffect(() => {
    const pages = pagesRef.current?.pages;
    if (!editor || !pages?.length) return;
    const loaded = loadedPages.current;
    if (
      loaded.size === pages.length &&
      pages.every(({ index, text }) => loaded.get(index) === text)
    )
      return;
    loadRichPages(editor, pages, loaded);
    loadedPages.current = new Map(
      pages.map(({ index, text }) => [index, text]),
    );
  }, [editor, revision, pageWindow?.pages]);
  useEffect(() => {
    if (!editor || !pagesRef.current) return;
    let frame = 0;
    function expand() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!editor || !editor.view.hasFocus() || editor.view.composing) return;
        const { from, to, empty } = editor.state.selection;
        const size = editor.state.doc.content.size;
        if (!empty) return;
        if (to > size - 160) pagesRef.current?.expand(1);
        else if (from < 160) pagesRef.current?.expand(-1);
      });
    }
    editor.on("selectionUpdate", expand);
    editor.on("focus", expand);
    editor.view.dom.addEventListener("compositionend", expand);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("selectionUpdate", expand);
      editor.off("focus", expand);
      editor.view.dom.removeEventListener("compositionend", expand);
    };
  }, [editor]);
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
              for (const level of priorHeadingLevels ?? []) number(level);
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
  }, [editor, chapterPosition, reservedSections, priorHeadingLevels]);
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable, false);
      editor.view.dom.setAttribute("aria-readonly", String(!editable));
    }
  }, [editor, editable]);
  useEffect(() => {
    if (editor && !pagesRef.current && editorText.current !== content) {
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
