# Mardikor Command-Line Guide

`mardikor` reads and edits `.mdk` projects directly. Use it on Linux servers, in terminal scripts, or in AI-assisted writing workflows.

## Installation

- The **Windows installer** adds its `bin` directory to the user or system PATH, depending on the installation scope. Open a new terminal and run `mardikor --version`. You can also run `bin\mardikor.exe` directly from the installation folder.
- **Linux** requires Node.js 22.12 or later. Use the version number of the archive you downloaded.

```sh
npm install -g ./mardikor-cli-0.2.4.tgz
mardikor --version
```

To build from source, run `npm ci` and `npm run dist:cli` at the repository root. The archive is written to `build-output/cli`. You can also run `node build-output/cli/package/bin/mardikor.cjs`. The single-file Windows portable build provides the graphical app only.

## Create, read, and edit projects

```sh
mardikor new "novel.mdk" --mode book
mardikor list "novel.mdk" --json
mardikor read "novel.mdk" "<document-id>" --json
mardikor write "novel.mdk" "<document-id>" --if-revision "<revision>" --from "chapter-1.md"
mardikor validate "novel.mdk"
```

`list --json` returns the project mode, revision, and documents in reading order. Use `entries[].id` to identify a document. IDs survive renaming and reordering. `read --json` returns the Markdown and the revision it was read from.

`write`, `write-file`, and `apply` read from standard input by default. Use `--from <file>` to read a file instead. `write` detects UTF-8 or GB18030. `write-file` defaults to UTF-8. Both accept `--encoding utf-8|gb18030|auto` and write UTF-8 without a BOM. The JSON supplied to `apply` uses UTF-8.

## Input and package limits

Each input and internal file can be at most **64 MiB**. Both the MDK package and its total decompressed contents have a **256 MiB** limit. Streaming in chunks still counts as one input. Split longer manuscripts into separate contents entries and write each one individually.

## Command reference

| Command                                                   | Purpose                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `new <project> [--mode default\|book\|comic]`             | Create a project and its first document without overwriting an existing file           |
| `list <project>`                                          | Show document IDs, positions, and the project revision                                 |
| `read <project> <id>`                                     | Read a document's Markdown source                                                      |
| `write <project> <id>`                                    | Replace a document's content                                                           |
| `edit <project> <id> [--editor <program>]`                | Edit a document in an external editor                                                  |
| `add <project> <filename> [--after <id>] [--title <name>]` | Add a document with an optional outline display name                                  |
| `rename <project> <id> <filename>`                        | Rename a document                                                                      |
| `remove <project> <id>`                                   | Remove an entry and promote its children. Delete the file when no entries reference it |
| `move <project> <id> <before\|after\|inside> <target-id>` | Move an entry and its descendants                                                      |
| `read-file <project> <path>`                              | Read Markdown, TOML, or another UTF-8 file from the package                            |
| `write-file <project> <path>`                             | Create or update a UTF-8 file in the package                                           |
| `apply <project> [--quiet]`                               | Create documents and save text and position changes together                          |
| `import <project> <type> <file>`                          | Import an image, video, audio, font, or other resource and return its internal path    |
| `validate <project>`                                      | Check the package, control files, and resource references                              |
| `watch <project> --json`                                  | Report the current revision and then emit a JSON line for each change                  |
| `unlock <project>`                                        | Check a stale write lock left by a process that has exited                             |

Commands that modify a project require `--if-revision <revision>`. Interactive `edit` records the revision automatically. It uses `$VISUAL`, `$EDITOR`, or `vi` on Linux. Specify a program that waits for editing to finish, and pass arguments with repeated `--editor-arg` options such as `--editor-arg=--wait`. If the save conflicts, the error includes the draft path.

## Batch changes

Use `list --json` to get IDs, `read --json` to get the source and revision, and `write` or `apply` to commit changes against that revision. Run `validate --json` afterward. If a revision conflict occurs, reread the current content before merging.

`apply` accepts any combination of `newEntries`, `writes`, and `positions`. Batch creation saves the whole outline once. Give each new entry a path under `markdown/` and a dotted MDK position. You can supply an `id`, `title`, and `markdown`. Mardikor generates omitted IDs. You can also supply the text in `writes` using a new entry's explicit ID when its `markdown` is omitted. Write each file once per batch.

```json
{
  "newEntries": [
    { "path": "markdown/scene-01.md", "position": "3.1", "title": "32:00:00", "markdown": "# 32:00:00\n" }
  ],
  "writes": [
    { "id": "<document-id>", "markdown": "# Chapter 1\n\nRevised text.\n" }
  ],
  "positions": [{ "id": "<document-id>", "position": "2.1" }]
}
```

```sh
mardikor apply "novel.mdk" --if-revision "<revision>" --from changes.json --quiet
mardikor validate "novel.mdk" --json
```

`--quiet` returns only `{"revision":"…"}`. `list --json` includes an optional `display_name` separately from the path. When headings already contain chapter numbers, turn off automatic chapter numbering in Project Settings or set `mode.book.chapter_numbering = false` in `settings.toml`.

`--json` writes results to stdout and reports errors with `code` and `message` on stderr. Validation prints the complete JSON report even when it finds errors. Write commands return the new revision. Run `mardikor <command> --help` for command-specific options.

| Exit code | Meaning                                 |
| --------- | --------------------------------------- |
| `0`       | Success                                 |
| `1`       | Validation or operation failed          |
| `2`       | Invalid command arguments               |
| `3`       | Revision conflict or project write lock |

The CLI and desktop app share a write lock. Run `mardikor unlock "novel.mdk"` after an unexpected exit. The command also recognizes older PID-only locks. It removes a lock only when the record is valid and the local process has exited.
