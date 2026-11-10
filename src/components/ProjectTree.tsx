import { t } from "../../shared/i18n";
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
import {
  entryDisplayName,
  type MdkEntry,
  type ProjectFile,
} from "../../shared/mdk";
import { DocumentIcon } from "./DocumentIcon";
import {
  isFixedResourceFolder,
  isResourcePath,
  resourceCategories,
} from "../../shared/resources";

interface TreeItem {
  id: string;
  name: string;
  path?: string;
  position?: string;
  entry?: MdkEntry;
  directory: boolean;
  exists?: boolean;
  children?: TreeItem[];
}
interface TreeActions {
  open: (item: TreeItem) => void;
  menu: (item: TreeItem, x: number, y: number) => void;
  busy: boolean;
  selection?: ReadonlyMap<string, { checked: boolean; mixed: boolean }>;
  toggleSelection?: (item: TreeItem) => void;
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
  const selection = actions.selection?.get(data.id);
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
        if (selection) {
          actions.toggleSelection?.(data);
          return;
        }
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
        aria-label={`${node.isOpen ? t("折叠") : t("展开")} ${data.name}`}
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
      {actions.selection && (
        <input
          type="checkbox"
          className="resource-select-checkbox"
          aria-label={t("选择文件 {0}", data.path)}
          checked={!!selection?.checked}
          ref={(input) => {
            if (input) input.indeterminate = !!selection?.mixed;
          }}
          disabled={actions.busy || !selection}
          onClick={(event) => event.stopPropagation()}
          onChange={() => actions.toggleSelection?.(data)}
        />
      )}
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
        aria-label={t(
          "操作 {0}",
          data.entry ? data.entry.path.split("/").pop() : data.name,
        )}
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
  | "new-folder"
  | "import-files"
  | "import-folders"
  | "extract-resources"
  | "extract-file";
export function ProjectTree({
  view,
  entries,
  files,
  selected,
  query,
  busy,
  readOnly = false,
  showResources = false,
  fileSelection,
  onFileSelection,
  onExtractSelection,
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
  showResources?: boolean;
  fileSelection?: ReadonlySet<string>;
  onFileSelection?: (selection: Set<string>) => void;
  onExtractSelection?: (paths: string[]) => void;
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
    const present = new Set(files.map(({ path }) => path));
    const outline = (nodes: OutlineNode[]): TreeItem[] =>
      nodes.map((node) => ({
        id: node.entry?.id ?? "position:" + node.position,
        name: node.entry
          ? (entryDisplayName(node.entry) ??
            node.entry.path.split("/").pop()!.replace(/\.md$/, ""))
          : t("{0}（无文稿）", node.position),
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
        exists: present.has(node.path),
        ...(node.directory ? { children: physical(node.children) } : {}),
      }));
    const roots =
      showResources &&
      !files.some(
        ({ path, kind }) => path === "resources" && kind !== "directory",
      )
        ? [
            "resources",
            ...resourceCategories.map((kind) => "resources/" + kind),
          ]
            .filter((path) => !present.has(path))
            .map((path): ProjectFile => ({
              path,
              kind: "directory",
              bytes: 0,
              is_text: false,
            }))
        : [];
    return view === "outline"
      ? outline(buildOutline(entries))
      : physical(buildFileTree([...files, ...roots]));
  }, [view, entries, files, showResources]);
  const selection = useMemo(() => {
    if (view !== "files" || !fileSelection) return undefined;
    const states = new Map<string, { checked: boolean; mixed: boolean }>();
    function collect(
      item: TreeItem,
    ): { checked: boolean; mixed: boolean } | undefined {
      const children =
        item.children?.map(collect).filter((state) => state !== undefined) ??
        [];
      if (!children.length && !item.exists) return undefined;
      const checked = children.length
        ? children.every((child) => child.checked)
        : fileSelection!.has(item.id);
      const state = {
        checked,
        mixed:
          !checked && children.some((child) => child.checked || child.mixed),
      };
      states.set(item.id, state);
      return state;
    }
    data.forEach(collect);
    return states;
  }, [view, data, fileSelection]);
  const selectedPaths = fileSelection
    ? [...fileSelection].filter((id) => selection?.get(id)?.checked)
    : [];
  function toggleSelection(item: TreeItem) {
    if (!fileSelection || !selection) return;
    const next = new Set(fileSelection);
    const checked = !selection.get(item.id)?.checked;
    function change(item: TreeItem) {
      const children =
        item.children?.filter((child) => selection!.has(child.id)) ?? [];
      if (children.length) children.forEach(change);
      else if (item.exists) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
    }
    change(item);
    onFileSelection?.(next);
  }
  const selectedId =
    view === "files" ? selected : entries.find((e) => e.path === selected)?.id;
  const actions: TreeActions = {
    busy,
    selection,
    toggleSelection,
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
          aria-label={view === "files" ? t("工程文件管理器") : t("文稿目录树")}
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
            if (selection?.has(node.data.id)) toggleSelection(node.data);
            else if (node.data.path && !node.data.directory)
              onOpen(node.data.path);
            else node.toggle();
          }}
        >
          {Row}
        </Tree>
      </Actions.Provider>
      {!data.length && (
        <p className="outline-hint">
          {view === "outline"
            ? t("暂无文稿。点击 + 新建文稿。")
            : t("暂无文件。")}
        </p>
      )}
      {menu && (
        <>
          <button
            className="menu-dismiss"
            aria-label={t("关闭目录菜单")}
            onClick={() => setMenu(null)}
          />
          <div
            className="entry-menu project-context-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
          >
            {selectedPaths.length &&
            (selection?.get(menu.item.id)?.checked ||
              selection?.get(menu.item.id)?.mixed) ? (
              <button
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenu(null);
                  onExtractSelection?.(selectedPaths);
                }}
              >
                {t("提取所选项（{0}）", selectedPaths.length)}
              </button>
            ) : null}
            {(view === "outline"
              ? [
                  ["open-side", t("在旁侧打开")],
                  ["child", t("新建子文稿")],
                  ["rename", t("重命名")],
                  ["up", t("上移")],
                  ["down", t("下移")],
                  ["indent", t("增加层级")],
                  ["outdent", t("减少层级")],
                  ["delete", t("删除文稿")],
                ]
              : [
                  ...(!menu.item.directory
                    ? [["open-side", t("在旁侧打开")]]
                    : []),
                  ...(showResources &&
                  menu.item.path &&
                  !isResourcePath(menu.item.path) &&
                  !menu.item.directory
                    ? [["extract-file", t("提取文件")]]
                    : []),
                  ...(!menu.item.directory &&
                  menu.item.path?.startsWith("markdown/") &&
                  menu.item.path.endsWith(".md")
                    ? [
                        [
                          "index",
                          entries.some((entry) => entry.path === menu.item.path)
                            ? t("新增目录引用")
                            : t("加入文稿目录"),
                        ],
                      ]
                    : []),
                  ...(showResources &&
                  menu.item.path &&
                  isResourcePath(menu.item.path)
                    ? [
                        ...(menu.item.directory
                          ? [
                              ["new-folder", t("新建文件夹")],
                              ["import-files", t("导入资源文件")],
                              ["import-folders", t("导入资源文件夹")],
                            ]
                          : []),
                        [
                          "extract-resources",
                          menu.item.directory
                            ? t("提取资源目录")
                            : t("提取资源文件"),
                        ],
                        ...(!isFixedResourceFolder(menu.item.path)
                          ? [
                              ["rename", t("重命名")],
                              ["delete", t("删除")],
                            ]
                          : []),
                      ]
                    : []),
                ]
            ).map(([action, label]) => (
              <button
                key={action}
                role="menuitem"
                disabled={
                  busy ||
                  (readOnly &&
                    action !== "open-side" &&
                    action !== "extract-resources" &&
                    action !== "extract-file") ||
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
