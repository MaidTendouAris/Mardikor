import { t } from "./i18n";
import type { MdkEntry } from "./mdk";
import { comparePosition } from "./outline";
import { isTable, validatePath, type Table } from "./schema";

export const controlFiles = [
  "mimetype",
  "mdk.toml",
  "contents.toml",
  "settings.toml",
  "publication.toml",
];
export const MAX_MANIFEST_BYTES = 65536;
export const MAX_OUTLINE_DEPTH = 128;
const MAX_ORDER = 2147483647;
export const validOutlinePosition = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[1-9]\d*(?:\.[1-9]\d*)*$/.test(value) &&
  value.split(".").length <= MAX_OUTLINE_DEPTH &&
  value.split(".").every((part) => Number(part) <= MAX_ORDER);
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?![\s\S])/.test(value);
export const validFeatureToken = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)+@[1-9][0-9]*(?![\s\S])/.test(
    value,
  );
const title = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

// RFC 5646 permits grandfathered tags alongside the productive grammar.
const grandfatheredTags = new Set([
  "en-gb-oed",
  "i-ami",
  "i-bnn",
  "i-default",
  "i-enochian",
  "i-hak",
  "i-klingon",
  "i-lux",
  "i-mingo",
  "i-navajo",
  "i-pwn",
  "i-tao",
  "i-tay",
  "i-tsu",
  "sgn-be-fr",
  "sgn-be-nl",
  "sgn-ch-de",
  "art-lojban",
  "cel-gaulish",
  "no-bok",
  "no-nyn",
  "zh-guoyu",
  "zh-hakka",
  "zh-min",
  "zh-min-nan",
  "zh-xiang",
]);
const languageGrammar =
  /^(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?((?:-(?:[a-z0-9]{5,8}|\d[a-z0-9]{3}))*)((?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*)(?:-x(?:-[a-z0-9]{1,8})+)?$/;
function validLanguageTag(value: string) {
  if (/\s/u.test(value)) return false;
  const lower = value.toLowerCase();
  if (grandfatheredTags.has(lower) || /^x(?:-[a-z0-9]{1,8})+$/.test(lower))
    return true;
  const match = languageGrammar.exec(lower);
  if (!match) return false;
  const variants = match[1].split("-").slice(1);
  const singletons = match[2].split("-").filter((item) => item.length === 1);
  return (
    new Set(variants).size === variants.length &&
    new Set(singletons).size === singletons.length
  );
}

const uriUnreserved = "[a-z0-9._~!$&'()*+,;=-]|%[a-f0-9]{2}";
const uriPath = new RegExp("^(?:" + uriUnreserved + "|[:@/])*$", "i");
const uriQuery = new RegExp("^(?:" + uriUnreserved + "|[:@/?])*$", "i");
const uriAuthority = new RegExp(
  "^(?:(?:" +
    uriUnreserved +
    "|:)*@)?((?:" +
    uriUnreserved +
    ")*|\\[[^\\]]+\\])(?::[0-9]*)?$",
  "i",
);
function validIdentifier(value: string) {
  if (/\s/u.test(value)) return false;
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(value);
  if (!scheme || /^[a-z]:[\\/]/i.test(value)) return false;
  const remainder = value.slice(scheme[0].length);
  const queryStart = remainder.indexOf("?");
  const hierarchy = queryStart < 0 ? remainder : remainder.slice(0, queryStart);
  if (queryStart >= 0 && !uriQuery.test(remainder.slice(queryStart + 1)))
    return false;
  if (!hierarchy.startsWith("//")) return uriPath.test(hierarchy);
  const pathStart = hierarchy.indexOf("/", 2);
  const authority = uriAuthority.exec(
    hierarchy.slice(2, pathStart < 0 ? undefined : pathStart),
  );
  if (
    !authority ||
    (pathStart >= 0 && !uriPath.test(hierarchy.slice(pathStart)))
  )
    return false;
  const host = authority[1];
  if (!host.startsWith("[")) return true;
  if (/^\[v[0-9a-f]+\.[a-z0-9._~!$&'()*+,;=:-]+\]$/i.test(host)) return true;
  if (!/^\[[0-9a-f:.]+\]$/i.test(host)) return false;
  try {
    return new URL("http://" + host).hostname.startsWith("[");
  } catch {
    return false;
  }
}

export type ValidationScope =
  | "container"
  | "core"
  | "content"
  | "presentation"
  | "publication"
  | "portability";
export class MdkValidationError extends Error {
  constructor(
    readonly scope: ValidationScope,
    readonly status: "fail" | "unverified",
    readonly code: string,
    message: string,
    readonly path?: string,
    readonly field?: string,
  ) {
    super(message);
  }
}
function core(file: string, field: string, message: string): never {
  throw new MdkValidationError(
    "core",
    "fail",
    "mdk.core.invalid",
    message,
    file,
    field,
  );
}
const latinMode = { default: "00", book: "01", comic: "02" } as const;
export type V2Mode = keyof typeof latinMode;
export function modeName(mode: string): V2Mode {
  const name = (Object.keys(latinMode) as V2Mode[]).find(
    (key) => latinMode[key] === mode || key === mode,
  );
  if (!name)
    core("mdk.toml", "mode", t("MDK v2 只支持 default、book 和 comic。"));
  return name;
}

export function inspectManifest(value: Table) {
  if (value.format_version !== 2n)
    core(
      "mdk.toml",
      "format_version",
      t("format_version 必须为 TOML 整数 2。"),
    );
  if (!validId(value.project_id))
    core("mdk.toml", "project_id", t("无效的工程 ID。"));
  const name = value.mode === undefined ? "default" : value.mode;
  if (typeof name !== "string" || !Object.hasOwn(latinMode, name))
    core("mdk.toml", "mode", t("MDK v2 只支持 default、book 和 comic。"));
  if (value.extensions !== undefined && !isTable(value.extensions))
    core("mdk.toml", "extensions", t("extensions 必须为表。"));
  const metadata = value.metadata;
  if (metadata !== undefined && !isTable(metadata))
    core("mdk.toml", "metadata", t("metadata 必须为表。"));
  if (metadata) {
    for (const key of [
      "title",
      "publisher",
      "language",
      "identifier",
      "cover",
    ] as const)
      if (metadata[key] !== undefined && !title(metadata[key]))
        core("mdk.toml", "metadata." + key, t("无效的作品信息。"));
    for (const key of ["description", "rights"] as const)
      if (metadata[key] !== undefined && typeof metadata[key] !== "string")
        core("mdk.toml", "metadata." + key, t("无效的作品信息。"));
    if (
      metadata.creators !== undefined &&
      (!Array.isArray(metadata.creators) || !metadata.creators.every(title))
    )
      core("mdk.toml", "metadata.creators", t("创作者必须为非空名称的数组。"));
    if (
      typeof metadata.language === "string" &&
      !validLanguageTag(metadata.language)
    )
      core("mdk.toml", "metadata.language", t("作品语言必须是 BCP 47 标签。"));
    if (
      typeof metadata.identifier === "string" &&
      !validIdentifier(metadata.identifier)
    )
      core(
        "mdk.toml",
        "metadata.identifier",
        t("作品标识必须是无片段的绝对 URI。"),
      );
    if (typeof metadata.cover === "string") {
      try {
        validatePath(metadata.cover);
        if (!metadata.cover.startsWith("resources/")) throw new Error();
      } catch {
        core(
          "mdk.toml",
          "metadata.cover",
          t("封面必须指向 resources/ 下的资源。"),
        );
      }
    }
  }
  const features = value.features;
  if (features !== undefined && !isTable(features))
    core("mdk.toml", "features", t("features 必须为表。"));
  const seen = new Set<string>();
  const read = (key: "required" | "optional"): string[] => {
    const tokens = features?.[key] ?? [];
    if (!Array.isArray(tokens))
      core("mdk.toml", "features." + key, t("能力声明必须为字符串数组。"));
    for (const token of tokens) {
      if (!validFeatureToken(token) || seen.has(token.split("@")[0]))
        core(
          "mdk.toml",
          "features." + key,
          t("能力标识无效、重复或版本冲突。"),
        );
      seen.add(token.split("@")[0]);
    }
    return tokens;
  };
  return {
    mode: latinMode[name as V2Mode],
    projectId: value.project_id,
    metadata,
    required: read("required"),
    optional: read("optional"),
  };
}

export interface V2Document extends Table {
  id: string;
  path: string;
  title?: string;
}
export interface V2Node extends Table {
  id: string;
  kind: "group" | "document";
  parent?: string;
  order: number;
  document?: string;
  title?: string;
}
export function inspectOutline(raw: Table) {
  const documents = raw.documents ?? [],
    nodes = raw.nodes ?? [];
  if (!Array.isArray(documents) || !Array.isArray(nodes))
    core("contents.toml", "documents/nodes", t("正文和目录节点必须为表数组。"));
  if (raw.extensions !== undefined && !isTable(raw.extensions))
    core("contents.toml", "extensions", t("extensions 必须为表。"));
  const documentById = new Map<string, V2Document>(),
    paths = new Set<string>();
  for (const [index, item] of documents.entries()) {
    const field = "documents." + index;
    if (
      !isTable(item) ||
      !validId(item.id) ||
      documentById.has(item.id) ||
      typeof item.path !== "string" ||
      !item.path.startsWith("markdown/") ||
      !item.path.endsWith(".md") ||
      paths.has(item.path) ||
      (item.title !== undefined && !title(item.title)) ||
      (item.extensions !== undefined && !isTable(item.extensions))
    )
      core("contents.toml", field, t("正文登记无效或具有重复的 ID／路径。"));
    try {
      validatePath(item.path);
    } catch {
      core("contents.toml", field + ".path", t("正文路径无效。"));
    }
    documentById.set(item.id, item as V2Document);
    paths.add(item.path);
  }
  const nodesById = new Map<string, V2Node>(),
    siblings = new Map<string, V2Node[]>();
  const siblingKeys = new Map<string, Set<number>>();
  for (const [index, item] of nodes.entries()) {
    const field = "nodes." + index;
    if (
      !isTable(item) ||
      !validId(item.id) ||
      nodesById.has(item.id) ||
      (item.parent !== undefined && !validId(item.parent)) ||
      typeof item.order !== "bigint" ||
      item.order < 1n ||
      item.order > BigInt(MAX_ORDER) ||
      (item.title !== undefined && !title(item.title)) ||
      (item.extensions !== undefined && !isTable(item.extensions)) ||
      !(item.kind === "document"
        ? validId(item.document) && documentById.has(item.document)
        : item.kind === "group" &&
          item.document === undefined &&
          title(item.title))
    )
      core("contents.toml", field, t("目录节点或引用无效。"));
    const node = { ...item, order: Number(item.order) } as V2Node;
    const parent = node.parent ?? "";
    const keys = siblingKeys.get(parent) ?? new Set<number>();
    if (keys.has(node.order))
      core("contents.toml", field + ".order", t("同级顺序键不能重复。"));
    keys.add(node.order);
    siblingKeys.set(parent, keys);
    const group = siblings.get(parent) ?? [];
    group.push(node);
    siblings.set(parent, group);
    nodesById.set(node.id, node);
  }
  for (const node of nodesById.values())
    if (node.parent !== undefined && !nodesById.has(node.parent))
      core(
        "contents.toml",
        "nodes." + node.id + ".parent",
        t("目录节点的父节点不存在。"),
      );
  for (const group of siblings.values())
    group.sort((a, b) => a.order - b.order);
  const entries: MdkEntry[] = [];
  function visit(parent: string, prefix: string, depth: number) {
    const children = siblings.get(parent) ?? [];
    if (children.length && depth > MAX_OUTLINE_DEPTH)
      throw new MdkValidationError(
        "core",
        "unverified",
        "mdk.limit.exceeded",
        t("目录超过实现支持的 128 层。"),
        "contents.toml",
        "nodes",
      );
    for (const [index, node] of children.entries()) {
      const position = prefix + (index + 1);
      const document =
        node.document === undefined
          ? undefined
          : documentById.get(node.document);
      entries.push({
        id: node.id,
        path: document?.path ?? "",
        position,
        kind: node.kind,
        parent: node.parent,
        order: node.order,
        documentId: node.document,
        title: node.title ?? document?.title,
        extensions: node.extensions as Table | undefined,
      });
      visit(node.id, position + ".", depth + 1);
    }
  }
  visit("", "", 1);
  if (entries.length !== nodesById.size)
    core("contents.toml", "nodes", t("目录包含循环关系。"));
  return {
    documents: [...documentById.values()],
    nodes: [...nodesById.values()],
    entries,
  };
}

// Positions are view coordinates. Persist only node IDs, parent IDs and sibling keys.
export function applyOutline(
  raw: Table,
  entries: MdkEntry[],
  newId: () => string,
): Table {
  if (entries.some(({ position }) => !validOutlinePosition(position)))
    core("contents.toml", "nodes", t("目录位置无效。"));
  const previous = inspectOutline(raw);
  const documents = new Map(
    previous.documents.map((document) => [document.id, document]),
  );
  const byPath = new Map(
    previous.documents.map((document) => [document.path, document.id]),
  );
  const oldNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const byPosition = new Map(
    entries.map((entry) => [entry.position, entry.id]),
  );
  if (byPosition.size !== entries.length)
    core("contents.toml", "nodes", t("目录位置重复。"));
  const groups = new Map<string, { entry: MdkEntry; record: Table }[]>();
  for (const entry of [...entries].sort((a, b) =>
    comparePosition(a.position, b.position),
  )) {
    const parentPosition = entry.position.split(".").slice(0, -1).join(".");
    const parent = byPosition.get(parentPosition);
    if (parentPosition && !parent)
      core("contents.toml", "nodes", t("父节点不存在。"));
    const old = oldNodes.get(entry.id);
    const kind = entry.kind ?? old?.kind ?? "document";
    const record: Table = { ...old, id: entry.id, kind };
    if (parent) record.parent = parent;
    else delete record.parent;
    if (kind === "document") {
      const id =
        entry.documentId ?? old?.document ?? byPath.get(entry.path) ?? newId();
      const document = documents.get(id);
      if (!document || document.path !== entry.path)
        documents.set(id, { ...document, id, path: entry.path });
      byPath.set(entry.path, id);
      record.document = id;
    }
    if (
      entry.title !== undefined &&
      (kind === "group" ||
        entry.title !== documents.get(String(record.document))?.title)
    )
      record.title = entry.title;
    if (entry.extensions !== undefined) record.extensions = entry.extensions;
    const siblings = groups.get(parent ?? "") ?? [];
    siblings.push({ entry, record });
    groups.set(parent ?? "", siblings);
  }
  const nodes = [...groups.values()].flatMap((siblings) => {
    let last = 0;
    const stable = siblings.every(({ entry, record }) => {
      const old = oldNodes.get(entry.id);
      if (!old || old.parent !== record.parent || old.order <= last)
        return false;
      last = old.order;
      return true;
    });
    return siblings.map(({ entry, record }, index) => ({
      ...record,
      order: BigInt(stable ? oldNodes.get(entry.id)!.order : index + 1),
    }));
  });
  const result = { ...raw, documents: [...documents.values()], nodes };
  inspectOutline(result);
  return result;
}
