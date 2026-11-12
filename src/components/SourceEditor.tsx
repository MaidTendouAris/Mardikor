import { t } from "../../shared/i18n";
import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { EditorDialog } from "./EditorMenu";
import { Select } from "./Select";
import {
  markdownInsertion,
  markdownSyntax,
} from "../../shared/markdown-editing";
import type { InsertionDraft } from "../../shared/resources";
import { lineStarts, lowerBound, searchPosition, type FindMatches, type SearchHit } from "../services/document-find";
import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all.js";
import "monaco-editor/languages/definitions/markdown/register.js";
import "monaco-editor/languages/definitions/xml/register.js";
import "monaco-editor/languages/definitions/yaml/register.js";
import "monaco-editor/languages/features/json/register.js";
import { language as iniLanguage } from "monaco-editor/languages/definitions/ini/ini.js";
import EditorWorker from "monaco-editor/editor/editor.worker?worker&inline";
import JsonWorker from "monaco-editor/languages/features/json/json.worker?worker&inline";
import { stringify } from "smol-toml";
import { defaultSettings } from "../../shared/defaults";
import { validateSourceText } from "../../shared/schema";
import type { ProjectFile } from "../../shared/mdk";
import type { ResolvedAppTheme } from "../../shared/desktop";

(
  globalThis as typeof globalThis & { MonacoEnvironment: monaco.Environment }
).MonacoEnvironment = {
  getWorker: (_moduleId, label) =>
    label === "json" ? new JsonWorker() : new EditorWorker(),
};
monaco.editor.defineTheme("mdk-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6b7f9e" },
    { token: "number", foreground: "2563eb" },
    { token: "metatag", foreground: "315b9e" },
  ],
  colors: {
    "editor.background": "#ffffff",
    "editorCursor.foreground": "#2563eb",
    "editor.selectionBackground": "#dbeafe",
  },
});
monaco.editor.defineTheme("mdk-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [{ token: "comment", foreground: "a6a6a6" }],
  colors: {
    "editor.background": "#141414",
    "editor.foreground": "#d4d4d4",
    "editorCursor.foreground": "#d4d4d4",
    "editor.selectionBackground": "#383838",
    "editor.inactiveSelectionBackground": "#2a2a2a",
    "editor.lineHighlightBorder": "#2b2b2b",
  },
});
monaco.editor.defineTheme("mdk-warm", {
  base: "vs",
  inherit: true,
  rules: [{ token: "comment", foreground: "675748" }],
  colors: {
    "editor.background": "#f8f2e5",
    "editor.foreground": "#443a2d",
    "editorCursor.foreground": "#2563eb",
    "editor.selectionBackground": "#dbeafe",
  },
});
monaco.languages.register({ id: "toml", extensions: [".toml"] });
monaco.languages.setMonarchTokensProvider("toml", iniLanguage);
monaco.languages.setLanguageConfiguration("toml", {
  comments: { lineComment: "#" },
  brackets: [
    ["[", "]"],
    ["{", "}"],
  ],
  autoClosingPairs: [
    { open: "[", close: "]" },
    { open: "{", close: "}" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
});
monaco.languages.registerCompletionItemProvider("toml", {
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    return {
      suggestions: [
        {
          label: "schema_version",
          insertText: "schema_version = 1",
          kind: monaco.languages.CompletionItemKind.Property,
          range,
        },
        {
          label: "entries",
          insertText:
            '[[entries]]\nid = "${1:id}"\npath = "markdown/${2:001.md}"\nposition = "${3:1}"',
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          kind: monaco.languages.CompletionItemKind.Snippet,
          range,
        },
        {
          label: t("MDK 默认设置"),
          insertText: stringify(defaultSettings()),
          kind: monaco.languages.CompletionItemKind.Snippet,
          range,
        },
      ],
    };
  },
});
const language = (path: string) =>
  /\.md$/i.test(path)
    ? "markdown"
    : /\.toml$/i.test(path)
      ? "toml"
      : /\.json$/i.test(path)
        ? "json"
        : /\.(svg|xml|html)$/i.test(path)
          ? "xml"
          : /\.ya?ml$/i.test(path)
            ? "yaml"
            : "plaintext";

export interface SourceEditorHandle {
  insertMarkdown: (text: string) => void;
  focus: () => void;
  scrollTo: (ratio: number) => void;
  dropDraft: (x: number, y: number, marker: string) => InsertionDraft;
  applyValue: (content: string) => void;
  firstVisibleLine: () => number;
}
export function ConflictDiff({
  path,
  disk,
  local,
  theme,
}: {
  path: string;
  disk: string;
  local: string;
  theme: ResolvedAppTheme;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const original = monaco.editor.createModel(disk, language(path));
    const modified = monaco.editor.createModel(local, language(path));
    const editor = monaco.editor.createDiffEditor(host.current!, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      minimap: { enabled: false },
      maxComputationTime: 2000,
    });
    editor.setModel({ original, modified });
    return () => {
      editor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [path, disk, local]);
  useEffect(() => {
    monaco.editor.setTheme(`mdk-${theme}`);
  }, [theme]);
  return <div className="disk-diff" ref={host} />;
}
export interface SourceModelPool {
  id: string;
  models: Map<string, monaco.editor.ITextModel>;
}
const modelText = new WeakMap<
  monaco.editor.ITextModel,
  { version: number; value: string }
>();
function readModel(model: monaco.editor.ITextModel) {
  const version = model.getVersionId();
  const cached = modelText.get(model);
  if (cached?.version === version) return cached.value;
  const value = model.getValue(
    monaco.editor.EndOfLinePreference.TextDefined,
    true,
  );
  modelText.set(model, { version, value });
  return value;
}
export const SourceEditor = forwardRef<
  SourceEditorHandle,
  {
    path: string;
    value: string;
    files: ProjectFile[];
    readOnly: boolean;
    theme: ResolvedAppTheme;
    zoom: number;
    largeDocument?: boolean;
    onChange: (value: string) => void;
    onPosition: (line: number, column: number) => void;
    onScroll?: (ratio: number, firstLine: number) => void;
    onViewportReady?: () => void;
    reveal?: { path: string; line: number; key: number };
    findReveal?: SearchHit;
    findMatches?: FindMatches;
    modelPool?: SourceModelPool;
  }
>(function SourceEditor(
  {
    path,
    value,
    files,
    readOnly,
    theme,
    zoom,
    largeDocument,
    onChange,
    onPosition,
    onScroll,
    onViewportReady,
    reveal,
    findReveal,
    findMatches,
    modelPool,
  },
  ref,
) {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(
    modelPool?.models ?? new Map<string, monaco.editor.ITextModel>(),
  );
  const views = useRef(new Map<string, monaco.editor.ICodeEditorViewState>());
  function release(path: string, model: monaco.editor.ITextModel | null) {
    if (
      !model ||
      monaco.editor.getEditors().some((item) => item.getModel() === model)
    )
      return;
    if (models.current.get(path) === model) models.current.delete(path);
    if (!model.isDisposed()) model.dispose();
  }
  const selected = useRef("");
  const updating = useRef(false);
  const changingModel = useRef(false);
  const session = useRef(modelPool?.id ?? crypto.randomUUID());
  const markdownKey = useRef<monaco.editor.IContextKey<boolean>>(null);
  const [palette, setPalette] = useState(false);
  const [syntaxId, setSyntaxId] = useState("heading1");
  function insertMarkdown(
    text: string,
    range?: monaco.IRange,
    placeholder?: string,
  ) {
    const editor = instance.current,
      model = editor?.getModel();
    if (
      !editor ||
      !model ||
      editor.getOption(monaco.editor.EditorOption.readOnly)
    )
      return;
    const target = range ?? editor.getSelection()!;
    const offset = model.getOffsetAt({
      lineNumber: target.startLineNumber,
      column: target.startColumn,
    });
    editor.pushUndoStop();
    editor.executeEdits("markdown-command", [{ range: target, text }]);
    editor.pushUndoStop();
    const start = placeholder ? text.indexOf(placeholder) : -1;
    const from = model.getPositionAt(
      offset + (start >= 0 ? start : text.length),
    );
    const to = model.getPositionAt(
      offset + (start >= 0 ? start + placeholder!.length : text.length),
    );
    editor.setSelection(
      new monaco.Selection(
        from.lineNumber,
        from.column,
        to.lineNumber,
        to.column,
      ),
    );
    editor.revealPositionInCenterIfOutsideViewport(to);
    editor.focus();
  }
  function runMarkdown(id: string) {
    const editor = instance.current,
      model = editor?.getModel();
    if (!editor || !model) return;
    let range: monaco.IRange = editor.getSelection()!;
    const block =
      /^heading[1-6]$/.test(id) ||
      ["quote", "bullet", "ordered", "task"].includes(id);
    if (block)
      range = new monaco.Range(
        range.startLineNumber,
        1,
        range.endLineNumber,
        model.getLineMaxColumn(range.endLineNumber),
      );
    const selected = model.getValueInRange(range);
    const insertion = id === "break" ? "  \n" : markdownInsertion(id, selected);
    insertMarkdown(
      [
        "fence",
        "indented-code",
        "table",
        "rule",
        "reference",
        "reference-image",
        "html",
        "setext",
      ].includes(id)
        ? "\n\n" + insertion + "\n\n"
        : insertion,
      range,
      selected ? undefined : id === "fence" ? t("代码") : t("文字"),
    );
  }
  const callbacks = useRef({
    onChange,
    onPosition,
    onScroll,
    onViewportReady,
    files,
    path,
  });
  useImperativeHandle(
    ref,
    () => ({
      insertMarkdown,
      focus() {
        instance.current?.focus();
      },
      scrollTo(ratio) {
        const editor = instance.current;
        if (editor)
          editor.setScrollTop(
            Math.max(
              0,
              editor.getScrollHeight() - editor.getLayoutInfo().height,
            ) * ratio,
            monaco.editor.ScrollType.Immediate,
          );
      },
      firstVisibleLine() {
        return instance.current?.getVisibleRanges()[0]?.startLineNumber ?? 1;
      },
      dropDraft(x, y, marker) {
        const editor = instance.current,
          model = editor?.getModel();
        if (!editor || !model) throw new Error(t("源码编辑器尚未就绪。"));
        const point =
          editor.getTargetAtClientPoint(x, y)?.position ??
          editor.getPosition()!;
        const content = model.getValue(
            monaco.editor.EndOfLinePreference.TextDefined,
            true,
          ),
          offset =
            model.getOffsetAt(point) + (content.startsWith("\ufeff") ? 1 : 0);
        return {
          content:
            content.slice(0, offset) +
            "\n\n" +
            marker +
            "\n\n" +
            content.slice(offset),
          marker,
        };
      },
      applyValue(content) {
        const editor = instance.current,
          model = editor?.getModel();
        if (!editor || !model) return;
        // Authorized programmatic changes also run while the view is locked
        // during an atomic import or view switch. Edit the shared model so the
        // operation is retained on its undo stack even when the view is readonly.
        model.pushStackElement();
        model.pushEditOperations(
          editor.getSelections(),
          [
            {
              range: model.getFullModelRange(),
              text:
                content.startsWith("\ufeff") &&
                model
                  .getValue(monaco.editor.EndOfLinePreference.TextDefined, true)
                  .startsWith("\ufeff")
                  ? content.slice(1)
                  : content,
            },
          ],
          () => null,
        );
        model.pushStackElement();
      },
    }),
    [],
  );
  callbacks.current = {
    onChange,
    onPosition,
    onScroll,
    onViewportReady,
    files,
    path,
  };
  const diagnostics = (model: monaco.editor.ITextModel) => {
    const source = callbacks.current;
    try {
      validateSourceText(
        source.path,
        model.getValue(monaco.editor.EndOfLinePreference.TextDefined, true),
        new Set(
          source.files.filter((f) => f.kind !== "directory").map((f) => f.path),
        ),
      );
      monaco.editor.setModelMarkers(model, "mdk", []);
    } catch (error) {
      const issue = error as {
        message: string;
        line?: number;
        column?: number;
      };
      const line = Math.min(model.getLineCount(), Math.max(1, issue.line ?? 1));
      monaco.editor.setModelMarkers(model, "mdk", [
        {
          severity: monaco.MarkerSeverity.Error,
          message: issue.message,
          startLineNumber: line,
          endLineNumber: line,
          startColumn: issue.column ?? 1,
          endColumn: model.getLineMaxColumn(line),
        },
      ]);
    }
  };
  useEffect(() => {
    const editor = monaco.editor.create(element.current!, {
      model: null,
      automaticLayout: true,
      fontSize: Math.round((14 * zoom) / 100),
      fontFamily: 'Consolas, "Cascadia Code", monospace',
      minimap: { enabled: false },
      lineNumbers: "on",
      folding: true,
      bracketPairColorization: { enabled: false },
      wordWrap: largeDocument ? "off" : "on",
      unicodeHighlight: { ambiguousCharacters: false },
      renderWhitespace: "selection",
      scrollBeyondLastLine: false,
      ariaLabel: t("源码编辑器"),
      // Monaco's forced screen reader mode sends entire visible lines to the
      // input surface. In auto mode it bounds that text unless a reader is active.
      accessibilitySupport: largeDocument ? "auto" : "on",
      readOnly: false,
      tabSize: 2,
      insertSpaces: true,
      contextmenu: true,
      padding: { top: 16, bottom: 16 },
      fixedOverflowWidgets: true,
    });
    instance.current = editor;
    markdownKey.current = editor.createContextKey("mdkMarkdown", false);
    const actions = [
      editor.addAction({
        id: "mdk.markdown.syntax",
        label: t("插入 Markdown 语法…"),
        precondition: "mdkMarkdown && !editorReadonly",
        contextMenuGroupId: "9_markdown",
        contextMenuOrder: 1,
        run: () => setPalette(true),
      }),
      ...[
        { id: "bold", label: t("Markdown 加粗"), key: monaco.KeyCode.KeyB },
        { id: "italic", label: t("Markdown 斜体"), key: monaco.KeyCode.KeyI },
        { id: "link", label: t("Markdown 链接") },
        { id: "fence", label: t("Markdown 代码块") },
        { id: "table", label: t("Markdown 表格") },
      ].map((action, index) =>
        editor.addAction({
          id: "mdk.markdown." + action.id,
          label: action.label,
          precondition: "mdkMarkdown && !editorReadonly",
          contextMenuGroupId: "9_markdown",
          contextMenuOrder: index + 2,
          ...(action.key
            ? { keybindings: [monaco.KeyMod.CtrlCmd | action.key] }
            : {}),
          run: () => runMarkdown(action.id),
        }),
      ),
    ];
    const change = editor.onDidChangeModelContent(() => {
      if (updating.current) return;
      const model = editor.getModel();
      if (!model) return;
      callbacks.current.onChange(readModel(model));
      diagnostics(model);
    });
    const cursor = editor.onDidChangeCursorPosition((e) =>
      callbacks.current.onPosition(e.position.lineNumber, e.position.column),
    );
    const scroll = editor.onDidScrollChange((e) => {
      if (!e.scrollTopChanged || changingModel.current) return;
      const range = editor.getScrollHeight() - editor.getLayoutInfo().height;
      if (range > 0)
        callbacks.current.onScroll?.(
          editor.getScrollTop() / range,
          editor.getVisibleRanges()[0]?.startLineNumber ?? 1,
        );
    });
    return () => {
      change.dispose();
      cursor.dispose();
      scroll.dispose();
      actions.forEach((action) => action.dispose());
      const model = editor.getModel();
      editor.dispose();
      instance.current = null;
      views.current.clear();
      release(selected.current, model);
      if (!modelPool) {
        models.current.forEach((model) => model.dispose());
        models.current.clear();
      }
    };
  }, []);
  useEffect(() => {
    monaco.editor.setTheme(`mdk-${theme}`);
  }, [theme]);
  useEffect(() => {
    const editor = instance.current;
    if (!editor || !path) return;
    markdownKey.current?.set(language(path) === "markdown");
    if (selected.current !== path) {
      const previousPath = selected.current;
      const previousModel = editor.getModel();
      const previous = editor.saveViewState();
      if (previous) views.current.set(selected.current, previous);
      if (views.current.size > 32)
        views.current.delete(views.current.keys().next().value!);
      let model = models.current.get(path);
      if (!model) {
        model = monaco.editor.createModel(
          value,
          language(path),
          monaco.Uri.from({
            scheme: "mdk",
            authority: session.current,
            path: "/" + path,
          }),
        );
        models.current.set(path, model);
        model.onWillDispose(() => modelText.delete(model!));
        modelText.set(model, { version: model.getVersionId(), value });
      }
      selected.current = path;
      changingModel.current = true;
      editor.setModel(model);
      release(previousPath, previousModel);
      const view = views.current.get(path);
      if (view) editor.restoreViewState(view);
      const position = editor.getPosition();
      if (position)
        callbacks.current.onPosition(position.lineNumber, position.column);
      changingModel.current = false;
      callbacks.current.onViewportReady?.();
    }
    const model = editor.getModel();
    if (model && readModel(model) !== value) {
      // Loading or refreshing a model must never mark an untouched source dirty.
      // Monaco internally normalizes mixed line endings, while the saved buffer
      // retains the original bytes until an actual user edit.
      updating.current = true;
      try {
        model.setValue(value);
        modelText.set(model, { version: model.getVersionId(), value });
      } finally {
        updating.current = false;
      }
    }
    if (model) diagnostics(model);
  }, [path, value, files]);
  useEffect(() => {
    instance.current?.updateOptions({ readOnly });
    // The source view stays mounted while hidden. Lay it out immediately when
    // activated, before keyboard selection uses stale wrapped-line geometry.
    if (!readOnly) instance.current?.layout();
  }, [readOnly]);
  useEffect(() => {
    instance.current?.updateOptions({
      fontSize: Math.round((14 * zoom) / 100),
    });
  }, [zoom]);
  useEffect(() => {
    instance.current?.updateOptions({
      wordWrap: largeDocument ? "off" : "on",
      accessibilitySupport: largeDocument ? "auto" : "on",
    });
  }, [largeDocument]);
  useEffect(() => {
    if (!reveal || reveal.path !== path || !instance.current) return;
    const line = Math.min(
      reveal.line,
      instance.current.getModel()?.getLineCount() ?? 1,
    );
    instance.current.setPosition({ lineNumber: line, column: 1 });
    instance.current.revealLineInCenter(line);
    instance.current.focus();
  }, [reveal, path]);
  useEffect(() => {
    const editor = instance.current;
    const model = editor?.getModel();
    if (
      !editor || !model || findMatches?.document.path !== path ||
      findMatches.document.content !== value
    ) return;
    const { offsets, length } = findMatches;
    const lines = lineStarts(value);
    const position = (offset: number) => {
      const line = lowerBound(lines.length, (index) => lines[index] > offset);
      const bom = line === 1 && value.charCodeAt(0) === 0xfeff ? 1 : 0;
      return { lineNumber: line, column: offset - lines[line - 1] - bom + 1 };
    };
    const marks = editor.createDecorationsCollection();
    let paintedFrom = -1, paintedTo = -1;
    function paint(from: number, to: number) {
      if (from === paintedFrom && to === paintedTo) return;
      paintedFrom = from;
      paintedTo = to;
      marks.set(offsets.slice(from, to).map((offset) => ({
        range: monaco.Range.fromPositions(position(offset), position(offset + length)),
        options: { inlineClassName: "document-find-match" },
      })));
    }
    let scroll: monaco.IDisposable | undefined;
    let layout: monaco.IDisposable | undefined;
    if (offsets.length > 4096) {
      const update = () => {
        if (editor.getModel() !== model) return;
        const visible = editor.getVisibleRanges();
        if (!visible.length) return;
        const start = lines[Math.max(0, visible[0].startLineNumber - 25)];
        const end = lines[visible.at(-1)!.endLineNumber + 24] ?? value.length;
        paint(
          lowerBound(offsets.length, (index) => offsets[index] + length > start),
          lowerBound(offsets.length, (index) => offsets[index] >= end),
        );
      };
      update();
      scroll = editor.onDidScrollChange(update);
      layout = editor.onDidLayoutChange(update);
    } else paint(0, offsets.length);
    return () => {
      scroll?.dispose();
      layout?.dispose();
      if (editor.getModel()) marks.clear();
    };
  }, [findMatches, path, value]);
  useEffect(() => {
    const editor = instance.current;
    const model = editor?.getModel();
    if (!editor || !model || findReveal?.path !== path || findReveal.content !== value)
      return;
    const start = searchPosition(value, findReveal.start);
    const end = searchPosition(value, findReveal.end);
    const range = monaco.Range.fromPositions(start, end);
    const marks = editor.createDecorationsCollection([{
      range,
      options: { inlineClassName: "document-find-current" },
    }]);
    const frame = requestAnimationFrame(() => {
      editor.layout();
      editor.revealRangeInCenter(range);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (editor.getModel()) marks.clear();
    };
  }, [findReveal, path, value]);
  useEffect(() => {
    if (readOnly) setPalette(false);
  }, [readOnly, path]);
  return (
    <>
      <div className="monaco-source" ref={element} data-file={path} />
      {palette && (
        <EditorDialog
          title={t("插入 Markdown 语法")}
          onClose={() => {
            setPalette(false);
            instance.current?.focus();
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPalette(false);
              runMarkdown(syntaxId);
            }}
          >
            <label>
              {t("语法")}
              <Select
                aria-label={t("Markdown 语法")}
                value={syntaxId}
                onValueChange={setSyntaxId}
              >
                {[...new Set(markdownSyntax.map((s) => s.group))].map(
                  (group) => (
                    <optgroup key={group} label={group}>
                      {markdownSyntax
                        .filter((s) => s.group === group)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                    </optgroup>
                  ),
                )}
              </Select>
            </label>
            <pre className="syntax-example">
              {markdownSyntax.find((s) => s.id === syntaxId)?.example}
            </pre>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  setPalette(false);
                  instance.current?.focus();
                }}
              >
                {t("取消")}
              </button>
              <button className="button primary" type="submit">
                {t("插入")}
              </button>
            </div>
          </form>
        </EditorDialog>
      )}
    </>
  );
});
