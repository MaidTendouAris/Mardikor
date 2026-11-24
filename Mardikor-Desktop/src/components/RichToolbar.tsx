import { t, translations } from "../../shared/i18n";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useEditorState, type Editor } from "@tiptap/react";
import { getMarkRange } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, TextSelection, type Selection } from "@tiptap/pm/state";
import type { Mark } from "@tiptap/pm/model";
import {
  Bold,
  Italic,
  Strikethrough,
  Code2,
  Quote,
  List,
  ListOrdered,
  ListTodo,
  Undo2,
  Redo2,
  SquareCode,
  Link,
  Image,
  Table2,
  PanelBottom,
  Minus,
  WrapText,
  IndentIncrease,
  IndentDecrease,
  RemoveFormatting,
  Unlink,
  FileUp,
  Paperclip,
  BookOpen,
  Copy,
  Clipboard,
  Scissors,
} from "lucide-react";
import type { ProjectFile } from "../../shared/mdk";
import type { EditAction } from "../../shared/desktop";
import {
  keyboardComposing,
  headingLevels,
  shortcutHint,
  shortcutLabel,
  tableShortcuts,
  visualShortcuts,
  type ShortcutId,
  type ShortcutOverrides,
  type VisualShortcut,
} from "../../shared/shortcuts";
import { relativeReference, resolveReference } from "../../shared/references";
import { isResourcePath } from "../../shared/resources";
import {
  markdownInsertion,
  markdownSyntax,
} from "../../shared/markdown-editing";
import { requiresSourceMode } from "../../shared/markdown";
import { alignTableColumns, richDropDraft } from "../services/rich-markdown";
import { desktop } from "../services/desktop";
import {
  editorMediaTarget,
  viewMediaLabel,
  type EditorMediaTarget,
} from "../services/editor-media";
import { EditorDialog, EditorMenu, type EditorMenuItem } from "./EditorMenu";
import { MarkdownActions, type MarkdownAction } from "./MarkdownActions";
import { Select } from "./Select";
import type { Notify } from "../App";

type DialogKind =
  "link" | "image" | "resource" | "table" | "code" | "language" | "syntax";
const resourceChoicesLimit = 200;
type EditOrigin = {
  editor: Editor;
  path: string;
  selection: Selection;
  marks: readonly Mark[] | null;
};
interface ToolForm {
  kind: DialogKind;
  origin: EditOrigin;
  values: Record<string, string>;
  range?: { from: number; to: number };
}
export interface RichToolbarHandle {
  shortcut: (action: VisualShortcut) => void;
}
interface Props {
  editor: Editor | null;
  commandRef: Ref<RichToolbarHandle>;
  active: boolean;
  tableToolsHost: HTMLElement | null;
  packaged: boolean;
  shortcutOverrides?: ShortcutOverrides;
  disabled: boolean;
  sourceEditable: boolean;
  sourceText: string;
  sourcePath: string;
  files: ProjectFile[];
  notify: Notify;
  onImport: () => Promise<void>;
  onViewMedia: (target: EditorMediaTarget) => Promise<void>;
  onSourceInsert: (content: string) => Promise<void>;
}

const tableCommands = {
  "row-before": "addRowBefore",
  "row-after": "addRowAfter",
  "column-before": "addColumnBefore",
  "column-after": "addColumnAfter",
  "row-delete": "deleteRow",
  "column-delete": "deleteColumn",
  "table-delete": "deleteTable",
} as const;
const tableAlignments = {
  "align-left": "left",
  "align-center": "center",
  "align-right": "right",
  "align-default": null,
} as const;
const syntaxIds: Partial<Record<ShortcutId, string>> = {
  strike: "strike",
  inlineCode: "code",
  codeBlock: "fence",
  quote: "quote",
  orderedList: "ordered",
  bulletList: "bullet",
  taskList: "task",
};
const actionAliases: Partial<Record<ShortcutId, string>> = {
  image: "i",
  table: "t",
  "task-check": "x",
  "code-language": "l",
  clear: "c",
  resource: "a",
};
const additionalTerms: Partial<Record<ShortcutId, string[]>> = {
  "task-check": ["勾选", "check"],
  "code-language": ["代码语言", "language"],
  resource: ["附件", "attachment"],
  paragraph: ["正文", "paragraph"],
};

function ancestor(editor: Editor, type: string) {
  const { $head } = editor.state.selection;
  for (let depth = $head.depth; depth > 0; depth--) {
    const node = $head.node(depth);
    if (node.type.name === type) return { node, pos: $head.before(depth) };
  }
}

function activeLink(editor: Editor) {
  const { $from, to } = editor.state.selection;
  const range = getMarkRange($from, editor.schema.marks.link);
  return range && to <= range.to ? range : undefined;
}

function isolatedEdit(editor: Editor, run: () => boolean) {
  const before = editor.state.doc;
  editor.view.dispatch(closeHistory(editor.state.tr));
  const applied = run();
  if (!editor.state.doc.eq(before))
    editor.view.dispatch(closeHistory(editor.state.tr));
  return applied;
}

