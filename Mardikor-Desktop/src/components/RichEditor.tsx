import { t } from "../../shared/i18n";
import { keyboardComposing } from "../../shared/shortcuts";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { editorExtensions } from "../services/rich-markdown";
import { chapterHeadingNumberer } from "../../shared/heading-numbering";
import type { DocumentPages, EditPageWindow } from "../services/document-pages";
import { richSectionHistory } from "../services/rich-section-history";
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

export type RichSectionView = {
  content: string;
  pagination?: DocumentPages;
  window?: EditPageWindow;
  page?: number;
};

export interface RichSectionHandle {
  move: (before: string, next: RichSectionView) => boolean;
}

export function richWindowPages({
  content,
  pagination,
  window,
}: RichSectionView) {
  if (!pagination || !window) return undefined;
  return pagination.pages
    .slice(window.first, window.last + 1)
    .map((entry, offset) => {
      const index = window.first + offset;
      return {
        index,
        text: content.slice(entry.start, pagination.pages[index + 1]?.start),
        final: index === pagination.pages.length - 1,
      };
    });
}

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
  documentView,
  onSectionChange,
  onShortcut,
  sectionRef,
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
  documentView: RichSectionView;
  onSectionChange: (view: RichSectionView) => void;
  onShortcut: (event: KeyboardEvent) => boolean;
  sectionRef: Ref<RichSectionHandle>;
  pageWindow?: {
    pages: RichPage[];
    update: (changes: RichPageChange[]) =>
      | {
          content: string;
          pagination: DocumentPages;
          applied: RichPageChange[];
        }
      | undefined;
    expand: (direction: -1 | 1) => void;
  };
}) {
  const changeRef = useRef(onChange);
  const shortcut = useRef(onShortcut);
  shortcut.current = onShortcut;
  const editorText = useRef("");
  const pagesRef = useRef(pageWindow);
  pagesRef.current = pageWindow;
  const loadedPages = useRef(new Map<number, string>());
  const lastState = useRef<EditorState>(undefined);
  const previousState = useRef<EditorState>(undefined);
  const currentView = useRef(documentView);
  const accepted = useRef(documentView.content);
  currentView.current = documentView;
  const sectionChange = useRef(onSectionChange);
  sectionChange.current = onSectionChange;
  const [sectionHistory] = useState(() =>
    richSectionHistory(
      () => ({
        view: currentView.current,
        loaded: new Map(loadedPages.current),
      }),
      ({ view, loaded }) => {
        accepted.current = view.content;
        currentView.current = view;
        editorText.current = view.content;
        loadedPages.current = loaded;
        sectionChange.current(view);
      },
    ),
  );
  changeRef.current = onChange;
  const resolveRef = useRef(resolveResource);
  resolveRef.current = resolveResource;
  const [extensions] = useState(() => [
    ...editorExtensions((src) => resolveRef.current(src), !!pageWindow, true),
    sectionHistory.extension,
    ...(pageWindow ? [RichPages] : []),
  ]);
  const editor = useEditor({
    extensions,
    shouldRerenderOnTransaction: false,
    content: "",
    contentType: "markdown",
    editable,
    editorProps: {
      handleDOMEvents: {
        keydown: (view, event) => view.composing || keyboardComposing(event),
      },
      handleKeyDown: (_view, event) => shortcut.current(event),
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
    onUpdate: ({ editor, transaction }) => {
      if (!isHistoryTransaction(transaction)) sectionHistory.branch();
      if (pagesRef.current) {
        if (!previousState.current) return;
        const changes = richPageChanges(
          editor,
          previousState.current,
          editor.state.doc,
          richPageParts(editor.state),
        );
        const next = changes.length
          ? pagesRef.current.update(changes)
          : undefined;
        if (next) {
          accepted.current = next.content;
          currentView.current = {
            ...currentView.current,
            content: next.content,
            pagination: next.pagination,
          };
          for (const change of next.applied)
            loadedPages.current.set(change.index, change.text);
        }
        return;
      }
      const bom = editorText.current.startsWith("\ufeff") ? "\ufeff" : "";
      const markdown = bom + editor.getMarkdown();
      editorText.current = changeRef.current(markdown) ?? markdown;
      accepted.current = editorText.current;
      currentView.current = { content: editorText.current };
    },
  });
  useImperativeHandle(
    sectionRef,
    () => ({
      move(before, next) {
        if (
          !editor?.isEditable ||
          editor.view.composing ||
          accepted.current !== before
        )
          return false;
        const pages = richWindowPages(next);
        if (!!pages !== !!pagesRef.current) return false;
        sectionHistory.record(editor);
        if (pages) {
          loadRichPages(editor, pages, loadedPages.current);
          loadedPages.current = new Map(
            pages.map(({ index, text }) => [index, text]),
          );
        } else {
          editor
            .chain()
            .setMeta("addToHistory", false)
            .setContent(next.content.replace(/^\ufeff/, ""), {
              contentType: "markdown",
              emitUpdate: false,
            })
            .run();
        }
        accepted.current = editorText.current = next.content;
        currentView.current = next;
        sectionChange.current(next);
        return true;
      },
    }),
    [editor, sectionHistory],
  );
  useLayoutEffect(() => {
    if (accepted.current !== documentView.content) {
      // An edit from another pane invalidates full-source checkpoints here.
      sectionHistory.clear();
      accepted.current = documentView.content;
    }
  }, [documentView.content, sectionHistory]);
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
      editor.commands.setContent(content.replace(/^\ufeff/, ""), {
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
