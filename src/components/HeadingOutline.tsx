import { useState } from "react";
import { ChevronDown, ChevronRight, ListTree } from "lucide-react";
import type { MarkdownHeading } from "../../shared/markdown";
export function HeadingOutline({
  headings,
  active,
  onSelect,
  enabled,
}: {
  headings: MarkdownHeading[];
  active: number;
  onSelect: (heading: MarkdownHeading) => void;
  enabled: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section
      className={`heading-outline ${collapsed ? "collapsed" : ""}`}
      aria-label="Markdown 标题大纲"
    >
      <button
        className="heading-outline-toggle"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <span>
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <ListTree size={14} />
          标题大纲
        </span>
        <small>{headings.length}</small>
      </button>
      {!collapsed && (
        <div className="heading-outline-list" role="tree" aria-label="文内标题">
          {headings.map((heading) => (
            <button
              role="treeitem"
              aria-level={heading.depth + 1}
              aria-selected={active === heading.index}
              className={active === heading.index ? "active" : ""}
              key={heading.index}
              style={{ paddingLeft: 12 + heading.depth * 14 }}
              onClick={() => onSelect(heading)}
              title={heading.title}
              data-heading-line={heading.line}
            >
              <span className="heading-level">H{heading.level}</span>
              <span>{heading.title || "无标题"}</span>
            </button>
          ))}
          {!headings.length && (
            <p>
              {enabled ? "当前文稿没有标题。" : "选择 Markdown 文稿查看标题。"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
