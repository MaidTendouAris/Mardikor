# Mardikor Command-Line Guide

The [CLI collaboration proposal (Chinese)](<CLI Collaboration Foundation Proposal.md>) describes planned commands and editing transactions.

This guide applies to [MDK v2](<MDK Format Specification v2.md>).

`mardikor` reads and edits `.mdk` projects directly. Use it on Linux servers, in terminal scripts, or in AI-assisted writing workflows.

## Installation

- The **Windows installer** adds its `bin` directory to the user or system PATH, depending on the installation scope. Open a new terminal and run `mardikor --version`. You can also run `bin\mardikor.exe` directly from the installation folder.
- **Linux** requires Node.js 22.12 or later. Use the version number of the archive you downloaded.

```sh
npm install -g ./mardikor-cli-0.3.4.tgz
mardikor --version
```

To build from source, run `npm ci` and `npm run dist:cli` in `Mardikor-Desktop/`. The archive is written to its `build-output/cli` directory. You can also run `node build-output/cli/package/bin/mardikor.cjs`. The single-file Windows portable build provides the graphical app only.

## Access protection and MDKE

```sh
mardikor protect "novel.mdk" --if-revision "<revision>" --new-passphrase-file access.txt
mardikor list "novel.mdk" --access-passphrase-file access.txt --json
mardikor mdke-pack "novel.mdk" "novel.mdke" --compression zstd-9 --unpack-passphrase-file extraction.txt
mardikor mdke-extract "novel.mdke" "extracted.mdk" --unpack-passphrase-file extraction.txt
mardikor mdke-rekey "novel.mdke" "updated.mdke" --unpack-passphrase-file extraction.txt --new-passphrase-file new.txt
```

MDKP retains the `.mdk` extension and requires the access passphrase to read or edit. MDKE can have a separate extraction passphrase. Extracting restores the inner MDK byte for byte, including any access protection. `mdke-pack --compression` accepts `auto`, `store`, `zstd-3`, and `zstd-9`. The default, `auto`, uses Zstandard level 3 for plain MDK and STORE for protected MDK. Zstandard commands require Node.js 22.15 or later.

Passphrase files contain a single UTF-8 line. Leading and trailing spaces are preserved. One passphrase can be read from stdin by passing `-` as its filename. Use `--access-passphrase-file` for the current access passphrase. Use `--new-passphrase-file` or `--remove` to replace or remove the appropriate layer. Use `write` to edit protected MDK. The command that starts an external editor, `edit`, is available for plain MDK only.

Use `--allow-plaintext` to extract plaintext from an encrypted distribution package or unpack a protected project into a folder. Use `mdke-extract --recovery` to explicitly retain the verified outer payload as a recovery copy when the inner project fails validation.

## Create, read, and edit projects

```sh
mardikor new "novel.mdk" --mode book
mardikor list "novel.mdk" --json
mardikor read "novel.mdk" "<document-id>" --json
mardikor write "novel.mdk" "<document-id>" --if-revision "<revision>" --from "chapter-1.md"
mardikor validate "novel.mdk"
```

`list --json` returns the project ID, revision, registered `documents`, outline `nodes`, and display `entries`. Use a document ID or a document node ID to read and write text. Use node IDs to move or remove outline nodes. Several nodes can reference the same document. IDs survive renaming and reordering.

`write`, `write-file`, and `apply` read from standard input by default. Use `--from <file>` to read a file instead. `write` detects UTF-8 or GB18030. `write-file` defaults to UTF-8. Both accept `--encoding utf-8|gb18030|auto` and write UTF-8 without a BOM. The JSON supplied to `apply` uses UTF-8.

## Input and package limits

Ordinary MDK packing, import, delivery and extraction stream STORE members and use ZIP64 where required. Capacity depends on the destination filesystem, available space, and ZIP index budgets. Set `MARDIKOR_MAX_ENTRY_BYTES` or `MARDIKOR_MAX_PROJECT_BYTES` to configure inclusive write quotas in decimal bytes. Text input is limited to 64 MiB per command. MDKP and MDKE have separate envelope budgets. [MDK v2 specification, §3.5](<MDK Format Specification v2.md>)

