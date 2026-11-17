import { t } from "../../shared/i18n";
import type { Editor, JSONContent, MarkdownParseResult } from "@tiptap/core";
import type { InsertionDraft } from "../../shared/resources";
import StarterKit from "@tiptap/starter-kit";
import { BulletList, OrderedList } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import CodeBlock from "@tiptap/extension-code-block";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TableKit, TableCell, TableHeader } from "@tiptap/extension-table";
import { Extension } from "@tiptap/core";
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
) => [
  StarterKit.configure({
    link: false,
    codeBlock: false,
    underline: false,
    bulletList: false,
    orderedList: false,
    ...(paged ? { trailingNode: false as const } : {}),
  }),
  MdkContainer,
  BulletList.extend({
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
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({
    table: { resizable: false, allowTableNodeSelection: true },
    tableCell: false,
    tableHeader: false,
  }),
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
) {
  if (!editor.markdown) throw new Error(t("Markdown 编辑器尚未就绪。"));
  const coords = editor.view.posAtCoords({ left: x, top: y }),
    from = coords?.pos ?? editor.state.selection.from,
    to = coords ? from : editor.state.selection.to;
  const paragraph = editor.schema.nodes.paragraph.create(
    null,
    editor.schema.text(marker),
  );
  return editor.state.tr.replaceRangeWith(from, to, paragraph);
}
