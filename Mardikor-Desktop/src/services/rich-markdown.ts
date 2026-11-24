import { t } from "../../shared/i18n";
import type { AnyExtension, Editor, JSONContent, MarkdownParseResult } from "@tiptap/core";
import type { InsertionDraft } from "../../shared/resources";
import StarterKit from "@tiptap/starter-kit";
import { BulletList, OrderedList } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import CodeBlock from "@tiptap/extension-code-block";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Table, TableKit, TableCell, TableHeader } from "@tiptap/extension-table";
import { Extension, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { TableMap, CellSelection, cellAround } from "@tiptap/pm/tables";
import {
  imageMarkdown,
  markdownDestination,
  markdownTitle,
  codeFence,
} from "../../shared/markdown-editing";
import { createMarkdownParser } from "../../shared/markdown-parser";
import { MdkContainer } from "./rich-container";

const listParser = createMarkdownParser(false, false);

// The workspace owns configurable format chords. Keep each extension's
// context keys, such as Backspace in quotes and Tab in code blocks.
function editorContextKeys(keys: ReturnType<NonNullable<AnyExtension["config"]["addKeyboardShortcuts"]>> | undefined) {
  return Object.fromEntries(Object.entries(keys ?? {}).filter(([key]) => !key.startsWith("Mod-")));
}

const workspaceFormatExtensions = new Set(["bold", "italic", "strike", "code", "heading", "blockquote"]);
const WorkspaceStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      workspaceFormatExtensions.has(extension.name)
        ? extension.extend({ addKeyboardShortcuts() { return editorContextKeys(this.parent?.()); } })
        : extension,
    );
  },
});

function listSpacing(result: MarkdownParseResult, loose: unknown) {
  if (!Array.isArray(result) && loose === true)
    return { ...result, attrs: { ...result.attrs, loose: true } };
  return result;
}

const listSpacingAttribute = {
  default: false,
  parseHTML: (element: HTMLElement) => element.hasAttribute("data-loose-list"),
  renderHTML: (attrs: JSONContent["attrs"]) =>
    attrs?.loose ? { "data-loose-list": "" } : {},
};

export const editorExtensions = (
  resolveResource?: (src: string) => Promise<string>,
  paged = false,
  sectionHistory = false,
) => [
  WorkspaceStarterKit.configure({
    link: false,
    codeBlock: false,
    underline: false,
    bulletList: false,
    orderedList: false,
    ...(sectionHistory ? { undoRedo: false as const } : {}),
    ...(paged ? { trailingNode: false as const } : {}),
  }),
  MdkContainer,
  BulletList.extend({
    addKeyboardShortcuts() { return editorContextKeys(this.parent?.()); },
    addAttributes() {
      return { ...this.parent?.(), loose: listSpacingAttribute };
    },
    parseMarkdown(token, helpers) {
      return listSpacing(this.parent?.(token, helpers) ?? [], token.loose);
    },
    renderMarkdown(node, helpers) {
      return helpers.renderChildren(
        node.content ?? [],
        node.attrs?.loose ? "\n\n" : "\n",
      );
    },
  }),
  OrderedList.extend({
    addKeyboardShortcuts() { return editorContextKeys(this.parent?.()); },
    addAttributes() {
      return { ...this.parent?.(), loose: listSpacingAttribute };
    },
    parseMarkdown(token, helpers) {
      const raw = token.raw ?? "";
      // The ordered-list tokenizer also supports Roman numerals, but doesn't
      // supply the CommonMark loose flag for standard numeric lists.
      const loose =
        token.loose ??
        (token.ordered &&
          /\n[\t ]*\n/.test(raw) &&
          listParser
            .parse(raw, {})
            .some(
              (part) =>
                part.type === "paragraph_open" &&
                part.level === 2 &&
                !part.hidden,
            ));
      return listSpacing(this.parent?.(token, helpers) ?? [], loose);
    },
    renderMarkdown(node, helpers) {
      return helpers.renderChildren(
        node.content ?? [],
        node.attrs?.loose ? "\n\n" : "\n",
      );
    },
  }),
  Link.extend({
    renderMarkdown: (node, h) =>
      "[" +
      h.renderChildren(node) +
      "](" +
      markdownDestination(node.attrs?.href ?? "") +
      markdownTitle(node.attrs?.title ?? "") +
      ")",
  }).configure({ openOnClick: false }),
  CodeBlock.extend({
    addKeyboardShortcuts() { return editorContextKeys(this.parent?.()); },
    renderMarkdown: (node, h) =>
      codeFence(
        h.renderChildren(node.content ?? []),
        node.attrs?.language ?? "",
      ),
  }),
  Image.extend({
    renderMarkdown: (node) =>
      imageMarkdown(
        node.attrs?.src ?? "",
        node.attrs?.alt ?? "",
        node.attrs?.title ?? "",
      ),
    addNodeView() {
      return ({ node }) => {
        const image = document.createElement("img");
        image.dataset.mdkRef = node.attrs.src ?? "";
        image.alt = node.attrs.alt ?? "";
        image.title = node.attrs.title ?? "";
        let live = true;
        if (resolveResource)
          void resolveResource(node.attrs.src)
            .then((src) => {
              if (live && src) image.src = src;
            })
            .catch(() => {
              if (live) image.alt = t("资源不可用：") + node.attrs.src;
            });
        return {
          dom: image,
          destroy() {
            live = false;
          },
        };
      };
    },
  }).configure({ allowBase64: true, inline: true }),
  TaskList.extend({ addKeyboardShortcuts() { return editorContextKeys(this.parent?.()); } }),
  TaskItem.configure({ nested: true }),
  TableKit.configure({
    table: false,
    tableCell: false,
    tableHeader: false,
  }),
  Table.extend({
    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        { class: "mdk-table-container" },
        ["table", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), ["tbody", 0]],
      ];
    },
  }).configure({ View: null, resizable: false, allowTableNodeSelection: true }),
  TableCell.extend({ content: "paragraph" }),
  TableHeader.extend({ content: "paragraph" }),
  Extension.create({
    name: "markdownTableHeader",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction(tr) {
            if (!tr.docChanged || tr.getMeta("preventUpdate")) return true;
            // CommonMark/GFM cannot encode multiline cells without raw HTML.
            // Keep such content in source mode instead of silently writing <br>.
            let invalid = false;
            tr.doc.descendants((node) => {
              if (node.type.name !== "table") return;
              node.descendants((child) => {
                if (child.type.name === "hardBreak") invalid = true;
              });
              return false;
            });
            return !invalid;
          },
          appendTransaction(transactions, _old, state) {
            if (!transactions.some((tr) => tr.docChanged)) return null;
            const tr = state.tr;
            state.doc.descendants((table, pos) => {
              if (table.type.name !== "table") return;
              table.forEach((row, rowOffset, rowIndex) =>
                row.forEach((cell, cellOffset) => {
                  const type =
                    rowIndex === 0
                      ? state.schema.nodes.tableHeader
                      : state.schema.nodes.tableCell;
                  if (cell.type !== type)
                    tr.setNodeMarkup(
                      pos + 2 + rowOffset + cellOffset,
                      type,
                      cell.attrs,
                    );
                }),
              );
            });
            return tr.docChanged ? tr : null;
          },
        }),
      ];
    },
  }),
  Markdown.configure({ indentation: { style: "space", size: 2 } }),
];

