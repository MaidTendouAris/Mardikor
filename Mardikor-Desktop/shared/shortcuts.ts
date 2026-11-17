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
const visualShortcuts = [
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

// These native Tiptap bindings must not run behind an overridden binding.
export const visualNativeKeys = new Set<string>([
  ...formattingShortcuts.map(({ key }) => key),
  "Ctrl+Shift+B",
  "Ctrl+Shift+I",
  ...[0, ...headingLevels].map((level) => `Ctrl+Alt+${level}`),
]);

export type ShortcutOverrides = Partial<
  Record<(typeof shortcuts)[number]["id"], string | null>
>;

export function shortcutKey(
  action: (typeof shortcuts)[number],
  overrides?: ShortcutOverrides,
) {
  const binding = overrides?.[action.id];
  return binding === undefined ? action.key : binding;
}

const validBinding =
  /^Ctrl\+(?:Shift\+)?(?:Alt\+)?(?:[A-Z0-9\\]|F(?:[1-9]|1[0-2]))$/;
const reservedBinding =
  /^(?:Ctrl\+(?:A|C|F|K|U|V|X|Y|Z)|Ctrl\+Shift\+(?:V|Z))$/;

export function migrateShortcuts(
  value: unknown,
): ShortcutOverrides | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const overrides = { ...value } as ShortcutOverrides;
  const explicitKeys = new Set(Object.values(overrides));
  for (const action of formattingShortcuts)
    if (overrides[action.id] === undefined && explicitKeys.has(action.key))
      overrides[action.id] = null;
  if (!shortcutError(overrides)) return overrides;
}

export function shortcutError(value: unknown): string | undefined {
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
    const key = shortcutKey(action, value as ShortcutOverrides);
    if (!key) continue;
    if (reservedBinding.test(key)) return t("{0} 已用于编辑器内置操作。", key);
    const other = used.get(key);
    if (other)
      return t("{0} 已同时分配给「{1}」和「{2}」。", key, other, action.label);
    used.set(key, action.label);
  }
}

export function shortcutFromEvent(event: KeyboardEvent) {
  if (
    !(event.ctrlKey || event.metaKey) ||
    event.isComposing ||
    event.key === "Process" ||
    event.getModifierState("AltGraph")
  )
    return;
  const key =
    /^(?:Key|Digit|Numpad)([A-Z0-9])$/.exec(event.code)?.[1] ??
    (event.code === "Backslash" ? "\\" : event.key.toUpperCase());
  const chord = `Ctrl+${event.shiftKey ? "Shift+" : ""}${event.altKey ? "Alt+" : ""}${key}`;
  if (validBinding.test(chord)) return chord;
}
