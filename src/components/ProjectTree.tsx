import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";
import { useDragDropManager } from "react-dnd";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  File,
  Folder,
  FolderOpen,
  MoreHorizontal,
} from "lucide-react";
import {
  buildFileTree,
  buildOutline,
  type OutlineNode,
  type FileNode,
} from "../../shared/tree";
import type { MdkEntry, ProjectFile } from "../../shared/mdk";
import { DocumentIcon } from "./DocumentIcon";

interface TreeItem {
  id: string;
  name: string;
  path?: string;
  position?: string;
  entry?: MdkEntry;
  directory: boolean;
  children?: TreeItem[];
}
interface TreeActions {
  open: (item: TreeItem) => void;
  menu: (item: TreeItem, x: number, y: number) => void;
  busy: boolean;
}
const Actions = createContext<TreeActions>({
  open() {},
  menu() {},
  busy: false,
});
function Row({ node, style, dragHandle }: NodeRendererProps<TreeItem>) {
  const actions = useContext(Actions),
    data = node.data;
  const children = !!data.children?.length;
  const showMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    actions.menu(data, event.clientX, event.clientY);
  };
  return (
    <div
      ref={dragHandle}
      style={style as CSSProperties}
      className={`project-tree-row ${node.isSelected ? "selected" : ""} ${node.willReceiveDrop ? "drop-target" : ""}`}
      data-entry-id={data.entry?.id}
      data-path={data.path}
      data-position={data.position}
      onClick={(event) => {
        if (actions.busy) return;
        node.handleClick(event);
        if (!data.directory || data.entry) actions.open(data);
      }}
      onDoubleClick={() => {
        if (node.isInternal) node.toggle();
      }}
      onContextMenu={showMenu}
    >
      <button
        className="tree-expander"
        tabIndex={-1}
        aria-label={`${node.isOpen ? "折叠" : "展开"} ${data.name}`}
        style={{
          visibility: children || data.directory ? "visible" : "hidden",
        }}
        onClick={(event) => {
          event.stopPropagation();
          node.toggle();
        }}
      >
        {node.isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {data.directory ? (
        node.isOpen ? (
          <FolderOpen size={15} />
        ) : (
          <Folder size={15} />
        )
      ) : /\.md$/i.test(data.path ?? "") ? (
        <DocumentIcon mode="markdown" size={16} />
      ) : data.entry || /\.(toml|json)$/i.test(data.path ?? "") ? (
        <FileCode2 size={15} />
      ) : (
        <File size={15} />
      )}
      <span className="tree-item-name">{data.name}</span>
      {data.position && <small>{data.position}</small>}
      <button
        className="icon-button tree-item-menu"
        tabIndex={-1}
        aria-label={`操作 ${data.entry ? data.entry.path.split("/").pop() : data.name}`}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          event.preventDefault();
          event.stopPropagation();
          actions.menu(data, box.right - 160, box.bottom);
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}
export type TreeAction =
  | "open-side"
  | "child"
  | "index"
  | "rename"
  | "delete"
  | "up"
  | "down"
  | "indent"
  | "outdent"
  | "new-file"
  | "new-folder";
export function ProjectTree({
  view,
  entries,
  files,
  selected,
  query,
  busy,
  readOnly = false,
  onOpen,
  onMove,
  onAction,
}: {
  view: "outline" | "files";
  entries: MdkEntry[];
  files: ProjectFile[];
  selected: string;
  query: string;
  busy: boolean;
  readOnly?: boolean;
  onOpen: (path: string) => void;
  onMove: (id: string, parentPosition: string | null, index: number) => void;
  onAction: (action: TreeAction, path: string, entry?: MdkEntry) => void;
}) {
  const dndManager = useDragDropManager();
  const host = useRef<HTMLDivElement>(null),
    tree = useRef<TreeApi<TreeItem>>(null);
  const [height, setHeight] = useState(300);
  const [menu, setMenu] = useState<{
    item: TreeItem;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setHeight(Math.max(80, entries[0].contentRect.height)),
    );
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  const data = useMemo(() => {
    const outline = (nodes: OutlineNode[]): TreeItem[] =>
      nodes.map((node) => ({
        id: node.entry?.id ?? "position:" + node.position,
        name: node.entry
          ? node.entry.path.split("/").pop()!.replace(/\.md$/, "")
          : `${node.position}（无文稿）`,
        path: node.entry?.path,
        entry: node.entry,
        position: node.position,
        directory: false,
        children: outline(node.children),
      }));
    const physical = (nodes: FileNode[]): TreeItem[] =>
      nodes.map((node) => ({
        id: node.path,
        name: node.name,
        path: node.path,
        directory: node.directory,
        ...(node.directory ? { children: physical(node.children) } : {}),
      }));
    return view === "outline"
      ? outline(buildOutline(entries))
      : physical(buildFileTree(files));
  }, [view, entries, files]);
  const selectedId =
    view === "files" ? selected : entries.find((e) => e.path === selected)?.id;
  const actions: TreeActions = {
    busy,
    open: (item) => {
      if (item.path) onOpen(item.path);
    },
    menu: (item, x, y) =>
      setMenu({
        item,
        x: Math.min(x, window.innerWidth - 185),
        y: Math.min(y, window.innerHeight - 300),
      }),
  };
  return (
    <div className="project-tree" ref={host}>
      <Actions.Provider value={actions}>
        <Tree
          dndManager={dndManager}
          key={view}
          ref={tree}
          data={data}
          height={height}
          width="100%"
          rowHeight={30}
          indent={16}
          padding={4}
          openByDefault
          disableMultiSelection
          disableEdit
          disableDrag={(data) =>
            busy || readOnly || view === "files" || !data.entry
          }
          selection={selectedId}
          aria-label={view === "files" ? "工程文件管理器" : "文稿目录树"}
          searchTerm={query}
          searchMatch={(node, query) =>
            node.data.name.toLowerCase().includes(query.toLowerCase())
          }
          disableDrop={({ parentNode, dragNodes }) =>
            busy ||
            readOnly ||
            view === "files" ||
            (!!parentNode?.data.position &&
              parentNode.data.position.split(".").length +
                Math.max(...dragNodes.map((n) => maxDepth(n.data))) >
                6)
          }
          onMove={({ dragIds, parentNode, index }) => {
            if (dragIds[0])
              onMove(dragIds[0], parentNode?.data.position ?? null, index);
          }}
          onActivate={(node) => {
            if (node.data.path && !node.data.directory) onOpen(node.data.path);
            else node.toggle();
          }}
        >
          {Row}
        </Tree>
      </Actions.Provider>
      {!data.length && (
        <p className="outline-hint">
          {view === "outline" ? "暂无文稿。点击 + 新建文稿。" : "暂无文件。"}
        </p>
      )}
      {menu && (
        <>
          <button
            className="menu-dismiss"
            aria-label="关闭目录菜单"
            onClick={() => setMenu(null)}
          />
          <div
            className="entry-menu project-context-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
          >
            {(view === "outline"
              ? [
                  ["open-side", "在旁侧打开"],
                  ["child", "新建子文稿"],
                  ["rename", "重命名"],
                  ["up", "上移"],
                  ["down", "下移"],
                  ["indent", "增加层级"],
                  ["outdent", "减少层级"],
                  ["delete", "删除文稿"],
                ]
              : [
                  ...(!menu.item.directory
                    ? [["open-side", "在旁侧打开"]]
                    : []),
                  ...(!menu.item.directory &&
                  menu.item.path?.startsWith("markdown/") &&
                  menu.item.path.endsWith(".md")
                    ? [
                        [
                          "index",
                          entries.some((entry) => entry.path === menu.item.path)
                            ? "新增目录引用"
                            : "加入文稿目录",
                        ],
                      ]
                    : []),
                  ["new-file", "新建文本文件"],
                  ["new-folder", "新建文件夹"],
                  ["rename", "重命名"],
                  ["delete", "删除"],
                ]
            ).map(([action, label]) => (
              <button
                key={action}
                role="menuitem"
                disabled={
                  busy ||
                  (readOnly && action !== "open-side") ||
                  (view === "outline" && !menu.item.entry)
                }
                className={action === "delete" ? "danger-text" : ""}
                onClick={() => {
                  setMenu(null);
                  onAction(
                    action as TreeAction,
                    menu.item.path ?? "",
                    menu.item.entry,
                  );
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function maxDepth(item: TreeItem): number {
  return 1 + Math.max(0, ...(item.children ?? []).map(maxDepth));
}
