import { t } from "./i18n";
export const headingLevels = [1, 2, 3, 4, 5, 6] as const;

export const formattingShortcuts = [
  {
    id: "bold",
    get label() {
      return t("加粗");
    },
    key: "Ctrl+B",
    command: "toggleBold",
  },
  {
    id: "italic",
    get label() {
      return t("斜体");
    },
    key: "Ctrl+I",
    command: "toggleItalic",
  },
  {
    id: "strike",
    get label() {
      return t("删除线");
    },
    key: "Ctrl+Shift+S",
    macKey: "Ctrl+Shift+X",
    command: "toggleStrike",
  },
  {
    id: "inlineCode",
    get label() {
      return t("行内代码");
    },
    key: "Ctrl+E",
    command: "toggleCode",
  },
  {
    id: "codeBlock",
    get label() {
      return t("代码块");
    },
    key: "Ctrl+Alt+C",
    command: "toggleCodeBlock",
    block: true,
  },
  {
    id: "quote",
    get label() {
      return t("引用");
    },
    key: "Ctrl+Shift+Q",
    macKey: "Ctrl+Shift+B",
    command: "toggleBlockquote",
    block: true,
  },
  {
    id: "orderedList",
    get label() {
      return t("有序列表");
    },
    key: "Ctrl+Shift+7",
    command: "toggleOrderedList",
    block: true,
  },
  {
    id: "bulletList",
    get label() {
      return t("无序列表");
    },
    key: "Ctrl+Shift+8",
    command: "toggleBulletList",
    block: true,
  },
  {
    id: "taskList",
    get label() {
      return t("任务列表");
    },
    key: "Ctrl+Shift+9",
    command: "toggleTaskList",
    block: true,
  },
  {
    id: "rule",
    get label() {
      return t("分隔线");
    },
    key: "Ctrl+Alt+R",
    command: "setHorizontalRule",
    block: true,
  },
] as const;

function visualTool<const Id extends string>(
  id: Id,
  label: Parameters<typeof t>[0],
  key: string | null = null,
) {
  return {
    id,
    get label() {
      return t(label);
    },
    labelKey: label,
    key,
    tool: true as const,
  };
}

export const tableShortcuts = [
  visualTool("row-before", "上方插入行"),
  visualTool("row-after", "下方插入行"),
  visualTool("column-before", "左侧插入列"),
  visualTool("column-after", "右侧插入列"),
  visualTool("row-delete", "删除当前行"),
  visualTool("column-delete", "删除当前列"),
  visualTool("table-delete", "删除表格"),
  visualTool("align-left", "左对齐"),
  visualTool("align-center", "居中"),
  visualTool("align-right", "右对齐"),
  visualTool("align-default", "默认对齐"),
] as const;

export const visualShortcuts = [
  {
    id: "paragraph",
    get label() {
      return t("设为正文");
    },
    key: "Ctrl+0",
    level: 0,
  },
  ...headingLevels.map((level) => ({
    id: `heading${level}` as const,
    get label() {
      return t("设为标题 {0}", level);
    },
    key: `Ctrl+${level}`,
    level,
  })),
  ...formattingShortcuts,
  visualTool("link", "插入或编辑链接", "Ctrl+K"),
  visualTool("unlink", "移除链接", "Ctrl+Shift+K"),
  visualTool("palette", "Markdown 操作", "Ctrl+/"),
  visualTool("image", "插入图片"),
  visualTool("table", "插入表格"),
  visualTool("task-check", "切换当前任务完成状态"),
  visualTool("code-language", "设置代码块语言"),
  visualTool("clear", "清除格式"),
  visualTool("resource", "插入包内资源"),
  ...tableShortcuts,
] as const;
export type VisualShortcut = (typeof visualShortcuts)[number];

export const shortcuts = [
  {
    id: "save",
    get label() {
      return t("保存工程");
    },
    key: "Ctrl+S",
  },
  {
    id: "split",
    get label() {
      return t("向右拆分编辑器");
    },
    key: "Ctrl+\\",
  },
  {
    id: "left",
    get label() {
      return t("切换到左栏");
    },
    key: "Ctrl+Shift+1",
  },
  {
    id: "right",
    get label() {
      return t("切换到右栏");
    },
    key: "Ctrl+Shift+2",
  },
  ...visualShortcuts,
] as const;

export type ShortcutOverrides = Partial<
  Record<(typeof shortcuts)[number]["id"], string | null>