export function RichToolbar({
  editor,
  commandRef,
  active,
  tableToolsHost,
  packaged,
  shortcutOverrides,
  disabled,
  sourceEditable,
  sourceText,
  sourcePath,
  files,
  notify,
  onImport,
  onViewMedia,
  onSourceInsert,
}: Props) {
  const binding = (id: ShortcutId) => shortcutHint(id, shortcutOverrides);
  useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? [
            editor.state.selection.empty,
            ...[
              "bold",
              "italic",
              "strike",
              "code",
              "heading",
              "blockquote",
              "bulletList",
              "orderedList",
              "taskList",
              "image",
              "link",
              "table",
              "codeBlock",
            ].map((name) => editor.isActive(name)),
            JSON.stringify(editor.getAttributes("heading")),
            JSON.stringify(editor.getAttributes("codeBlock")),
            JSON.stringify(editor.getAttributes("image")),
            editor.can().undo(),
            editor.can().redo(),
          ].join(":")
        : "",
  });
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    media?: EditorMediaTarget;
    keyboard?: boolean;
  } | null>(null);
  const [form, setForm] = useState<ToolForm | null>(null);
  const [palette, setPalette] = useState<EditOrigin>();
  const composingForm = useRef(false);
  const [error, setError] = useState("");
  const resources = useMemo(
    () =>
      packaged
        ? files
            .filter(
              (file) => file.kind !== "directory" && isResourcePath(file.path),
            )
            .map((file) => file.path)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        : [],
    [files, packaged],
  );
  const closeMenu = useCallback(() => {
    setMenu(null);
    editor?.view.focus();
  }, [editor]);
  const dismiss = () => {
    setPalette(undefined);
    setForm(null);
    setError("");
    composingForm.current = false;
  };
  function capture(): EditOrigin | undefined {
    if (!editor?.isEditable || disabled || editor.view.composing) return;
    const { view, state } = editor;
    const native = view.hasFocus() ? view.dom.ownerDocument.getSelection() : null;
    if (
      state.selection instanceof TextSelection && native?.anchorNode && native.focusNode &&
      view.dom.contains(native.anchorNode) && view.dom.contains(native.focusNode)
    ) {
      const anchor = view.posAtDOM(native.anchorNode, native.anchorOffset);
      const head = view.posAtDOM(native.focusNode, native.focusOffset);
      if (
        anchor >= 0 && head >= 0 &&
        (anchor !== state.selection.anchor || head !== state.selection.head)
      ) {
        const selection = TextSelection.between(
          state.doc.resolve(anchor), state.doc.resolve(head),
        );
        view.dispatch(state.tr.setSelection(selection).setMeta("addToHistory", false));
      }
    }
    return {
      editor,
      path: sourcePath,
      selection: editor.state.selection,
      marks: editor.state.storedMarks,
    };
  }
  function valid(origin: EditOrigin) {
    return (
      editor === origin.editor &&
      origin.path === sourcePath &&
      !editor.isDestroyed &&
      editor.isEditable &&
      editor.view.dom.isConnected &&
      editor.state.doc === origin.selection.$from.doc
    );
  }
  function restore(origin: EditOrigin) {
    if (!valid(origin)) return false;
    const { state, view } = origin.editor;
    if (
      !state.selection.eq(origin.selection) ||
      state.storedMarks !== origin.marks
    )
      view.dispatch(
        state.tr
          .setSelection(origin.selection)
          .setStoredMarks(origin.marks)
          .setMeta("addToHistory", false),
      );
    return true;
  }
  function focusEditor(origin: EditOrigin) {
    requestAnimationFrame(() => {
      const target = origin.editor;
      if (
        !target.isDestroyed &&
        target.isEditable &&
        target.view.dom.isConnected &&
        !document.querySelector("dialog[open]")
      )
        target.view.focus();
    });
  }
  function cancel(origin?: EditOrigin | null) {
    if (origin && restore(origin)) focusEditor(origin);
    dismiss();
  }
  const pending = palette ?? form?.origin;
  useEffect(() => {
    if (!pending) return;
    if (!valid(pending)) {
      dismiss();
      return;
    }
    const invalidate = () => {
      if (!valid(pending)) dismiss();
    };
    pending.editor.on("transaction", invalidate);
    pending.editor.on("destroy", dismiss);
    return () => {
      pending.editor.off("transaction", invalidate);
      pending.editor.off("destroy", dismiss);
    };
  }, [pending, editor, sourcePath]);
  const safe = (work: () => unknown) => {
    try {
      void Promise.resolve(work()).catch((e) => notify(String(e), true));
    } catch (e) {
      notify(String(e), true);
    }
  };
  const native = (action: EditAction) => {
    if (!editor) return;
    editor.view.focus();
    return desktop().edit(action);
  };
  const table = !!editor?.isActive("table"),
    blockDisabled = disabled || table;
  const [tableToolsOverride, setTableToolsOverride] = useState<boolean>();
  useEffect(
    () => setTableToolsOverride(undefined),
    [editor, sourcePath, table],
  );
  const tableToolsVisible = active && (tableToolsOverride ?? table);
  const hasSelection = !!editor && !editor.state.selection.empty;
  const clearFormatting = () => {
    if (!editor) return false;
    const chain = editor.chain().focus().unsetAllMarks();
    return editor.isActive("table") ? chain.run() : chain.clearNodes().run();
  };
  const copyMarkdown = () => {
    if (!editor?.markdown) return;
    const content = editor.markdown.serialize({
      type: "doc",
      content: editor.state.selection.content().content.toJSON(),
    });
    return desktop().edit("copy-text", content);
  };
  function open(kind: DialogKind, origin = capture(), syntax?: string) {
    if (!editor || !origin || !restore(origin)) return;
    setPalette(undefined);
    setError("");
    if (kind === "link") {
      const range = activeLink(editor);
      const attrs = range
        ? (editor.state.doc
            .resolve(range.from)
            .nodeAfter?.marks.find((mark) => mark.type.name === "link")
            ?.attrs ?? {})
        : editor.getAttributes("link");
      setForm({
        kind,
        origin,
        range,
        values: {
          url: attrs.href ?? "",
          title: attrs.title ?? "",
          label: editor.state.doc.textBetween(
            range?.from ?? origin.selection.from,
            range?.to ?? origin.selection.to,
            " ",
          ),
        },
      });
    } else if (kind === "image") {
      const attrs = editor.getAttributes("image");
      setForm({
        kind,
        origin,
        values: {
          url: attrs.src ?? "",
          alt: attrs.alt ?? "",
          title: attrs.title ?? "",
        },
      });
    } else if (kind === "resource") {
      setForm({ kind, origin, values: { path: "", query: "", label: "" } });
    } else if (kind === "table")
      setForm({ kind, origin, values: { rows: "3", cols: "3" } });
    else if (kind === "code" || kind === "language") {
      const block = ancestor(editor, "codeBlock");
      setForm({
        kind,
        origin,
        values: {
          language: block?.node.attrs.language ?? "",
          code: block
            ? block.node.textContent
            : editor.state.doc.textBetween(
                editor.state.selection.from,
                editor.state.selection.to,
                "\n",
              ),
        },
        ...(block
          ? { range: { from: block.pos, to: block.pos + block.node.nodeSize } }
          : {}),
      });
    } else if (syntax) setForm({ kind, origin, values: { syntax } });
  }
  useEffect(() => {
    if (!editor) return;
    const context = (event: MouseEvent) => {
      event.preventDefault();
      const hit = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      const target = event.target as Element;
      const media = editorMediaTarget(target, sourcePath);
      if (media?.inlineImage) {
        const image = target.closest("img")!;
        const pos = editor.view.posAtDOM(image, 0);
        if (editor.view.nodeDOM(pos) === image)
          editor.commands.setNodeSelection(pos);
        else {
          editor.state.doc.descendants((node, position) => {
            if (
              node.type.name === "image" &&
              editor.view.nodeDOM(position) === image
            )
              editor.commands.setNodeSelection(position);
          });
        }
      } else if (media) {
        const anchor = target.closest("a")!;
        editor
          .chain()
          .setTextSelection(editor.view.posAtDOM(anchor, 0))
          .extendMarkRange("link")
          .run();
      } else if (
        hit &&
        (editor.state.selection instanceof NodeSelection ||
          editor.state.selection.empty ||
          hit.pos < editor.state.selection.from ||
          hit.pos > editor.state.selection.to)
      )
        editor.commands.setTextSelection(hit.pos);
      editor.view.focus();
      setMenu({ x: event.clientX, y: event.clientY, media });
    };
    const key = (event: KeyboardEvent) => {
      if (
        editor.view.composing ||
        keyboardComposing(event) ||
        (event.key !== "ContextMenu" &&
          !(event.shiftKey && event.key === "F10"))
      )
        return;
      event.preventDefault();
      const { selection } = editor.state;
      const selected =
        selection instanceof NodeSelection
          ? editor.view.nodeDOM(selection.from)
          : null;
      const focus = window.getSelection()?.focusNode;
      const target =
        selected instanceof Element
          ? selected
          : focus instanceof Element
            ? focus
            : focus?.parentElement;
      const media =
        target &&
        editor.view.dom.contains(target) &&
        (selection.empty || selection instanceof NodeSelection)
          ? editorMediaTarget(target, sourcePath)
          : undefined;
      const point = editor.view.coordsAtPos(selection.head);
      setMenu({ x: point.left, y: point.bottom, media, keyboard: true });
    };
    const node = editor.view.dom;
    node.addEventListener("contextmenu", context);
    node.addEventListener("keydown", key);
    return () => {
      node.removeEventListener("contextmenu", context);
      node.removeEventListener("keydown", key);
    };
  }, [editor, sourcePath]);
  function values(name: string, value: string) {
    setForm((current) =>
      current
        ? { ...current, values: { ...current.values, [name]: value } }
        : null,
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor || !form || disabled || composingForm.current) return;
    if (!restore(form.origin)) {
      dismiss();
      return;
    }
    try {
      const v = form.values;
      const inTable = editor.isActive("table");
      if (form.kind === "syntax") {
        if (!sourceEditable) return;
        const selected = editor.state.doc.textBetween(
          form.origin.selection.from,
          form.origin.selection.to,
          "\n",
        );
        const markdown = markdownInsertion(v.syntax, selected);
        const marker = "MDKSYNTAX" + crypto.randomUUID().replaceAll("-", "");
        const content =
          requiresSourceMode(sourceText) || inTable
            ? sourceText + "\n\n" + markdown
            : richDropDraft(editor, -1, -1, marker).content.replace(
                marker,
                () => markdown,
              );
        await onSourceInsert(content);
        dismiss();
        return;
      }
      let run: () => boolean;
      if (form.kind === "resource") {
        if (!resources.includes(v.path))
          throw new Error(t("请选择包内资源文件。"));
        const link = {
          type: "text",
          text: v.label.trim() || v.path.split("/").at(-1)!,
          marks: [
            {
              type: "link",
              attrs: { href: relativeReference(sourcePath, v.path) },
            },
          ],
        };
        run = () =>
          editor.commands.insertContent(
            inTable ? link : { type: "paragraph", content: [link] },
          );
      } else if (form.kind === "link" || form.kind === "image") {
        const url = v.url.trim();
        if (
          !url ||
          resolveReference(sourcePath, url, form.kind === "image").kind ===
            "unsafe"
        )
          throw new Error(
            t("请输入有效的 HTTP(S)、mailto、片段或工程内相对地址。"),
          );
        if (form.kind === "link") {
          const attrs = { href: url, title: v.title || null };
          const { from, to } = form.range ?? form.origin.selection;
          const selected = editor.state.doc.textBetween(from, to, " ");
          run = () => {
            const chain = editor.chain().setTextSelection({ from, to });
            if (from !== to && (!v.label || selected === v.label)) {
              chain.setLink(attrs).setTextSelection(to);
            } else {
              chain.insertContent({
                type: "text",
                text: v.label || url,
                marks: [{ type: "link", attrs }],
              });
            }
            return chain
              .command(({ tr }) => {
                tr.removeStoredMark(editor.schema.marks.link);
                return true;
              })
              .run();
          };
        } else {
          const attrs = { src: url, alt: v.alt, title: v.title };
          const image = { type: "image", attrs };
          run = () =>
            editor.isActive("image")
              ? editor.commands.updateAttributes("image", attrs)
              : editor.commands.insertContent(
                  inTable
                    ? image
                    : [
                        { type: "paragraph", content: [image] },
                        { type: "paragraph" },
                      ],
                );
        }
      } else if (form.kind === "table") {
        const rows = Number(v.rows),
          cols = Number(v.cols);
        if (
          !Number.isInteger(rows) ||
          !Number.isInteger(cols) ||
          rows < 1 ||
          rows > 100 ||
          cols < 1 ||
          cols > 20
        )
          throw new Error(t("表格行数须为 1–100，列数须为 1–20。"));
        run = () =>
          editor.commands.insertTable({ rows, cols, withHeaderRow: true });
      } else {
        if (/[\r\n`]/.test(v.language))
          throw new Error(t("代码语言不能包含换行或反引号。"));
        if (form.kind === "language") {
          const position = form.range!.from;
          run = () =>
            editor.commands.command(({ tr }) => {
              if (
                tr.doc.nodeAt(position)?.attrs.language !== (v.language || null)
              )
                tr.setNodeAttribute(position, "language", v.language || null);
              return true;
            });
        } else {
          const node = {
            type: "codeBlock",
            attrs: { language: v.language || null },
            ...(v.code ? { content: [{ type: "text", text: v.code }] } : {}),
          };
          const range = form.range;
          run = () =>
            range
              ? editor.commands.insertContentAt(range, node)
              : editor.commands.insertContent(node);
        }
      }
      isolatedEdit(editor, run);
      dismiss();
      focusEditor(form.origin);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    }
  }
  function hasLink() {
    if (!editor) return false;
    const { from, to } = editor.state.selection;
    return (
      !!activeLink(editor) ||
      editor.state.doc.rangeHasMark(from, to, editor.schema.marks.link)
    );
  }
  function canRun(action: VisualShortcut) {
    if (!editor?.isEditable || disabled) return false;
    const inTable = editor.isActive("table");
    if ("level" in action)
      return (
        !inTable &&
        (action.level
          ? editor.can().setHeading({ level: action.level })
          : editor.can().setParagraph())
      );
    if ("command" in action)
      return !("block" in action && inTable) && editor.can()[action.command]();
    switch (action.id) {
      case "link":
        return editor.state.selection.$from.parent.type.allowsMarkType(
          editor.schema.marks.link,
        );
      case "unlink":
        return hasLink();
      case "image":
        return !editor.isActive("codeBlock");
      case "table":
        return !inTable && !editor.isActive("codeBlock");
      case "resource":
        return !!resources.length && !editor.isActive("codeBlock");
      case "task-check":
        return !!ancestor(editor, "taskItem");
      case "code-language":
        return !!ancestor(editor, "codeBlock");
      case "clear":
      case "palette":
        return true;
      default:
        return (
          inTable &&
          (!(action.id in tableCommands) ||
            editor
              .can()
              [tableCommands[action.id as keyof typeof tableCommands]]())
        );
    }
  }

  function runVisual(action: VisualShortcut, origin = capture()) {
    if (!editor || !origin || !restore(origin) || !canRun(action)) return;
    if (action.id === "palette") {
      setPalette(origin);
      return;
    }
    if (action.id === "code-language") {
      open("language", origin);
      return;
    }
    if (
      action.id === "link" ||
      action.id === "image" ||
      action.id === "resource" ||
      action.id === "table"
    ) {
      open(action.id, origin);
      return;
    }
    setPalette(undefined);
    isolatedEdit(editor, () => {
      if ("level" in action)
        return action.level
          ? editor.commands.setHeading({ level: action.level })
          : editor.commands.setParagraph();
      if ("command" in action) return editor.commands[action.command]();
      switch (action.id) {
        case "clear":
          return clearFormatting();
        case "unlink": {
          const range = activeLink(editor);
          const { empty, from } = editor.state.selection;
          return range && empty
            ? editor
                .chain()
                .setTextSelection(range)
                .unsetLink()
                .setTextSelection(from)
                .run()
            : editor.commands.unsetLink();
        }
        case "task-check": {
          const task = ancestor(editor, "taskItem")!;
          return editor.commands.command(({ tr }) => {
            tr.setNodeAttribute(task.pos, "checked", !task.node.attrs.checked);
            return true;
          });
        }
        default:
          if (action.id in tableCommands)
            return editor.commands[
              tableCommands[action.id as keyof typeof tableCommands]
            ]();
          return alignTableColumns(
            editor,
            tableAlignments[action.id as keyof typeof tableAlignments],
          );
      }
    });
    focusEditor(origin);
  }
  useImperativeHandle(commandRef, () => ({ shortcut: runVisual }));
  const visualAction = (id: VisualShortcut["id"]) =>
    visualShortcuts.find((action) => action.id === id)!;
  const tableActions = tableShortcuts
    .filter((action) => action.id in tableCommands)
    .map((action) => ({
      id: action.id,
      label: action.label,
      shortcut: binding(action.id),
      disabled: !canRun(action),
      run: () => runVisual(action),
    }));
  const paletteActions: MarkdownAction[] = palette
    ? [
        ...visualShortcuts
          .filter(({ id }) => id !== "palette")
          .map((action) => {
            const syntax = markdownSyntax.find(
              (item) => item.id === (syntaxIds[action.id] ?? action.id),
            );
            const terms =
              "labelKey" in action
                ? translations(action.labelKey)
                : (syntax?.search ?? []);
            const examples: Partial<Record<ShortcutId, string>> = {
              paragraph: t("文字"),
              unlink: t("链接文字"),
              resource: "[file](../resources/file)",
              "task-check": "- [x] " + t("文字"),
              "code-language": "```python",
              clear: t("文字"),
            };
            const tableExample =
              action.id in tableAlignments
                ? {
                    "align-left": "| :--- |",
                    "align-center": "| :---: |",
                    "align-right": "| ---: |",
                    "align-default": "| --- |",
                  }[action.id as keyof typeof tableAlignments]
                : "| A | B |";
            return {
              id: action.id,
              label: action.label,
              example: syntax?.example ?? examples[action.id] ?? tableExample,
              terms: [
                ...terms,
                action.id,
                ...(additionalTerms[action.id] ?? []),
                ...(action.id in tableAlignments ? ["对齐", "align"] : []),
              ],
              alias: actionAliases[action.id],
              shortcut: binding(action.id),
              disabled: !canRun(action),
              run: () => runVisual(action, palette),
            };
          }),
        ...markdownSyntax
          .filter((syntax) =>
            [
              "break",
              "autolink",
              "reference",
              "reference-image",
              "setext",
              "indented-code",
              "escape",
              "math-inline",
              "math-block",
            ].includes(syntax.id),
          )
          .map((syntax) => ({
            id: syntax.id,
            label: syntax.label,
            example: syntax.example,
            terms: syntax.search,
            disabled: syntax.id === "break" ? blockDisabled : !sourceEditable,
            run: () => {
              if (syntax.id !== "break") {
                open("syntax", palette, syntax.id);
                return;
              }
              if (!editor || !restore(palette) || blockDisabled) return;
              setPalette(undefined);
              isolatedEdit(editor, () => editor.commands.setHardBreak());
              focusEditor(palette);
            },
          })),
      ]
    : [];
  const menuItems: EditorMenuItem[] = editor
    ? [
        {
          id: "undo",
          label: t("撤销"),
          shortcut: shortcutLabel("Ctrl+Z"),
          disabled: disabled || !editor.can().undo(),
          run: () => editor.chain().focus().undo().run(),
        },
        {
          id: "redo",
          label: t("重做"),
          shortcut: shortcutLabel("Ctrl+Y"),
          disabled: disabled || !editor.can().redo(),
          run: () => editor.chain().focus().redo().run(),
        },
        {
          id: "cut",
          label: t("剪切"),
          shortcut: shortcutLabel("Ctrl+X"),
          separator: true,
          disabled: disabled || !hasSelection,
          run: () => safe(() => native("cut")),
        },
        {
          id: "copy",
          label: t("复制"),
          shortcut: shortcutLabel("Ctrl+C"),
          disabled: !hasSelection,
          run: () => safe(() => native("copy")),
        },
        {
          id: "copy-markdown",
          label: t("复制为 Markdown"),
          disabled: !hasSelection,
          run: () => safe(copyMarkdown),
        },
        {
          id: "paste",
          label: t("粘贴"),
          shortcut: shortcutLabel("Ctrl+V"),
          disabled,
          run: () => safe(() => native("paste")),
        },
        {
          id: "paste-text",
          label: t("粘贴纯文本"),
          shortcut: shortcutLabel("Ctrl+Shift+V"),
          disabled,
          run: () => safe(() => native("paste-text")),
        },
        {
          id: "select-all",
          label: t("全选"),
          shortcut: shortcutLabel("Ctrl+A"),
          run: () => editor.chain().focus().selectAll().run(),
        },
        {
          id: "link",
          label: editor.isActive("link") ? t("编辑链接") : t("插入链接"),
          separator: true,
          disabled: !canRun(visualAction("link")),
          shortcut: binding("link"),
          run: () => runVisual(visualAction("link")),
        },
        ...(hasLink()
          ? [
              {
                id: "unlink",
                label: t("移除链接"),
                disabled,
                shortcut: binding("unlink"),
                run: () => runVisual(visualAction("unlink")),
              },
            ]
          : []),
        {
          id: "image",
          label: editor.isActive("image") ? t("编辑图片") : t("插入图片"),
          disabled: !canRun(visualAction("image")),
          shortcut: binding("image"),
          run: () => runVisual(visualAction("image")),
        },
        {
          id: "import",
          label: t("导入本地资源"),
          disabled,
          run: () => safe(onImport),
        },
        ...(table
          ? tableActions.map((a, i) => ({ ...a, separator: i === 0 }))
          : [
              {
                id: "table",
                label: t("插入表格"),
                disabled: !canRun(visualAction("table")),
                shortcut: binding("table"),
                run: () => runVisual(visualAction("table")),
              },
            ]),
        {
          id: "clear",
          label: t("清除格式"),
          separator: true,
          disabled,
          shortcut: binding("clear"),
          run: () => runVisual(visualAction("clear")),
        },
      ]
    : [];
  function mediaMenuItems(media: EditorMediaTarget): EditorMenuItem[] {
    const image = !!media.inlineImage;
    return [
      {
        id: "view-media",
        label: viewMediaLabel(media.kind),
        run: () => safe(() => onViewMedia(media)),
      },
      {
        id: "edit-media",
        label: image ? t("编辑图片") : t("编辑链接"),
        disabled,
        run: () => open(image ? "image" : "link"),
      },
      {
        id: "copy-reference",
        label: image ? t("复制图片地址") : t("复制链接地址"),
        separator: true,
        run: () => safe(() => desktop().edit("copy-text", media.reference)),
      },
      {
        id: "copy-markdown",
        label: t("复制为 Markdown"),
        disabled: !hasSelection,
        run: () => safe(copyMarkdown),
      },
      {
        id: "remove-media",
        label: image ? t("移除图片") : t("移除链接"),
        separator: true,
        disabled,
        run: () => {
          const chain = editor?.chain().focus();
          if (image && editor?.state.selection instanceof NodeSelection)
            chain?.deleteSelection().run();
          if (!image) runVisual(visualAction("unlink"));
        },
      },
    ];
  }
  const tool = (
    label: string,
    Icon: typeof Bold,
    run: () => unknown,
    active = false,
    unavailable = disabled,
    shortcut?: string,
  ) => (
    <button
      key={label}
      type="button"
      className={"icon-button " + (active ? "selected" : "")}
      aria-label={label}
      aria-pressed={active}
      title={label + (shortcut ? " (" + shortcut + ")" : "")}
      disabled={!editor || unavailable}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => safe(run)}
    >
      <Icon size={17} strokeWidth={1.8} />
    </button>
  );
  const selectedSyntax = markdownSyntax.find(
    (s) => s.id === form?.values.syntax,
  );
  const paragraphLevel = editor?.isActive("heading")
    ? (editor.getAttributes("heading").level as (typeof headingLevels)[number])
    : 0;
  const paragraphShortcut = binding(
    paragraphLevel ? `heading${paragraphLevel}` : "paragraph",
  );
  const resourceMatches =
    form?.kind === "resource"
      ? resources.filter((path) =>
          path.toLowerCase().includes(form.values.query.trim().toLowerCase()),
        )
      : [];
  const resourceChoices = resourceMatches.slice(0, resourceChoicesLimit);
  const chosenResource =
    form?.kind === "resource" && resources.includes(form.values.path)
      ? form.values.path
      : "";
  if (chosenResource && !resourceChoices.includes(chosenResource))
    resourceChoices.unshift(chosenResource);
  return (
    <div className="rich-toolbar-container">
      <div
        className="format-toolbar markdown-ribbon"
        role="toolbar"
        aria-label={t("正文格式")}
      >
        {editor && (
          <>
            <section className="ribbon-group" aria-label={t("编辑工具")}>
              <div>
                {tool(
                  t("撤销"),
                  Undo2,
                  () => editor.chain().focus().undo().run(),
                  false,
                  disabled || !editor.can().undo(),
                  shortcutLabel("Ctrl+Z"),
                )}
                {tool(
                  t("重做"),
                  Redo2,
                  () => editor.chain().focus().redo().run(),
                  false,
                  disabled || !editor.can().redo(),
                  shortcutLabel("Ctrl+Y"),
                )}
                {tool(
                  t("剪切"),
                  Scissors,
                  () => native("cut"),
                  false,
                  disabled || !hasSelection,
                  shortcutLabel("Ctrl+X"),
                )}
                {tool(
                  t("复制"),
                  Copy,
                  () => native("copy"),
                  false,
                  !hasSelection,
                  shortcutLabel("Ctrl+C"),
                )}
                {tool(
                  t("粘贴"),
                  Clipboard,
                  () => native("paste"),
                  false,
                  disabled,
                  shortcutLabel("Ctrl+V"),
                )}
              </div>
              <small>{t("编辑")}</small>
            </section>
            <section className="ribbon-group" aria-label={t("文本工具")}>
              <div>
                <Select
                  aria-label={t("段落样式")}
                  title={
                    paragraphShortcut
                      ? `${t("段落样式")} (${paragraphShortcut})`
                      : t("段落样式")
                  }
                  disabled={blockDisabled}
                  value={String(paragraphLevel)}
                  onCloseFocus={() => editor.commands.focus()}
                  onValueChange={(value) =>
                    runVisual(
                      visualAction(
                        value === "0"
                          ? "paragraph"
                          : `heading${Number(value) as (typeof headingLevels)[number]}`,
                      ),
                    )
                  }
                >
                  <option value="0">{t("正文")}</option>
                  {headingLevels.map((level) => (
                    <option key={level} value={level}>
                      {t("标题")} {level}
                    </option>
                  ))}
                </Select>
                {tool(
                  t("加粗"),
                  Bold,
                  () => runVisual(visualAction("bold")),
                  editor.isActive("bold"),
                  !canRun(visualAction("bold")),
                  binding("bold"),
                )}
                {tool(
                  t("斜体"),
                  Italic,
                  () => runVisual(visualAction("italic")),
                  editor.isActive("italic"),
                  !canRun(visualAction("italic")),
                  binding("italic"),
                )}
                {tool(
                  t("删除线"),
                  Strikethrough,
                  () => runVisual(visualAction("strike")),
                  editor.isActive("strike"),
                  !canRun(visualAction("strike")),
                  binding("strike"),
                )}
                {tool(
                  t("行内代码"),
                  Code2,
                  () => runVisual(visualAction("inlineCode")),
                  editor.isActive("code"),
                  !canRun(visualAction("inlineCode")),
                  binding("inlineCode"),
                )}
                {tool(
                  t("清除格式"),
                  RemoveFormatting,
                  () => runVisual(visualAction("clear")),
                  false,
                  disabled,
                  binding("clear"),
                )}
              </div>
              <small>{t("文本")}</small>
            </section>
            <section className="ribbon-group" aria-label={t("段落工具")}>
              <div>
                {tool(
                  t("无序列表"),
                  List,
                  () => runVisual(visualAction("bulletList")),
                  editor.isActive("bulletList"),
                  !canRun(visualAction("bulletList")),
                  binding("bulletList"),
                )}
                {tool(
                  t("有序列表"),
                  ListOrdered,
                  () => runVisual(visualAction("orderedList")),
                  editor.isActive("orderedList"),
                  !canRun(visualAction("orderedList")),
                  binding("orderedList"),
                )}
                {tool(
                  t("任务列表"),
                  ListTodo,
                  () => runVisual(visualAction("taskList")),
                  editor.isActive("taskList"),
                  !canRun(visualAction("taskList")),
                  binding("taskList"),
                )}
                {tool(
                  t("引用"),
                  Quote,
                  () => runVisual(visualAction("quote")),
                  editor.isActive("blockquote"),
                  !canRun(visualAction("quote")),
                  binding("quote"),
                )}
                {tool(
                  t("增加列表层级"),
                  IndentIncrease,
                  () =>
                    editor
                      .chain()
                      .focus()
                      .sinkListItem(
                        editor.isActive("taskItem") ? "taskItem" : "listItem",
                      )
                      .run(),
                  false,
                  blockDisabled ||
                    !editor
                      .can()
                      .sinkListItem(
                        editor.isActive("taskItem") ? "taskItem" : "listItem",
                      ),
                )}
                {tool(
                  t("减少列表层级"),
                  IndentDecrease,
                  () =>
                    editor
                      .chain()
                      .focus()
                      .liftListItem(
                        editor.isActive("taskItem") ? "taskItem" : "listItem",
                      )
                      .run(),
                  false,
                  blockDisabled ||
                    !editor
                      .can()
                      .liftListItem(
                        editor.isActive("taskItem") ? "taskItem" : "listItem",
                      ),
                )}
              </div>
              <small>{t("段落")}</small>
            </section>
            <section className="ribbon-group" aria-label={t("插入工具")}>
              <div>
                {tool(
                  t("插入链接"),
                  Link,
                  () => runVisual(visualAction("link")),
                  editor.isActive("link"),
                  !canRun(visualAction("link")),
                  binding("link"),
                )}
                {tool(
                  t("移除链接"),
                  Unlink,
                  () => runVisual(visualAction("unlink")),
                  false,
                  !canRun(visualAction("unlink")),
                  binding("unlink"),
                )}
                {tool(
                  t("插入图片"),
                  Image,
                  () => runVisual(visualAction("image")),
                  editor.isActive("image"),
                  !canRun(visualAction("image")),
                  binding("image"),
                )}
                {tool(t("导入本地资源"), FileUp, onImport)}
                {packaged &&
                  tool(
                    t("插入包内资源"),
                    Paperclip,
                    () => runVisual(visualAction("resource")),
                    false,
                    !canRun(visualAction("resource")),
                    binding("resource"),
                  )}
                {tool(
                  t("插入表格"),
                  Table2,
                  () => runVisual(visualAction("table")),
                  table,
                  !canRun(visualAction("table")),
                  binding("table"),
                )}
                {tool(
                  t("表格工具"),
                  PanelBottom,
                  () => setTableToolsOverride(!tableToolsVisible),
                  tableToolsVisible,
                  false,
                )}
                {tool(
                  t("代码块"),
                  SquareCode,
                  () => open("code"),
                  editor.isActive("codeBlock"),
                  !canRun(visualAction("codeBlock")),
                  binding("codeBlock"),
                )}
                {tool(
                  t("分隔线"),
                  Minus,
                  () => runVisual(visualAction("rule")),
                  false,
                  !canRun(visualAction("rule")),
                  binding("rule"),
                )}
                {tool(
                  t("硬换行"),
                  WrapText,
                  () => editor.chain().focus().setHardBreak().run(),
                  false,
                  blockDisabled,
                )}
                {tool(
                  t("Markdown 操作"),
                  BookOpen,
                  () => runVisual(visualAction("palette")),
                  false,
                  disabled,
                  binding("palette"),
                )}
              </div>
              <small>{t("插入")}</small>
            </section>
          </>
        )}
      </div>
      {tableToolsVisible &&
        tableToolsHost &&
        createPortal(
          <div
            className="table-ribbon"
            role="toolbar"
            aria-label={t("表格工具")}
          >
            {tableActions.map((action) => (
              <button
                type="button"
                className="button small"
                key={action.id}
                disabled={action.disabled}
                title={action.shortcut}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => safe(action.run)}
              >
                {action.label}
              </button>
            ))}
            <Select
              aria-label={t("表格列对齐")}
              disabled={disabled || !table}
              value=""
              onCloseFocus={() => editor!.commands.focus()}
              onValueChange={(value) => {
                runVisual(
                  visualAction(
                    `align-${value as "left" | "center" | "right" | "default"}`,
                  ),
                );
              }}
            >
              <option value="" disabled>
                {t("列对齐")}
              </option>
              <option value="left">{t("左对齐")}</option>
              <option value="center">{t("居中")}</option>
              <option value="right">{t("右对齐")}</option>
              <option value="default">{t("默认对齐")}</option>
            </Select>
          </div>,
          tableToolsHost,
        )}
      {menu && (
        <EditorMenu
          x={menu.x}
          y={menu.y}
          items={menu.media ? mediaMenuItems(menu.media) : menuItems}
          onClose={closeMenu}
          focusFirst={menu.keyboard}
        />
      )}
      {palette && (
        <MarkdownActions
          actions={paletteActions}
          onClose={() => cancel(palette)}
        />
      )}
      {form && (
        <EditorDialog
          title={
            form.kind === "link"
              ? t("链接")
              : form.kind === "resource"
                ? t("插入包内资源")
                : form.kind === "image"
                  ? t("图片")
                  : form.kind === "table"
                    ? t("插入表格")
                    : form.kind === "code"
                      ? t("代码块")
                      : form.kind === "language"
                        ? t("设置代码块语言")
                        : t("Markdown 语法")
          }
          onClose={() => {
            if (!composingForm.current) cancel(form.origin);
          }}
          initialFocus={
            form.kind === "syntax" ? 'button[type="submit"]' : "form input"
          }
        >
          <form
            onSubmit={(event) => void submit(event)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !composingForm.current &&
                  !keyboardComposing(event.nativeEvent) &&
                  event.target instanceof HTMLInputElement && event.target.type === "search") {
                event.preventDefault();
                cancel(form.origin);
              }
            }}
            onCompositionStart={() => {
              composingForm.current = true;
            }}
            onCompositionEnd={() => {
              composingForm.current = false;
            }}
          >
            {form.kind === "syntax" ? (
              <>
                <p>{selectedSyntax?.label}</p>
                <pre className="syntax-example">{selectedSyntax?.example}</pre>
                <p className="field-hint">
                  {t("插入后切换到源码编辑，以保留此语法的完整写法。")}
                </p>
              </>
            ) : form.kind === "resource" ? (
              <>
                <label>
                  {t("搜索包内资源")}
                  <input
                    autoFocus
                    type="search"
                    aria-label={t("搜索包内资源")}
                    value={form.values.query}
                    onChange={(event) => values("query", event.target.value)}
                  />
                </label>
                <label>
                  {t("包内资源")}
                  <Select
                    aria-label={t("包内资源")}
                    value={chosenResource}
                    onValueChange={(value) => values("path", value)}
                  >
                    <option value="">{t("选择包内资源文件…")}</option>
                    {resourceChoices.map((path) => (
                      <option key={path} value={path}>
                        {path}
                      </option>
                    ))}
                  </Select>
                </label>
                {!resourceMatches.length && (
                  <p className="field-hint">{t("没有匹配的包内资源。")}</p>
                )}
                {resourceMatches.length > resourceChoicesLimit && (
                  <p className="field-hint">
                    {t(
                      "显示前 {0} 项，可按文件名或路径搜索。",
                      resourceChoicesLimit,
                    )}
                  </p>
                )}
                <label>
                  {t("链接文字")}
                  <input
                    aria-label={t("链接文字")}
                    value={form.values.label}
                    placeholder={chosenResource.split("/").at(-1)}
                    onChange={(event) => values("label", event.target.value)}
                  />
                </label>
              </>
            ) : form.kind === "table" ? (
              <div className="editor-dialog-grid">
                {[
                  ["rows", t("行数")],
                  ["cols", t("列数")],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      aria-label={label}
                      autoFocus={key === "rows"}
                      type="number"
                      min={1}
                      max={key === "rows" ? 100 : 20}
                      value={form.values[key]}
                      onChange={(e) => values(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            ) : form.kind === "code" || form.kind === "language" ? (
              <>
                <label>
                  {t("代码语言")}
                  <input
                    autoFocus
                    aria-label={t("代码语言")}
                    value={form.values.language}
                    placeholder="text、javascript、python…"
                    onChange={(e) => values("language", e.target.value)}
                  />
                </label>
                {form.kind === "code" && (
                  <label>
                    {t("代码")}
                    <textarea
                      aria-label={t("代码内容")}
                      rows={9}
                      value={form.values.code}
                      onChange={(e) => values("code", e.target.value)}
                    />
                  </label>
                )}
              </>
            ) : (
              <>
                <label>
                  {form.kind === "image" ? t("图片地址") : t("链接地址")}
                  <input
                    autoFocus
                    aria-label={
                      form.kind === "image" ? t("图片地址") : t("链接地址")
                    }
                    value={form.values.url}
                    onChange={(e) => values("url", e.target.value)}
                    placeholder={t("https://… 或工程内相对路径")}
                  />
                </label>
                {form.kind === "image" && packaged && (
                  <label>
                    {t("工程图片")}
                    <Select
                      aria-label={t("工程图片")}
                      value=""
                      onValueChange={(value) => {
                        values("url", relativeReference(sourcePath, value));
                      }}
                    >
                      <option value="">{t("选择已导入的图片…")}</option>
                      {files
                        .filter(
                          (file) =>
                            file.path.startsWith("resources/image/") &&
                            file.kind !== "directory",
                        )
                        .map((file) => (
                          <option key={file.path} value={file.path}>
                            {file.path}
                          </option>
                        ))}
                    </Select>
                  </label>
                )}
                <label>
                  {form.kind === "image" ? t("图片说明") : t("链接文字")}
                  <input
                    aria-label={
                      form.kind === "image" ? t("图片说明") : t("链接文字")
                    }
                    value={form.values[form.kind === "image" ? "alt" : "label"]}
                    onChange={(e) =>
                      values(
                        form.kind === "image" ? "alt" : "label",
                        e.target.value,
                      )
                    }
                  />
                </label>
                <label>
                  {t("标题（可选）")}
                  <input
                    aria-label={t("链接或图片标题")}
                    value={form.values.title}
                    onChange={(e) => values("title", e.target.value)}
                  />
                </label>
                {form.kind === "image" && (
                  <p className="field-hint">
                    {t(
                      "本地图片可导入工程；外部图片仅保留引用，不自动联网加载。",
                    )}
                  </p>
                )}
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              {form.kind === "image" && (
                <button
                  type="button"
                  className="button"
                  disabled={!sourceEditable}
                  onClick={() => {
                    if (!restore(form.origin)) return;
                    dismiss();
                    requestAnimationFrame(() => safe(onImport));
                  }}
                >
                  {t("从文件导入")}
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={() => cancel(form.origin)}
              >
                {t("取消")}
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={
                  form.kind === "syntax"
                    ? !sourceEditable
                    : disabled || (form.kind === "resource" && !chosenResource)
                }
              >
                {form.kind === "syntax"
                  ? t("插入并编辑源码")
                  : form.kind === "resource"
                    ? t("插入")
                    : t("确定")}
              </button>
            </div>
          </form>
        </EditorDialog>
      )}
    </div>
  );
}
