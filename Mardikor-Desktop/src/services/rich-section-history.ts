import { Extension, type Editor } from "@tiptap/core";
import { history, redo, undo, undoDepth } from "@tiptap/pm/history";
import { Plugin, type EditorState } from "@tiptap/pm/state";

type Checkpoint<View> = { state: EditorState; view: View };

// Each outline move separates two native rich-editing histories. This keeps the
// history on either side independent of which pages are currently materialized.
export function richSectionHistory<View>(
  capture: () => View,
  restore: (view: View) => void,
) {
  const past: Checkpoint<View>[] = [];
  const future: { after: Checkpoint<View>; depth: number }[] = [];
  const nativeHistory = history({ depth: 100 });
  const checkpoint = (editor: Editor): Checkpoint<View> => ({
    state: editor.state,
    view: capture(),
  });

  function traverse(editor: Editor, forward: boolean) {
    if (forward) {
      const { after } = future.pop()!;
      past.push(checkpoint(editor));
      apply(editor, after);
    } else {
      const before = past.pop()!;
      future.push({
        after: checkpoint(editor),
        depth: undoDepth(before.state),
      });
      apply(editor, before);
    }
  }
  function apply(editor: Editor, point: Checkpoint<View>) {
    restore(point.view);
    editor.view.updateState(
      point.state.reconfigure({ plugins: editor.state.plugins }),
    );
    // Notify the toolbar even if restoring the selection didn't require an edit.
    editor.view.dispatch(
      editor.state.tr
        .setMeta("preventUpdate", true)
        .setMeta("addToHistory", false),
    );
  }

  const extension = Extension.create({
    name: "mardikorSectionHistory",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDOMEvents: {
              beforeinput: (_view, event) => {
                const action =
                  event.inputType === "historyUndo"
                    ? "undo"
                    : event.inputType === "historyRedo"
                      ? "redo"
                      : undefined;
                if (!action) return false;
                event.preventDefault();
                return this.editor.commands[action]();
              },
            },
          },
        }),
        nativeHistory,
      ];
    },
    addCommands() {
      return {
        undo:
          () =>
          ({ state, dispatch, tr, editor }) => {
            if (!editor.isEditable) return false;
            if (undoDepth(state) || !past.length) return undo(state, dispatch);
            if (dispatch) {
              tr.setMeta("preventDispatch", true);
              traverse(editor, false);
            }
            return true;
          },
        redo:
          () =>
          ({ state, dispatch, tr, editor }) => {
            if (!editor.isEditable) return false;
            if (future.at(-1)?.depth !== undoDepth(state))
              return redo(state, dispatch);
            if (dispatch) {
              tr.setMeta("preventDispatch", true);
              traverse(editor, true);
            }
            return true;
          },
      };
    },
    addKeyboardShortcuts() {
      return {
        "Mod-z": () => this.editor.commands.undo(),
        "Shift-Mod-z": () => this.editor.commands.redo(),
        "Mod-y": () => this.editor.commands.redo(),
        "Mod-я": () => this.editor.commands.undo(),
        "Shift-Mod-я": () => this.editor.commands.redo(),
      };
    },
  });
  return {
    extension,
    record(editor: Editor) {
      past.push(checkpoint(editor));
      if (past.length > 100) past.shift();
      future.length = 0;
      const { plugins } = editor.state;
      editor.view.updateState(
        editor.state
          .reconfigure({
            plugins: plugins.filter((plugin) => plugin !== nativeHistory),
          })
          .reconfigure({ plugins }),
      );
    },
    branch() {
      future.length = 0;
    },
    clear() {
      past.length = future.length = 0;
    },
  };
}