>;
export type ShortcutId = keyof ShortcutOverrides;
export type ShortcutPlatform = "mac" | "other";

export function shortcutPlatform(): ShortcutPlatform {
  return typeof navigator !== "undefined" && /^Mac/i.test(navigator.platform)
    ? "mac"
    : "other";
}

// Chromium can still apply these contenteditable formats without a Tiptap keymap.
export const browserFormatKeys = new Set([
  "Ctrl+B",
  "Ctrl+I",
  "Ctrl+Shift+B",
  "Ctrl+Shift+I",
  "Ctrl+K",
  "Ctrl+Shift+K",
]);

export function isVisualShortcut(
  action: (typeof shortcuts)[number],
): action is VisualShortcut {
  return "level" in action || "command" in action || "tool" in action;
}

export function shortcutKey(
  action: (typeof shortcuts)[number],
  overrides?: ShortcutOverrides,
  platform = shortcutPlatform(),
) {
  const binding = overrides?.[action.id];
  return binding === undefined
    ? platform === "mac" && "macKey" in action
      ? action.macKey
      : action.key
    : binding;
}

export function shortcutLabel(
  key: string | null | undefined,
  platform = shortcutPlatform(),
) {
  if (!key || platform !== "mac") return key ?? undefined;
  return key.replace("Ctrl+", "⌘").replace("Shift+", "⇧").replace("Alt+", "⌥");
}

export function shortcutHint(id: ShortcutId, overrides?: ShortcutOverrides) {
  const action = shortcuts.find((action) => action.id === id)!;
  return shortcutLabel(shortcutKey(action, overrides));
}

const validBinding =
  /^Ctrl\+(?:Shift\+)?(?:Alt\+)?(?:[A-Z0-9/\\]|F(?:[1-9]|1[0-2]))$/;
const reservedBinding = /^(?:Ctrl\+(?:A|C|F|U|V|X|Y|Z)|Ctrl\+Shift\+(?:V|Z))$/;

export function migrateShortcuts(
  value: unknown,
  platform = shortcutPlatform(),
): ShortcutOverrides | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const overrides = { ...value } as ShortcutOverrides;
  const explicitKeys = new Set(Object.values(overrides));
  for (const action of shortcuts) {
    const key = shortcutKey(action, undefined, platform);
    if (key && overrides[action.id] === undefined && explicitKeys.has(key))
      overrides[action.id] = null;
  }
  // An explicit legacy binding for the system logout chord cannot run on Mac.
  if (platform === "mac") {
    for (const action of shortcuts)
      if (overrides[action.id] === "Ctrl+Shift+Q") overrides[action.id] = null;
  }
  if (!shortcutError(overrides, platform)) return overrides;
}

export function shortcutError(
  value: unknown,
  platform = shortcutPlatform(),
): string | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([id, binding]) =>
        !shortcuts.some((action) => action.id === id) ||
        (binding !== null &&
          (typeof binding !== "string" || !validBinding.test(binding))),
    )
  )
    return t("快捷键格式无效。");
  const used = new Map<string, string>();
  for (const action of shortcuts) {
    const key = shortcutKey(action, value as ShortcutOverrides, platform);
    if (!key) continue;
    const label = shortcutLabel(key, platform);
    if (
      reservedBinding.test(key) ||
      (platform === "mac" && key === "Ctrl+Shift+Q")
    )
      return t("{0} 已用于系统或编辑器内置操作。", label);
    const other = used.get(key);
    if (other)
      return t(
        "{0} 已同时分配给「{1}」和「{2}」。",
        label,
        other,
        action.label,
      );
    used.set(key, action.label);
  }
}

export function keyboardComposing(event: KeyboardEvent) {
  return event.isComposing || event.key === "Process" || event.keyCode === 229;
}

export function shortcutFromEvent(
  event: KeyboardEvent,
  platform = shortcutPlatform(),
) {
  const mod =
    platform === "mac"
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
  if (!mod || keyboardComposing(event) || event.getModifierState("AltGraph"))
    return;
  const key =
    /^(?:Key|Digit|Numpad)([A-Z0-9])$/.exec(event.code)?.[1] ??
    (event.code === "Backslash"
      ? "\\"
      : event.code === "Slash"
        ? "/"
        : event.key.toUpperCase());
  const chord = `Ctrl+${event.shiftKey ? "Shift+" : ""}${event.altKey ? "Alt+" : ""}${key}`;
  if (validBinding.test(chord)) return chord;
}
