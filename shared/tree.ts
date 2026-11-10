import { t } from "./i18n";
import type { MdkEntry, ProjectFile } from "./mdk";
import { comparePosition } from "./outline";

export interface OutlineNode {
  position: string;
  entry?: MdkEntry;
  children: OutlineNode[];
}
export type DropPlacement = "before" | "inside" | "after";
export function buildOutline(entries: MdkEntry[]): OutlineNode[] {
  const roots: OutlineNode[] = [],
    nodes = new Map<string, OutlineNode>();
  for (const entry of [...entries].sort((a, b) =>
    comparePosition(a.position, b.position),
  )) {
    const parts = entry.position.split(".");
    let children = roots;
    for (let i = 1; i <= parts.length; i++) {
      const position = parts.slice(0, i).join(".");
      let node = nodes.get(position);
      if (!node) {
        node = { position, children: [] };
        nodes.set(position, node);
        children.push(node);
      }
      if (i === parts.length) node.entry = { ...entry };
      children = node.children;
    }
  }
  return roots;
}
export function serializeOutline(
  nodes: OutlineNode[],
  parent = "",
): MdkEntry[] {
  return nodes.flatMap((node, index) => {
    const position = parent ? `${parent}.${index + 1}` : String(index + 1);
    return [
      ...(node.entry ? [{ ...node.entry, position }] : []),
      ...serializeOutline(node.children, position),
    ];
  });
}

export function removeOutline(entries: MdkEntry[], id: string): MdkEntry[] {
  const roots = buildOutline(entries);
  const remove = (nodes: OutlineNode[]): boolean => {
    const index = nodes.findIndex((node) => node.entry?.id === id);
    if (index >= 0) {
      nodes.splice(index, 1, ...nodes[index].children);
      return true;
    }
    return nodes.some((node) => remove(node.children));
  };
  remove(roots);
  return serializeOutline(roots);
}
export function moveOutline(
  entries: MdkEntry[],
  sourceId: string,
  targetPosition: string,
  placement: DropPlacement,
): MdkEntry[] {
  const roots = buildOutline(entries);
  const locate = (
    nodes: OutlineNode[],
    predicate: (node: OutlineNode) => boolean,
    parent?: OutlineNode,
  ):
    | { node: OutlineNode; siblings: OutlineNode[]; parent?: OutlineNode }
    | undefined => {
    for (const node of nodes) {
      if (predicate(node)) return { node, siblings: nodes, parent };
      const found = locate(node.children, predicate, node);
      if (found) return found;
    }
  };
  const source = locate(roots, (n) => n.entry?.id === sourceId),
    target = locate(roots, (n) => n.position === targetPosition);
  if (!source || !target) throw new Error(t("目录项不存在。"));
  if (
    source.node === target.node ||
    target.node.position.startsWith(source.node.position + ".")
  )
    throw new Error(t("不能将文稿移入自身或其子目录。"));
  const height = (node: OutlineNode): number =>
    1 + Math.max(0, ...node.children.map(height));
  const depth =
    target.node.position.split(".").length + (placement === "inside" ? 1 : 0);
  if (depth + height(source.node) - 1 > 6)
    throw new Error(t("目录最多允许 6 层。"));
  source.siblings.splice(source.siblings.indexOf(source.node), 1);
  const destination =
    placement === "inside" ? target.node.children : target.siblings;
  const index =
    placement === "inside"
      ? destination.length
      : destination.indexOf(target.node) + (placement === "after" ? 1 : 0);
  destination.splice(index, 0, source.node);
  const prune = (nodes: OutlineNode[]): OutlineNode[] =>
    nodes
      .map((n) => ({ ...n, children: prune(n.children) }))
      .filter((n) => n.entry || n.children.length);
  return serializeOutline(prune(roots));
}
export function adjustOutline(
  entries: MdkEntry[],
  id: string,
  action: "up" | "down" | "indent" | "outdent",
): MdkEntry[] {
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(t("目录项不存在。"));
  const parent = entry.position.split(".").slice(0, -1).join(".");
  const siblings = [...entries]
    .filter((e) => e.position.split(".").slice(0, -1).join(".") === parent)
    .sort((a, b) => comparePosition(a.position, b.position));
  const index = siblings.findIndex((e) => e.id === id);
  if (action === "outdent")
    return parent ? moveOutline(entries, id, parent, "after") : entries;
  const target = siblings[index + (action === "down" ? 1 : -1)];
  if (!target) return entries;
  return moveOutline(
    entries,
    id,
    target.position,
    action === "indent" ? "inside" : action === "down" ? "after" : "before",
  );
}

export function moveOutlineToIndex(
  entries: MdkEntry[],
  id: string,
  parentPosition: string | null,
  index: number,
): MdkEntry[] {
  const roots = buildOutline(entries);
  const find = (nodes: OutlineNode[]): OutlineNode | undefined => {
    for (const n of nodes) {
      if (n.position === parentPosition) return n;
      const found = find(n.children);
      if (found) return found;
    }
  };
  const siblings = parentPosition ? find(roots)?.children : roots;
  if (!siblings) throw new Error(t("父目录不存在。"));
  const oldIndex = siblings.findIndex((n) => n.entry?.id === id);
  const remaining = siblings.filter((n) => n.entry?.id !== id);
  const nextIndex = Math.max(
    0,
    index - (oldIndex >= 0 && oldIndex < index ? 1 : 0),
  );
  if (remaining[nextIndex])
    return moveOutline(entries, id, remaining[nextIndex].position, "before");
  if (parentPosition) return moveOutline(entries, id, parentPosition, "inside");
  return remaining.length
    ? moveOutline(
        entries,
        id,
        remaining[remaining.length - 1].position,
        "after",
      )
    : entries;
}

export interface FileNode {
  name: string;
  path: string;
  file?: ProjectFile;
  directory: boolean;
  children: FileNode[];
}
export function buildFileTree(files: ProjectFile[]): FileNode[] {
  const roots: FileNode[] = [];
  for (const file of files) {
    const parts = file.path.replace(/\/$/, "").split("/");
    let children = roots;
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let node = children.find((n) => n.path === path);
      if (!node) {
        node = {
          name,
          path,
          directory: index < parts.length - 1 || file.kind === "directory",
          children: [],
        };
        children.push(node);
      }
      if (index === parts.length - 1) node.file = file;
      children = node.children;
    });
  }
  const sort = (nodes: FileNode[]) => {
    nodes.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
    );
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
