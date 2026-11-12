import { t } from "../../shared/i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ListTree } from "lucide-react";
import type { MarkdownHeading } from "../../shared/markdown";
export function HeadingOutline({
  headings,
  active,
  onSelect,
  enabled,
  follow,
  emptyMessage,
  findMatches,
  findActive = -1,
}: {
  headings: MarkdownHeading[];
  active: number;
  onSelect: (heading: MarkdownHeading) => void;
  enabled: boolean;
  follow: boolean;
  emptyMessage?: string;
  findMatches?: ReadonlySet<number>;
  findActive?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(0);
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
    const focused = findActive >= 0 ? findActive : follow ? active : -1;
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
  }, [active, follow, virtual, collapsed, findActive]);
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
          onScroll={(event) => {
            if (virtual) setTop(event.currentTarget.scrollTop);
          }}
        >
          {virtual && first > 0 && (
            <div role="presentation" style={{ height: first * rowHeight }} />
          )}
          {headings.slice(first, end).map((heading) => (
            <button
              role="treeitem"
              aria-level={heading.depth + 1}
              aria-setsize={headings.length}
              aria-posinset={heading.index + 1}
              aria-selected={active === heading.index}
              className={active === heading.index ? "active" : ""}
              key={heading.index}
              style={{
                paddingLeft: 12 + heading.depth * 14,
                height: rowHeight,
              }}
              onClick={() => onSelect(heading)}
              title={heading.title}
              data-heading-line={heading.line}
              data-find-match={findMatches?.has(heading.index) ? "" : undefined}
              data-find-current={findActive === heading.index ? "" : undefined}
            >
              <span className="heading-level">H{heading.level}</span>
              <span>{heading.title || t("无标题")}</span>
            </button>
          ))}
          {virtual && end < headings.length && (
            <div
              role="presentation"
              style={{ height: (headings.length - end) * rowHeight }}
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
    </section>
  );
}
