import { t } from "../../shared/i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ListTree,
  MoreHorizontal,
} from "lucide-react";
import {
  canMoveMarkdownSection,
  type MarkdownHeading,
  type SectionSide,
} from "../../shared/markdown";
import { EditorMenu } from "./EditorMenu";

type SectionMove = (
  from: MarkdownHeading,
  to: MarkdownHeading,
  side: SectionSide,
) => boolean;
const headingDragType = "application/x-mardikor-outline-heading";

export function HeadingOutline({
  headings,
  active,
  onSelect,
  enabled,
  follow,
  emptyMessage,
  findMatches,
  findActive = -1,
  move,
  moved,
}: {
  headings: MarkdownHeading[];
  active: number;
  onSelect: (heading: MarkdownHeading) => void;
  enabled: boolean;
  follow: boolean;
  emptyMessage?: string;
  findMatches?: ReadonlySet<number>;
  findActive?: number;
  move?: SectionMove;
  moved?: { index: number };
}) {
  const [collapsed, setCollapsed] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<{ move: SectionMove; heading: MarkdownHeading } | null>(
    null,
  );
  const [dragged, setDragged] = useState<MarkdownHeading>();
  const [insertion, setInsertion] = useState<number>();
  const [menu, setMenu] = useState<{
    heading: MarkdownHeading;
    move: SectionMove;
    trigger: HTMLButtonElement;
    x: number;
    y: number;
  }>();
  function cancelDrag() {
    drag.current = null;
    setDragged(undefined);
    setInsertion(undefined);
  }
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
    }
    window.addEventListener("keydown", escape, true);
    window.addEventListener("dragend", cancelDrag);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("dragend", cancelDrag);
    };
  }, []);
  useLayoutEffect(() => {
    cancelDrag();
    setMenu(undefined);
  }, [move, collapsed]);
  function destination(event: React.DragEvent<HTMLDivElement>) {
    const current = drag.current;
    if (
      !current ||
      current.move !== move ||
      !event.dataTransfer.types.includes(headingDragType)
    )
      return;
    const row = (event.target as Element).closest<HTMLElement>(
      "[data-outline-index]",
    );
    if (!row || !event.currentTarget.contains(row)) return;
    const heading = headings[Number(row.dataset.outlineIndex)];
    const rect = row.getBoundingClientRect();
    const side =
      event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    if (!heading || !canMoveMarkdownSection(current.heading, heading, side))
      return;
    return { current, heading, side } as const;
  }
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(0);
  const lastMoved = useRef<typeof moved>(undefined);
  const rowHeight = 30;
  const virtual = headings.length > 100;
  const first = virtual
    ? Math.max(
        0,
        Math.min(headings.length - 1, Math.floor(top / rowHeight) - 6),
      )
    : 0;
  const end = virtual
    ? Math.min(headings.length, first + Math.ceil(height / rowHeight) + 13)
    : headings.length;
  const rows = headings.slice(first, end);
  const pinned =
    dragged && (dragged.index < first || dragged.index >= end)
      ? dragged
      : undefined;
  if (pinned) rows.push(pinned);
  const clippedInsertion =
    insertion !== undefined && 2 + insertion * rowHeight >= top + height;
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => setHeight(node.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsed]);
  useLayoutEffect(() => {
    const node = list.current;
    const focused =
      moved !== lastMoved.current && moved
        ? moved.index
        : findActive >= 0
          ? findActive
          : follow
            ? active
            : -1;
    lastMoved.current = moved;
    if (!node || focused < 0) return;
    if (virtual) {
      const offset = focused * rowHeight;
      if (
        offset < node.scrollTop ||
        offset + rowHeight > node.scrollTop + node.clientHeight
      ) {
        node.scrollTop = Math.max(0, offset - node.clientHeight / 2);
        setTop(node.scrollTop);
      }
    } else {
      const row = node.children[focused] as HTMLElement | undefined;
      if (
        row &&
        (row.offsetTop < node.scrollTop ||
          row.offsetTop + row.offsetHeight > node.scrollTop + node.clientHeight)
      )
        node.scrollTop =
          row.offsetTop -
          Math.max(0, (node.clientHeight - row.offsetHeight) / 2);
    }
  }, [active, follow, virtual, collapsed, findActive, moved]);
  function closeMenu() {
    menu?.trigger.focus({ preventScroll: true });
    setMenu(undefined);
  }
  return (
    <section
      className={`heading-outline ${collapsed ? "collapsed" : ""}`}
      aria-label={t("Markdown 标题大纲")}
    >
      <button
        className="heading-outline-toggle"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <span>
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <ListTree size={14} />
          {t("标题大纲")}
        </span>
        <small>{headings.length}</small>
      </button>
      {!collapsed && (
        <div
          ref={list}
          className="heading-outline-list"
          role="tree"
          aria-label={t("文内标题")}
          onScroll={(event) => setTop(event.currentTarget.scrollTop)}
          onDragOver={(event) => {
            if (!drag.current) return;
            event.stopPropagation();
            const drop = destination(event);
            if (!drop) {
              event.dataTransfer.dropEffect = "none";
              setInsertion(undefined);
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setInsertion(
              drop.side === "before"
                ? drop.heading.index
                : (drop.heading.section!.end?.index ?? headings.length),
            );
          }}
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              setInsertion(undefined);
          }}
          onDrop={(event) => {
            const drop = destination(event);
            if (drag.current) {
              event.preventDefault();
              event.stopPropagation();
            }
            cancelDrag();
            if (drop)
              drop.current.move(drop.current.heading, drop.heading, drop.side);
          }}
        >
          {virtual && first > 0 && (
            <div role="presentation" style={{ height: first * rowHeight }} />
          )}
          {rows.map((heading) => {
            const movable =
              move &&
              heading.section &&
              (heading.section.previous !== undefined ||
                heading.section.next !== undefined);
            return (
              <div
                role="presentation"
                className="heading-outline-row"
                key={heading.index}
                aria-hidden={heading === pinned ? true : undefined}
                // Keep the native drag source mounted while its row scrolls out
                // of the virtual window.
                style={
                  heading === pinned
                    ? {
                        position: "absolute",
                        insetInline: 0,
                        top: 2 + heading.index * rowHeight,
                        pointerEvents: "none",
                      }
                    : undefined
                }
                data-outline-index={heading.index}
                data-insert-before={
                  insertion === heading.index ? "" : undefined
                }
                data-insert-after={
                  insertion === headings.length &&
                  heading.index === headings.length - 1
                    ? ""
                    : undefined
                }
              >
                <button
                  role="treeitem"
                  aria-level={heading.depth + 1}
                  aria-setsize={headings.length}
                  aria-posinset={heading.index + 1}
                  aria-selected={active === heading.index}
                  className={active === heading.index ? "active" : ""}
                  style={{
                    paddingLeft: 12 + heading.depth * 14,
                    height: rowHeight,
                  }}
                  onClick={() => onSelect(heading)}
                  draggable={!!movable}
                  tabIndex={heading === pinned ? -1 : undefined}
                  onDragStart={(event) => {
                    if (!movable) return;
                    // The directory tree's window-level backend cancels drags that
                    // it didn't initiate. Outline moves stay local to this list.
                    event.stopPropagation();
                    drag.current = { move, heading };
                    setDragged(heading);
                    event.dataTransfer.setData(headingDragType, "move");
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  title={heading.title}
                  data-heading-line={heading.line}
                  data-find-match={
                    findMatches?.has(heading.index) ? "" : undefined
                  }
                  data-find-current={
                    findActive === heading.index ? "" : undefined
                  }
                >
                  <span className="heading-level">H{heading.level}</span>
                  <span>{heading.title || t("无标题")}</span>
                </button>
                {movable && (
                  <button
                    type="button"
                    className="heading-outline-actions icon-button"
                    aria-label={t(
                      "移动章节：{0}",
                      heading.title || t("无标题"),
                    )}
                    title={t("移动章节：{0}", heading.title || t("无标题"))}
                    aria-haspopup="menu"
                    tabIndex={heading === pinned ? -1 : undefined}
                    aria-expanded={menu?.heading === heading}
                    onClick={(event) => {
                      const trigger = event.currentTarget;
                      const bounds = trigger.getBoundingClientRect();
                      setMenu({
                        heading,
                        move,
                        trigger,
                        x: bounds.left,
                        y: bounds.bottom,
                      });
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                )}
              </div>
            );
          })}
          {virtual && end < headings.length && (
            <div
              role="presentation"
              style={{ height: (headings.length - end) * rowHeight }}
            />
          )}
          {clippedInsertion && (
            <div
              role="presentation"
              className="heading-outline-insertion"
              style={{ top: top + height - 3 }}
            />
          )}
          {!headings.length && (
            <p>
              {emptyMessage ??
                (enabled
                  ? t("当前文稿没有标题。")
                  : t("选择 Markdown 文稿查看标题。"))}
            </p>
          )}
        </div>
      )}
      {menu && menu.move === move && (
        <EditorMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={t("移动章节：{0}", menu.heading.title || t("无标题"))}
          focusFirst
          onClose={closeMenu}
          items={(
            [
              ["before", "上移一节", menu.heading.section?.previous],
              ["after", "下移一节", menu.heading.section?.next],
            ] as const
          ).map(([side, label, index]) => ({
            id: side,
            label: t(label),
            disabled: index === undefined,
            run: () => {
              if (index !== undefined)
                menu.move(menu.heading, headings[index], side);
            },
          }))}
        />
      )}
    </section>
  );
}