export function alignTableColumns(
  editor: Editor,
  align: "left" | "center" | "right" | null,
) {
  const selection = editor.state.selection;
  const cell =
    selection instanceof CellSelection
      ? selection.$anchorCell
      : cellAround(selection.$from);
  if (!cell) return false;
  let depth = cell.depth;
  while (depth > 0 && cell.node(depth).type.name !== "table") depth--;
  if (!depth) return false;
  const table = cell.node(depth),
    start = cell.start(depth),
    map = TableMap.get(table);
  const rect =
    selection instanceof CellSelection
      ? map.rectBetween(
          selection.$anchorCell.pos - start,
          selection.$headCell.pos - start,
        )
      : map.findCell(cell.pos - start);
  const tr = editor.state.tr,
    visited = new Set<number>();
  for (let row = 0; row < map.height; row++)
    for (let col = rect.left; col < rect.right; col++) {
      const pos = start + map.map[row * map.width + col];
      if (visited.has(pos)) continue;
      visited.add(pos);
      const node = tr.doc.nodeAt(pos)!;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
    }
  editor.view.dispatch(tr);
  return true;
}

export function richDropDraft(
  editor: Editor,
  x: number,
  y: number,
  marker: string,
): InsertionDraft {
  const transaction = richDropTransaction(editor, x, y, marker);
  return {
    content: editor.markdown!.serialize(transaction.doc.toJSON()),
    marker,
  };
}

export function richDropTransaction(
  editor: Editor,
  x: number,
  y: number,
  marker: string,
  position = x >= 0 && y >= 0 ? richFileDropPosition(editor, x, y) : undefined,
) {
  if (!editor.markdown) throw new Error(t("Markdown 编辑器尚未就绪。"));
  if (x >= 0 && y >= 0 && !position)
    throw new Error(t("资源插入位置无效。"));
  const from = position?.pos ?? editor.state.selection.from;
  const to = position ? from : editor.state.selection.to;
  const paragraph = editor.schema.nodes.paragraph.create(
    null,
    editor.schema.text(marker),
  );
  return editor.state.tr.replaceRangeWith(from, to, paragraph);
}

export function richFileDropPosition(editor: Editor, x: number, y: number) {
  if (editor.isDestroyed || !editor.isEditable) return;
  const { view, state } = editor;
  const paper = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({ left: x, top: y }) ?? (
    y <= paper.top ? { pos: 0 } :
    y >= paper.bottom ? { pos: state.doc.content.size } :
    view.posAtCoords({ left: Math.max(paper.left + 1, Math.min(x, paper.right - 1)), top: y })
  );
  if (!hit) return;
  const resolved = state.doc.resolve(hit.pos);
  const block = resolved.depth ? resolved.before(1) : hit.pos;
  const neighboringStart = block - (state.doc.resolve(block).nodeBefore?.nodeSize ?? 0);
  const startingNode = view.nodeDOM(block);
  const previousNode = neighboringStart < block ? view.nodeDOM(neighboringStart) : null;
  const nextRect = startingNode instanceof HTMLElement ? startingNode.getBoundingClientRect() : null;
  const prevRect = previousNode instanceof HTMLElement ? previousNode.getBoundingClientRect() : null;
  const onPrevious = prevRect && (!nextRect ||
    Math.abs(y - prevRect.bottom) < Math.abs(y - nextRect.top)) &&
    !resolved.depth && y < (nextRect?.top ?? Infinity);
  if (onPrevious) return { pos: block, before: false, top: prevRect.bottom + 2, left: paper.left, width: paper.width };
  const before = !resolved.depth || !nextRect || y < (nextRect.top + nextRect.bottom) / 2;
  const pos = before ? block : resolved.after(1);
  const top = nextRect ? (before ? nextRect.top - 2 : nextRect.bottom + 2) : y;
  return { pos, before, top, left: paper.left, width: paper.width };
}
