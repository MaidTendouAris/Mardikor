import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
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
  Minus,
  WrapText,
  IndentIncrease,
  IndentDecrease,
  RemoveFormatting,
  Unlink,
  FileUp,
  BookOpen,
  Copy,
  Clipboard,
  Scissors,
} from "lucide-react";
import type { ProjectFile } from "../../shared/mdk";
import type { EditAction } from "../../shared/desktop";
import { resolveReference } from "../../shared/references";
import {
  markdownInsertion,
  markdownSyntax,
} from "../../shared/markdown-editing";
import { requiresSourceMode } from "../../shared/markdown";
import { alignTableColumns, richDropDraft } from "../services/rich-markdown";
import { desktop } from "../services/desktop";
import { EditorDialog, EditorMenu, type EditorMenuItem } from "./EditorMenu";
import { Select } from "./Select";
import type { Notify } from "../App";

type DialogKind = "link" | "image" | "table" | "code" | "syntax";
interface ToolForm {
  kind: DialogKind;
  values: Record<string, string>;
  range?: { from: number; to: number };
}
interface Props {
  editor: Editor | null;
  disabled: boolean;
  sourceEditable: boolean;
  sourceText: string;
  sourcePath: string;
  files: ProjectFile[];
  notify: Notify;
  onImport: () => Promise<void>;
  onSourceInsert: (content: string) => Promise<void>;
}
function relativeResource(from: string, to: string) {
  const base = from.split("/").slice(0, -1),
    parts = to.split("/");
  while (base.length && parts.length && base[0] === parts[0]) {
    base.shift();
    parts.shift();
  }
  return "../".repeat(base.length) + parts.map(encodeURIComponent).join("/");
}
export function RichToolbar({
  editor,
  disabled,
  sourceEditable,
  sourceText,
  sourcePath,
  files,
  notify,
  onImport,
  onSourceInsert,
}: Props) {
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [form, setForm] = useState<ToolForm | null>(null);
  const [error, setError] = useState("");
  const closeMenu = useCallback(() => {
    setMenu(null);
    editor?.view.focus();
  }, [editor]);
  const closeForm = () => {
    setForm(null);
    setError("");
    editor?.view.focus();
  };
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
  const hasSelection = !!editor && !editor.state.selection.empty;
  const clearFormatting = () => {
    if (!editor) return;
    const chain = editor.chain().focus().unsetAllMarks();
    return table ? chain.run() : chain.clearNodes().run();
  };
  const copyMarkdown = () => {
    if (!editor?.markdown) return;
    const content = editor.markdown.serialize({
      type: "doc",
      content: editor.state.selection.content().content.toJSON(),
    });
    return desktop().edit("copy-text", content);
  };
  function open(kind: DialogKind) {
    if (!editor) return;
    setError("");
    if (kind === "link") {
      if (editor.isActive("link"))
        editor.chain().focus().extendMarkRange("link").run();
      const attrs = editor.getAttributes("link");
      setForm({
        kind,
        values: {
          url: attrs.href ?? "",
          title: attrs.title ?? "",
          label: editor.state.doc.textBetween(
            editor.state.selection.from,
            editor.state.selection.to,
            " ",
          ),
        },
      });
    } else if (kind === "image") {
      const attrs = editor.getAttributes("image");
      setForm({
        kind,
        values: {
          url: attrs.src ?? "",
          alt: attrs.alt ?? "",
          title: attrs.title ?? "",
        },
      });
    } else if (kind === "table")
      setForm({ kind, values: { rows: "3", cols: "3" } });
    else if (kind === "code") {
      const { $from } = editor.state.selection;
      let depth = $from.depth;
      while (depth > 0 && $from.node(depth).type.name !== "codeBlock") depth--;
      setForm({
        kind,
        values: {
          language: depth ? ($from.node(depth).attrs.language ?? "") : "",
          code: depth
            ? $from.node(depth).textContent
            : editor.state.doc.textBetween(
                editor.state.selection.from,
                editor.state.selection.to,
                "\n",
              ),
        },
        ...(depth
          ? { range: { from: $from.before(depth), to: $from.after(depth) } }
          : {}),
      });
    } else setForm({ kind, values: { syntax: "heading1" } });
  }
  useEffect(() => {
    if (!editor) return;
    const context = (event: MouseEvent) => {
      event.preventDefault();
      const hit = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      const image = (event.target as HTMLElement).closest("img");
      if (image)
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "image" && editor.view.nodeDOM(pos) === image)
            editor.commands.setNodeSelection(pos);
        });
      else if (
        hit &&
        (editor.state.selection.empty ||
          hit.pos < editor.state.selection.from ||
          hit.pos > editor.state.selection.to)
      )
        editor.commands.setTextSelection(hit.pos);
      editor.view.focus();
      setMenu({ x: event.clientX, y: event.clientY });
    };
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        editor.isEditable
      ) {
        event.preventDefault();
        event.stopPropagation();
        open("link");
        return;
      }
      if (
        event.key !== "ContextMenu" &&
        !(event.shiftKey && event.key === "F10")
      )
        return;
      event.preventDefault();
      const point = editor.view.coordsAtPos(editor.state.selection.head);
      setMenu({ x: point.left, y: point.bottom });
    };
    const node = editor.view.dom;
    node.addEventListener("contextmenu", context);
    node.addEventListener("keydown", key);
    return () => {
      node.removeEventListener("contextmenu", context);
      node.removeEventListener("keydown", key);
    };
  }, [editor]);
  function values(name: string, value: string) {
    setForm((current) =>
      current
        ? { ...current, values: { ...current.values, [name]: value } }
        : null,
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor || !form) return;
    try {
      const v = form.values;
      if (form.kind === "syntax") {
        const syntax = markdownSyntax.find((s) => s.id === v.syntax)!;
        const selected = editor.state.doc.textBetween(
          editor.state.selection.from,
          editor.state.selection.to,
          "\n",
        );
        const markdown = markdownInsertion(syntax.id, selected);
        if (syntax.sourceOnly || requiresSourceMode(sourceText)) {
          const marker = "MDKSYNTAX" + crypto.randomUUID().replaceAll("-", "");
          const content =
            requiresSourceMode(sourceText) || table
              ? sourceText + "\n\n" + markdown
              : richDropDraft(editor, -1, -1, marker).content.replace(
                  marker,
                  () => markdown,
                );
          await onSourceInsert(content);
          setForm(null);
          return;
        } else
          editor
            .chain()
            .focus()
            .insertContent(markdown, { contentType: "markdown" })
            .run();
      } else if (form.kind === "link" || form.kind === "image") {
        const url = v.url.trim();
        if (
          !url ||
          resolveReference(sourcePath, url, form.kind === "image").kind ===
            "unsafe"
        )
          throw new Error(
            "请输入有效的 HTTP(S)、mailto、片段或工程内相对地址。",
          );
        if (form.kind === "link") {
          const attrs = { href: url, title: v.title || null };
          const selected = editor.state.doc.textBetween(
            editor.state.selection.from,
            editor.state.selection.to,
            " ",
          );
          if (hasSelection && (!v.label || selected === v.label))
            editor.chain().focus().setLink(attrs).run();
          else
            editor
              .chain()
              .focus()
              .insertContent({
                type: "text",
                text: v.label || url,
                marks: [{ type: "link", attrs }],
              })
              .run();
        } else {
          const attrs = { src: url, alt: v.alt, title: v.title };
          if (editor.isActive("image"))
            editor.chain().focus().updateAttributes("image", attrs).run();
          else
            editor
              .chain()
              .focus()
              .insertContent([
                { type: "paragraph", content: [{ type: "image", attrs }] },
                { type: "paragraph" },
              ])
              .run();
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
          throw new Error("表格行数须为 1–100，列数须为 1–20。");
        editor
          .chain()
          .focus()
          .insertTable({ rows, cols, withHeaderRow: true })
          .run();
      } else {
        if (/[\r\n`]/.test(v.language))
          throw new Error("代码语言不能包含换行或反引号。");
        const node = {
          type: "codeBlock",
          attrs: { language: v.language || null },
          ...(v.code ? { content: [{ type: "text", text: v.code }] } : {}),
        };
        const chain = editor.chain().focus();
        if (form.range) chain.insertContentAt(form.range, node).run();
        else chain.insertContent(node).run();
      }
      closeForm();
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    }
  }
  const tableActions = editor
    ? [
        {
          id: "row-before",
          label: "上方插入行",
          run: () => editor.chain().focus().addRowBefore().run(),
        },
        {
          id: "row-after",
          label: "下方插入行",
          run: () => editor.chain().focus().addRowAfter().run(),
        },
        {
          id: "column-before",
          label: "左侧插入列",
          run: () => editor.chain().focus().addColumnBefore().run(),
        },
        {
          id: "column-after",
          label: "右侧插入列",
          run: () => editor.chain().focus().addColumnAfter().run(),
        },
        {
          id: "row-delete",
          label: "删除当前行",
          run: () => editor.chain().focus().deleteRow().run(),
        },
        {
          id: "column-delete",
          label: "删除当前列",
          run: () => editor.chain().focus().deleteColumn().run(),
        },
        {
          id: "table-delete",
          label: "删除表格",
          run: () => editor.chain().focus().deleteTable().run(),
        },
      ]
    : [];
  const menuItems: EditorMenuItem[] = editor
    ? [
        {
          id: "undo",
          label: "撤销",
          shortcut: "Ctrl+Z",
          disabled: disabled || !editor.can().undo(),
          run: () => editor.chain().focus().undo().run(),
        },
        {
          id: "redo",
          label: "重做",
          shortcut: "Ctrl+Y",
          disabled: disabled || !editor.can().redo(),
          run: () => editor.chain().focus().redo().run(),
        },
        {
          id: "cut",
          label: "剪切",
          shortcut: "Ctrl+X",
          separator: true,
          disabled: disabled || !hasSelection,
          run: () => safe(() => native("cut")),
        },
        {
          id: "copy",
          label: "复制",
          shortcut: "Ctrl+C",
          disabled: !hasSelection,
          run: () => safe(() => native("copy")),
        },
        {
          id: "copy-markdown",
          label: "复制为 Markdown",
          disabled: !hasSelection,
          run: () => safe(copyMarkdown),
        },
        {
          id: "paste",
          label: "粘贴",
          shortcut: "Ctrl+V",
          disabled,
          run: () => safe(() => native("paste")),
        },
        {
          id: "paste-text",
          label: "粘贴纯文本",
          shortcut: "Ctrl+Shift+V",
          disabled,
          run: () => safe(() => native("paste-text")),
        },
        {
          id: "select-all",
          label: "全选",
          shortcut: "Ctrl+A",
          run: () => editor.chain().focus().selectAll().run(),
        },
        {
          id: "link",
          label: editor.isActive("link") ? "编辑链接" : "插入链接",
          separator: true,
          disabled,
          run: () => open("link"),
        },
        ...(editor.isActive("link")
          ? [
              {
                id: "unlink",
                label: "移除链接",
                disabled,
                run: () =>
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .unsetLink()
                    .run(),
              },
            ]
          : []),
        {
          id: "image",
          label: editor.isActive("image") ? "编辑图片" : "插入图片",
          disabled,
          run: () => open("image"),
        },
        {
          id: "import",
          label: "导入本地资源",
          disabled,
          run: () => safe(onImport),
        },
        ...(table
          ? tableActions.map((a, i) => ({ ...a, disabled, separator: i === 0 }))
          : [
              {
                id: "table",
                label: "插入表格",
                disabled: blockDisabled,
                run: () => open("table"),
              },
            ]),
        {
          id: "clear",
          label: "清除格式",
          separator: true,
          disabled,
          run: () => clearFormatting(),
        },
      ]
    : [];
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
  return (
    <div className="rich-toolbar-container">
      <div
        className="format-toolbar markdown-ribbon"
        role="toolbar"
        aria-label="正文格式"
      >
        {editor && (
          <>
            <section className="ribbon-group" aria-label="编辑工具">
              <div>
                {tool(
                  "撤销",
                  Undo2,
                  () => editor.chain().focus().undo().run(),
                  false,
                  disabled || !editor.can().undo(),
                  "Ctrl+Z",
                )}
                {tool(
                  "重做",
                  Redo2,
                  () => editor.chain().focus().redo().run(),
                  false,
                  disabled || !editor.can().redo(),
                  "Ctrl+Y",
                )}
                {tool(
                  "剪切",
                  Scissors,
                  () => native("cut"),
                  false,
                  disabled || !hasSelection,
                  "Ctrl+X",
                )}
                {tool(
                  "复制",
                  Copy,
                  () => native("copy"),
                  false,
                  !hasSelection,
                  "Ctrl+C",
                )}
                {tool(
                  "粘贴",
                  Clipboard,
                  () => native("paste"),
                  false,
                  disabled,
                  "Ctrl+V",
                )}
              </div>
              <small>编辑</small>
            </section>
            <section className="ribbon-group" aria-label="文本工具">
              <div>
                <Select
                  aria-label="段落样式"
                  disabled={blockDisabled}
                  value={
                    editor.isActive("heading")
                      ? String(editor.getAttributes("heading").level)
                      : "0"
                  }
                  onCloseFocus={() => editor.commands.focus()}
                  onValueChange={(value) =>
                    value === "0"
                      ? editor.chain().focus().setParagraph().run()
                      : editor
                          .chain()
                          .focus()
                          .setHeading({
                            level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6,
                          })
                          .run()
                  }
                >
                  <option value="0">正文</option>
                  {[1, 2, 3, 4, 5, 6].map((level) => (
                    <option key={level} value={level}>
                      标题 {level}
                    </option>
                  ))}
                </Select>
                {tool(
                  "加粗",
                  Bold,
                  () => editor.chain().focus().toggleBold().run(),
                  editor.isActive("bold"),
                  disabled,
                  "Ctrl+B",
                )}
                {tool(
                  "斜体",
                  Italic,
                  () => editor.chain().focus().toggleItalic().run(),
                  editor.isActive("italic"),
                  disabled,
                  "Ctrl+I",
                )}
                {tool(
                  "删除线",
                  Strikethrough,
                  () => editor.chain().focus().toggleStrike().run(),
                  editor.isActive("strike"),
                )}
                {tool(
                  "行内代码",
                  Code2,
                  () => editor.chain().focus().toggleCode().run(),
                  editor.isActive("code"),
                )}
                {tool("清除格式", RemoveFormatting, () => clearFormatting())}
              </div>
              <small>文本</small>
            </section>
            <section className="ribbon-group" aria-label="段落工具">
              <div>
                {tool(
                  "无序列表",
                  List,
                  () => editor.chain().focus().toggleBulletList().run(),
                  editor.isActive("bulletList"),
                  blockDisabled,
                )}
                {tool(
                  "有序列表",
                  ListOrdered,
                  () => editor.chain().focus().toggleOrderedList().run(),
                  editor.isActive("orderedList"),
                  blockDisabled,
                )}
                {tool(
                  "任务列表",
                  ListTodo,
                  () => editor.chain().focus().toggleTaskList().run(),
                  editor.isActive("taskList"),
                  blockDisabled,
                )}
                {tool(
                  "引用",
                  Quote,
                  () => editor.chain().focus().toggleBlockquote().run(),
                  editor.isActive("blockquote"),
                  blockDisabled,
                )}
                {tool(
                  "增加列表层级",
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
                  "减少列表层级",
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
              <small>段落</small>
            </section>
            <section className="ribbon-group" aria-label="插入工具">
              <div>
                {tool(
                  "插入链接",
                  Link,
                  () => open("link"),
                  editor.isActive("link"),
                )}
                {tool(
                  "移除链接",
                  Unlink,
                  () =>
                    editor
                      .chain()
                      .focus()
                      .extendMarkRange("link")
                      .unsetLink()
                      .run(),
                  false,
                  disabled || !editor.isActive("link"),
                )}
                {tool(
                  "插入图片",
                  Image,
                  () => open("image"),
                  editor.isActive("image"),
                )}
                {tool("导入本地资源", FileUp, onImport)}
                {tool(
                  "插入表格",
                  Table2,
                  () => open("table"),
                  table,
                  blockDisabled,
                )}
                {tool(
                  "代码块",
                  SquareCode,
                  () => open("code"),
                  editor.isActive("codeBlock"),
                  blockDisabled,
                )}
                {tool(
                  "分隔线",
                  Minus,
                  () => editor.chain().focus().setHorizontalRule().run(),
                  false,
                  blockDisabled,
                )}
                {tool(
                  "硬换行",
                  WrapText,
                  () => editor.chain().focus().setHardBreak().run(),
                  false,
                  blockDisabled,
                )}
                {tool(
                  "Markdown 语法",
                  BookOpen,
                  () => open("syntax"),
                  false,
                  false,
                )}
              </div>
              <small>插入</small>
            </section>
          </>
        )}
      </div>
      {table && (
        <div className="table-ribbon" role="toolbar" aria-label="表格工具">
          <small>GFM 表格</small>
          {tableActions.map((action) => (
            <button
              className="button small"
              key={action.id}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => safe(action.run)}
            >
              {action.label}
            </button>
          ))}
          <Select
            aria-label="表格列对齐"
            disabled={disabled}
            value=""
            onCloseFocus={() => editor!.commands.focus()}
            onValueChange={(value) => {
              editor!.view.focus();
              alignTableColumns(
                editor!,
                value === "default"
                  ? null
                  : (value as "left" | "center" | "right"),
              );
            }}
          >
            <option value="" disabled>
              列对齐
            </option>
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
            <option value="default">默认对齐</option>
          </Select>
        </div>
      )}
      {menu && <EditorMenu {...menu} items={menuItems} onClose={closeMenu} />}
      {form && (
        <EditorDialog
          title={
            form.kind === "link"
              ? "链接"
              : form.kind === "image"
                ? "图片"
                : form.kind === "table"
                  ? "插入表格"
                  : form.kind === "code"
                    ? "代码块"
                    : "Markdown 语法"
          }
          onClose={closeForm}
        >
          <form onSubmit={(event) => void submit(event)}>
            {form.kind === "syntax" ? (
              <>
                <label>
                  语法
                  <Select
                    aria-label="Markdown 语法类型"
                    value={form.values.syntax}
                    onValueChange={(value) => values("syntax", value)}
                  >
                    {[...new Set(markdownSyntax.map((s) => s.group))].map(
                      (group) => (
                        <optgroup key={group} label={group}>
                          {markdownSyntax
                            .filter((s) => s.group === group)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.label}
                              </option>
                            ))}
                        </optgroup>
                      ),
                    )}
                  </Select>
                </label>
                <pre className="syntax-example">{selectedSyntax?.example}</pre>
                {(selectedSyntax?.sourceOnly ||
                  requiresSourceMode(sourceText)) && (
                  <p className="field-hint">
                    插入后切换到源码编辑，以保留此语法的完整写法。
                  </p>
                )}
              </>
            ) : form.kind === "table" ? (
              <div className="editor-dialog-grid">
                {[
                  ["rows", "行数"],
                  ["cols", "列数"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      aria-label={label}
                      type="number"
                      min={1}
                      max={key === "rows" ? 100 : 20}
                      value={form.values[key]}
                      onChange={(e) => values(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            ) : form.kind === "code" ? (
              <>
                <label>
                  代码语言
                  <input
                    aria-label="代码语言"
                    value={form.values.language}
                    placeholder="text、javascript、python…"
                    onChange={(e) => values("language", e.target.value)}
                  />
                </label>
                <label>
                  代码
                  <textarea
                    aria-label="代码内容"
                    rows={9}
                    value={form.values.code}
                    onChange={(e) => values("code", e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  {form.kind === "image" ? "图片地址" : "链接地址"}
                  <input
                    autoFocus
                    aria-label={form.kind === "image" ? "图片地址" : "链接地址"}
                    value={form.values.url}
                    onChange={(e) => values("url", e.target.value)}
                    placeholder="https://… 或工程内相对路径"
                  />
                </label>
                {form.kind === "image" && (
                  <label>
                    工程图片
                    <Select
                      aria-label="工程图片"
                      value=""
                      onValueChange={(value) => {
                        values("url", relativeResource(sourcePath, value));
                      }}
                    >
                      <option value="">选择已导入的图片…</option>
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
                  {form.kind === "image" ? "图片说明" : "链接文字"}
                  <input
                    aria-label={form.kind === "image" ? "图片说明" : "链接文字"}
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
                  标题（可选）
                  <input
                    aria-label="链接或图片标题"
                    value={form.values.title}
                    onChange={(e) => values("title", e.target.value)}
                  />
                </label>
                {form.kind === "image" && (
                  <p className="field-hint">
                    本地图片可导入工程；外部图片仅保留引用，不自动联网加载。
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
                    closeForm();
                    safe(onImport);
                  }}
                >
                  从文件导入
                </button>
              )}
              <button type="button" className="button" onClick={closeForm}>
                取消
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={form.kind === "syntax" ? !sourceEditable : disabled}
              >
                {form.kind === "syntax"
                  ? selectedSyntax?.sourceOnly || requiresSourceMode(sourceText)
                    ? "插入并编辑源码"
                    : "插入"
                  : "确定"}
              </button>
            </div>
          </form>
        </EditorDialog>
      )}
    </div>
  );
}