`import` accepts any regular file and uses the category to choose a directory under `resources/`. `extract <project> <member-path> <output-file>` extracts a single member byte for byte. Extracting a protected project's attachment requires its access passphrase and `--allow-plaintext`.

Mardikor 0.3.3 requires STORE (ZIP method 0) for every entry under the November 17, 2026 MDK v2 revision. For an older project rejected because it contains DEFLATE entries, run `mardikor unpack "old.mdk" "unpacked"` with CLI 0.3.2, then run `mardikor pack "new.mdk" "unpacked"` with 0.3.3. Keep the original project.

## Command reference

| Command                                                   | Purpose                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `new <project> [--mode default\|book\|comic]`             | Create a project and its first document without overwriting an existing file           |
| `list <project>`                                          | Show document IDs, positions, and the project revision                                 |
| `read <project> <id>`                                     | Read a document's Markdown source                                                      |
| `write <project> <id>`                                    | Replace a document's content                                                           |
| `edit <project> <id> [--editor <program>]`                | Edit a document in an external editor                                                  |
| `add <project> <filename> [--after <id>] [--title <name>]` | Add a document with an optional outline display name                                  |
| `rename <project> <document-or-node-id> <filename>`       | Rename a document file and update its known references. A group node ID renames the group |
| `group <project> <name> [--parent <node-id>]`             | Create a group, optionally under a parent node                                         |
| `remove <project> <id>`                                   | Remove a node, promote its children, and retain the document                            |
| `move <project> <id> <before\|after\|inside> <target-id>` | Move an entry and its descendants                                                      |
| `read-file <project> <path>`                              | Read Markdown, TOML, or another UTF-8 file from the package                            |
| `write-file <project> <path>`                             | Create or update a UTF-8 file in the package                                           |
| `apply <project> [--quiet]`                               | Create documents and save text and position changes together                          |
| `import <project> <type> <file>`                          | Import an image, video, audio, font, or other resource and return its internal path    |
| `validate <project>`                                      | Check the package, control files, and resource references                              |
| `pack <output> <directory>`                               | Package a directory with v2 control files                                             |
| `unpack <project> <directory>`                            | Unpack into a new directory                                                           |
| `deliver <project> <output>`                              | Validate base content and create an independent delivery copy                         |
| `watch <project> --json`                                  | Report the current revision and then emit a JSON line for each change                  |
| `unlock <project>`                                        | Check a stale write lock left by a process that has exited                             |

Commands that modify a project require `--if-revision <revision>`. Interactive `edit` records the revision automatically. It uses `$VISUAL`, `$EDITOR`, or `vi` on Linux. Specify a program that waits for editing to finish, and pass arguments with repeated `--editor-arg` options such as `--editor-arg=--wait`. If the save conflicts, the error includes the draft path.

`deliver` omits `state/` by default. Use `--include-state` to carry it. To omit persistent attachments, repeat `--exclude <path>` for the exact paths and pass the reviewed source revision with `--if-revision`.

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

`--quiet` returns only `{"revision":"…"}`. `list --json` includes an optional `display_name` separately from the path. Dotted positions are display coordinates. For a nested position, supply its parent in the same batch or create the parent first.

`--json` writes results to stdout and reports errors with `code` and `message` on stderr. Validation prints the complete JSON report even when it finds errors. Write commands return the new revision. Run `mardikor <command> --help` for command-specific options.

| Exit code | Meaning                                 |
| --------- | --------------------------------------- |
| `0`       | Success                                 |
| `1`       | Validation or operation failed          |
| `2`       | Invalid command arguments               |
| `3`       | Revision conflict or project write lock |

The CLI and desktop app share a write lock. Run `mardikor unlock "novel.mdk"` after an unexpected exit. The command also recognizes older PID-only locks. It removes a lock only when the record is valid and the local process has exited.
