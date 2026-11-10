import { Extension, type Editor } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type RichPage = { index: number; text: string; final?: boolean };
export type RichPageChange = Pick<RichPage, "index" | "text">;
type PageStart = Pick<RichPage, "index" | "final"> & { pos: number };
type PagePart = PageStart & { end: number; fragment: Fragment };

const pageKey = new PluginKey<PageStart[]>("mardikor-page-window");

function parsePage(editor: Editor, text: string) {
  // replacePages keeps the source separators. Parsing them would create
  // editable blank paragraphs at internal seams.
  const body = text.replace(/(?:\r\n|\r|\n)[\t \r\n]*$/, "");
  return body
    ? editor.schema.nodeFromJSON(editor.markdown!.parse(body)).content
    : Fragment.empty;
}

function mapStarts(starts: PageStart[], transaction: Transaction) {
  return starts.map((page, index) => {
    const mapped = index === 0 ? 0 : transaction.mapping.map(page.pos, 1);
    const position = transaction.doc.resolve(mapped);
    // If an edit joins blocks across a boundary, keep the whole joined block.
    return { ...page, pos: position.depth ? position.after(1) : mapped };
  });
}

function parts(doc: ProseMirrorNode, starts: PageStart[]): PagePart[] {
  return starts.map((page, index) => {
    const end = starts[index + 1]?.pos ?? doc.content.size;
    return { ...page, end, fragment: doc.content.cut(page.pos, end) };
  });
}

export function richPageParts(state: EditorState) {
  return parts(state.doc, pageKey.getState(state) ?? []);
}

export const RichPages = Extension.create({
  name: "mardikorPageWindow",
  addProseMirrorPlugins() {
    return [
      new Plugin<PageStart[]>({
        key: pageKey,
        state: {
          init: () => [],
          apply(transaction, starts) {
            return (
              transaction.getMeta(pageKey) ??
              (transaction.docChanged ? mapStarts(starts, transaction) : starts)
            );
          },
        },
        appendTransaction(transactions, _previous, state) {
          if (
            !pageKey.getState(state)?.at(-1)?.final ||
            state.doc.lastChild?.type.name === "paragraph" ||
            !transactions.some((transaction) => transaction.docChanged)
          )
            return null;
          return state.tr.insert(
            state.doc.content.size,
            state.schema.nodes.paragraph.create(),
          );
        },
        props: {
          decorations(state) {
            const starts = pageKey.getState(state) ?? [];
            return DecorationSet.create(
              state.doc,
              starts.slice(1).map(({ index, pos }) =>
                Decoration.widget(
                  pos,
                  () => {
                    const boundary = document.createElement("div");
                    boundary.className = "rich-page-boundary";
                    boundary.dataset.editorPage = String(index);
                    boundary.setAttribute("aria-hidden", "true");
                    const label = document.createElement("span");
                    label.className = "document-page-marker";
                    label.textContent = String(index + 1);
                    boundary.append(label);
                    return boundary;
                  },
                  { side: -1, key: "page-" + index },
                ),
              ),
            );
          },
        },
      }),
    ];
  },
});

export function loadRichPages(
  editor: Editor,
  pages: RichPage[],
  loaded: ReadonlyMap<number, string>,
) {
  const previous = richPageParts(editor.state);
  const desired = pages.map((page) => {
    const old = previous.find(({ index }) => index === page.index);
    const fragment =
      old && loaded.get(page.index) === page.text
        ? old.fragment
        : parsePage(editor, page.text);
    return { ...page, fragment };
  });
  const join = (start: number, end: number) =>
    desired
      .slice(start, end)
      .reduce((all, page) => all.append(page.fragment), Fragment.empty);
  const transaction = editor.state.tr;
  const first = previous.findIndex(({ index }) => index === desired[0].index);
  const commonStart = first >= 0 ? first : 0;
  const desiredStart = desired.findIndex(
    ({ index }) => index === previous[commonStart]?.index,
  );
  if (desiredStart < 0) {
    transaction.replaceWith(
      0,
      editor.state.doc.content.size,
      join(0, desired.length),
    );
  } else {
    const commonCount = Math.min(
      previous.length - commonStart,
      desired.length - desiredStart,
    );
    const commonEnd = commonStart + commonCount - 1;
    const docEnd = editor.state.doc.content.size;
    const tailStart = previous[commonEnd].end;
    const tail = join(desiredStart + commonCount, desired.length);
    if (tailStart !== docEnd || tail.size)
      transaction.replaceWith(tailStart, docEnd, tail);
    for (let offset = commonCount - 1; offset >= 0; offset--) {
      const old = previous[commonStart + offset];
      const fresh = desired[desiredStart + offset].fragment;
      if (!old.fragment.eq(fresh))
        transaction.replaceWith(old.pos, old.end, fresh);
    }
    const head = join(0, desiredStart);
    const headEnd = previous[commonStart].pos;
    if (headEnd || head.size) transaction.replaceWith(0, headEnd, head);
  }
  let pos = 0;
  const starts = desired.map(({ index, final, fragment }) => {
    const start = { index, final, pos };
    pos += fragment.size;
    return start;
  });
  editor.view.dispatch(
    transaction
      .setMeta(pageKey, starts)
      .setMeta("preventUpdate", true)
      .setMeta("addToHistory", false),
  );
}

export function richPageChanges(
  editor: Editor,
  previous: EditorState,
  doc: ProseMirrorNode,
  starts: PageStart[],
): RichPageChange[] {
  const original = richPageParts(previous);
  return parts(doc, starts).flatMap(({ index, fragment }, i) =>
    original[i]?.fragment.eq(fragment)
      ? []
      : [
          {
            index,
            text: editor.markdown!.serialize(doc.copy(fragment).toJSON()),
          },
        ],
  );
}

export function richPageDraft(editor: Editor, transaction: Transaction) {
  return richPageChanges(
    editor,
    editor.state,
    transaction.doc,
    mapStarts(pageKey.getState(editor.state) ?? [], transaction),
  );
}

export function richPageTextPosition(
  editor: Editor,
  index: number,
  ordinal: number,
  textOffset: number,
) {
  const part = richPageParts(editor.state).find((page) => page.index === index);
  if (!part || ordinal >= part.fragment.childCount) return undefined;
  let blockStart = part.pos;
  for (let index = 0; index < ordinal; index++)
    blockStart += part.fragment.child(index).nodeSize;
  let remaining = textOffset;
  let match: number | undefined;
  part.fragment.child(ordinal).descendants((child, pos) => {
    if (match !== undefined || !child.isText) return;
    const length = child.text?.length ?? 0;
    if (remaining <= length) match = blockStart + 1 + pos + remaining;
    else remaining -= length;
  });
  return match;
}
