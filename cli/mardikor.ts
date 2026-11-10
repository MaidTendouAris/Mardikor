import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { version } from "../package.json";
import * as mdk from "../electron/mdk";
import { MAX_ENTRIES, MAX_FILE } from "../electron/archive";
import { watchProjectFile } from "../electron/project-watch";
import { comparePosition } from "../shared/outline";
import { moveOutline } from "../shared/tree";
import { isTable } from "../shared/schema";
import {
  entryDisplayName,
  type MdkProject,
  type ResourceKind,
  type SaveSnapshot,
} from "../shared/mdk";

const limits =
  "实现限额：单次输入及单个内部文件最多 64 MiB；MDK 容器及解压后总量最多 256 MiB。";
const usage = `用法：mardikor <命令> <工程.mdk> [参数] [选项]

  new <工程> [--mode default|book|comic]
  list <工程>
  read <工程> <文稿ID>
  write <工程> <文稿ID> --if-revision <修订号> [--from <文件>] [--encoding <编码>]
  edit <工程> <文稿ID> [--editor <可执行文件>] [--editor-arg <参数>]
  add <工程> <文件名> --if-revision <修订号> [--after <文稿ID>] [--title <显示名>]
  rename <工程> <文稿ID> <文件名> --if-revision <修订号>
  remove <工程> <文稿ID> --if-revision <修订号>
  move <工程> <文稿ID> <before|after|inside> <目标ID> --if-revision <修订号>
  read-file <工程> <内部路径>
  write-file <工程> <内部路径> --if-revision <修订号> [--from <文件>] [--encoding <编码>]
  apply <工程> --if-revision <修订号> [--from <JSON文件>] [--quiet]
  import <工程> <image|video|audio|font|other> <资源文件> --if-revision <修订号>
  validate <工程>
  watch <工程>
  unlock <工程>

使用 --json 获取结构化结果。write、write-file、apply 默认从标准输入读取。
使用 --help 查看用法，--version 查看版本。
${limits}
退出码 0 为成功，1 为操作或校验失败，2 为参数错误（E_USAGE），3 为修订冲突或写入锁。
`;

const commands: Record<
  string,
  { args: number; revision?: true; options?: string[] }
> = {
  new: { args: 0, options: ["mode"] },
  list: { args: 0 },
  read: { args: 1 },
  write: { args: 1, revision: true, options: ["from", "encoding"] },
  edit: { args: 1, options: ["editor", "editor-arg"] },
  add: { args: 1, revision: true, options: ["after", "title"] },
  rename: { args: 2, revision: true },
  remove: { args: 1, revision: true },
  move: { args: 3, revision: true },
  "read-file": { args: 1 },
  "write-file": { args: 1, revision: true, options: ["from", "encoding"] },
  apply: { args: 0, revision: true, options: ["from", "quiet"] },
  import: { args: 2, revision: true },
  validate: { args: 0 },
  watch: { args: 0 },
  unlock: { args: 0 },
};
class UsageError extends Error {}

async function input(from?: string, encoding = "utf-8", preserveBom = false) {
  const chunks: Buffer[] = [];
  if (!from && process.stdin.isTTY)
    throw new UsageError("请通过标准输入或 --from 提供内容。");
  let bytes = 0;
  for await (const chunk of from ? fs.createReadStream(from) : process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_FILE) throw new Error("输入超过 64 MiB。");
    chunks.push(chunk);
  }
  if (!["utf-8", "gb18030", "auto"].includes(encoding))
    throw new UsageError("--encoding 仅支持 utf-8、gb18030 或 auto。");
  const bytesIn = Buffer.concat(chunks);
  try {
    return new TextDecoder(encoding === "auto" ? "utf-8" : encoding, {
      fatal: true,
      ignoreBOM: preserveBom,
    }).decode(bytesIn);
  } catch {
    if (
      encoding === "auto" &&
      !bytesIn.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ) {
      try {
        return new TextDecoder("gb18030", { fatal: true }).decode(bytesIn);
      } catch {
        /* Report both supported encodings. */
      }
    }
    throw new UsageError(
      "输入编码无效。请使用 UTF-8，或用 --encoding gb18030 读取 GBK/GB18030 正文。",
    );
  }
}

function projectView(project: MdkProject) {
  return {
    revision: project.revision,
    mode: project.mode,
    mode_name:
      (
        { "00": "default", "01": "book", "02": "comic" } as Record<
          string,
          string
        >
      )[project.mode] ?? "unknown",
    readonly: project.readonly,
    entries: [...project.contents.entries]
      .sort((a, b) => comparePosition(a.position, b.position))
      .map((entry) => {
        const { id, path, position } = entry;
        const display_name = entryDisplayName(entry);
        return {
          id,
          path,
          position,
          ...(display_name ? { display_name } : {}),
        };
      }),
  };
}

function projectEntry(project: MdkProject, id: string) {
  const entry = project.contents.entries.find((item) => item.id === id);
  if (!entry) throw new Error("找不到文稿 ID：" + id);
  return entry;
}

function readProject(file: string, revision: string) {
  const project = mdk.openMdkProject(file);
  if (project.revision !== revision) throw new mdk.MdkRevisionError();
  return project;
}

function save(file: string, snapshot: SaveSnapshot) {
  return projectView(mdk.saveMdkSnapshot(file, snapshot));
}

function outlinePosition(value: string) {
  if (!/^[1-9]\d*(?:\.[1-9]\d*){0,5}$/.test(value))
    throw new UsageError(
      "position 必须是 1、1.2、1.2.3 这样的点分编号，最多六层。",
    );
  return value;
}

function apply(file: string, revision: string, text: string) {
  let request: unknown;
  try {
    request = JSON.parse(text);
  } catch {
    throw new UsageError("批量变更必须是有效的 JSON。");
  }
  if (
    !isTable(request) ||
    Object.keys(request).some(
      (key) => !["newEntries", "writes", "positions"].includes(key),
    )
  )
    throw new UsageError("批量变更只支持 newEntries、writes 和 positions。");
  const newEntries = Object.hasOwn(request, "newEntries")
    ? request.newEntries
    : [];
  const writes = Object.hasOwn(request, "writes") ? request.writes : [];
  const positions = Object.hasOwn(request, "positions")
    ? request.positions
    : [];
  if (
    !Array.isArray(newEntries) ||
    newEntries.length > MAX_ENTRIES ||
    !Array.isArray(writes) ||
    !Array.isArray(positions) ||
    (!newEntries.length && !writes.length && !positions.length)
  )
    throw new UsageError("请提供至少一条批量变更。");
  const additions = newEntries.map((entry) => {
    if (
      !isTable(entry) ||
      Object.keys(entry).some(
        (key) => !["id", "path", "position", "markdown", "title"].includes(key),
      ) ||
      typeof entry.path !== "string" ||
      typeof entry.position !== "string" ||
      (entry.id !== undefined && typeof entry.id !== "string") ||
      (entry.markdown !== undefined && typeof entry.markdown !== "string") ||
      (entry.title !== undefined && typeof entry.title !== "string")
    )
      throw new UsageError(
        "每条 newEntries 需要 path 和 position，可选 id、markdown 和 title。",
      );
    return {
      id: entry.id,
      path: entry.path,
      position: outlinePosition(entry.position),
      markdown: entry.markdown,
      title: entry.title,
    };
  });
  const content = writes.map((change) => {
    if (
      !isTable(change) ||
      typeof change.id !== "string" ||
      typeof change.markdown !== "string"
    )
      throw new UsageError("每条 writes 变更需要 id 和 markdown 字段。");
    return { id: change.id, markdown: change.markdown };
  });
  const ids = new Set<string>();
  const updates = positions.map((change) => {
    if (
      !isTable(change) ||
      typeof change.id !== "string" ||
      typeof change.position !== "string" ||
      ids.has(change.id)
    )
      throw new UsageError(
        "每条 positions 变更需要唯一的 id 和字符串 position。",
      );
    ids.add(change.id);
    return { id: change.id, position: outlinePosition(change.position) };
  });
  return mdk.applyMdkBatch(file, revision, {
    newEntries: additions,
    writes: content,
    positions: updates,
  });
}

async function edit(
  file: string,
  id: string,
  executable?: string,
  args: string[] = [],
) {
  const entry = mdk.readMdkEntry(file, id);
  const configured = executable || process.env.VISUAL || process.env.EDITOR;
  if (!configured && process.platform === "win32")
    throw new UsageError(
      "Windows 下请使用 --editor 指定会等待编辑完成的编辑器。",
    );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mardikor-edit-"));
  const draft = path.join(directory, path.posix.basename(entry.path));
  fs.writeFileSync(draft, entry.markdown, { mode: 0o600 });
  try {
    const editor = spawnSync(configured ?? "vi", [...args, draft], {
      stdio: "inherit",
    });
    if (editor.error) throw editor.error;
    if (editor.status !== 0) throw new Error("编辑器未正常退出。");
    const content = await input(draft, "utf-8", true);
    const changed = content !== entry.markdown;
    const result = changed
      ? save(file, {
          revision: entry.revision,
          text: { path: entry.path, content },
        })
      : { revision: entry.revision };
    try {
      fs.unlinkSync(draft);
      fs.rmdirSync(directory);
    } catch {
      // An editor can leave backup files. Cleanup cannot undo a committed edit.
    }
    return { ...result, changed };
  } catch (error) {
    if (error instanceof Error) error.message += "\n编辑草稿路径：" + draft;
    throw error;
  }
}

async function run(args: string[]) {
  let json = args
    .slice(0, args.includes("--") ? args.indexOf("--") : args.length)
    .includes("--json");
  const output = (value: unknown) =>
    process.stdout.write(JSON.stringify(value) + "\n");
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        allowPositionals: true,
        options: {
          help: { type: "boolean", short: "h" },
          version: { type: "boolean", short: "v" },
          json: { type: "boolean" },
          quiet: { type: "boolean" },
          "if-revision": { type: "string" },
          from: { type: "string" },
          mode: { type: "string" },
          after: { type: "string" },
          title: { type: "string" },
          editor: { type: "string" },
          "editor-arg": { type: "string", multiple: true },
          encoding: { type: "string" },
        },
      });
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    const { values, positionals } = parsed;
    json = !!values.json;
    const [command, file, first, second, third] = positionals;
    if (values.help || command === "help" || (!command && !values.version)) {
      const helpCommand = command === "help" ? file : command;
      const line = usage
        .split("\n")
        .find((row) => row.startsWith("  " + helpCommand + " "));
      if (line) {
        process.stdout.write("用法：mardikor " + line.trim() + "\n");
        if (["write", "write-file", "apply"].includes(helpCommand))
          console.log(
            "默认读取标准输入，--from 指定文件。write 和 write-file 支持 utf-8、gb18030、auto。",
          );
        if (helpCommand === "edit")
          console.log(
            "VISUAL / EDITOR 仅填写可执行文件路径，附加参数用 --editor-arg 重复传入。",
          );
        if (helpCommand === "apply")
          console.log("JSON 可组合 newEntries、writes 和 positions。--quiet 仅返回新的 revision。");
        console.log(limits);
        console.log(
          "退出码：0 成功，1 操作或校验失败，2 E_USAGE，3 E_MDK_REVISION / E_MDK_LOCKED。",
        );
        return 0;
      }
      process.stdout.write(usage);
      return 0;
    }
    if (values.version) {
      if (json) output({ version });
      else console.log(version);
      return 0;
    }
    const spec = Object.hasOwn(commands, command)
      ? commands[command]
      : undefined;
    if (
      !spec ||
      !file ||
      positionals.length !== spec.args + 2 ||
      !/\.mdk$/i.test(file)
    )
      throw new UsageError(
        "命令、参数数量或 .mdk 路径无效。请运行 mardikor --help。",
      );
    for (const option of Object.keys(values))
      if (
        option !== "json" &&
        !(option === "if-revision" && spec.revision) &&
        !spec.options?.includes(option)
      )
        throw new UsageError("此命令不支持 --" + option);
    const revision = values["if-revision"] ?? "";
    if (spec.revision && !/^[a-f0-9]{64}$/.test(revision))
      throw new UsageError(
        "请通过 --if-revision 提供 list 或 read 返回的修订号。",
      );

    switch (command) {
      case "new": {
        const name = values.mode ?? "default";
        if (name !== "default" && name !== "book" && name !== "comic")
          throw new UsageError("--mode 只支持 default、book 或 comic。");
        const mode = { default: "00", book: "01", comic: "02" }[name];
        output(projectView(mdk.createMdkProject(file, mode, false)));
        break;
      }
      case "list": {
        const project = projectView(mdk.openMdkProject(file));
        if (json) output(project);
        else {
          console.log("修订号 " + project.revision);
          for (const entry of project.entries)
            console.log([entry.position, entry.id, entry.path].join("\t"));
        }
        break;
      }
      case "read": {
        const entry = mdk.readMdkEntry(file, first);
        if (json) output(entry);
        else process.stdout.write(entry.markdown);
        break;
      }
      case "read-file": {
        const fileText = mdk.readMdkTextFile(file, first);
        if (json) output(fileText);
        else process.stdout.write(fileText.content);
        break;
      }
      case "write": {
        const content = await input(values.from, values.encoding ?? "auto");
        const entry = mdk.readMdkEntry(file, first);
        if (entry.revision !== revision) throw new mdk.MdkRevisionError();
        output(save(file, { revision, text: { path: entry.path, content } }));
        break;
      }
      case "write-file": {
        const content = await input(values.from, values.encoding ?? "utf-8");
        output(save(file, { revision, text: { path: first, content } }));
        break;
      }
      case "edit": {
        if (json) throw new UsageError("交互式 edit 请直接在终端运行。");
        output(await edit(file, first, values.editor, values["editor-arg"]));
        break;
      }
      case "apply": {
        const project = apply(file, revision, await input(values.from));
        output(
          values.quiet ? { revision: project.revision } : projectView(project),
        );
        break;
      }
      case "add":
        output(
          projectView(
            mdk.addMdkEntry(file, first, values.after, revision, values.title),
          ),
        );
        break;
      case "rename":
        output(projectView(mdk.renameMdkEntry(file, first, second, revision)));
        break;
      case "remove":
        output(projectView(mdk.deleteMdkEntry(file, first, revision)));
        break;
      case "move": {
        if (second !== "before" && second !== "after" && second !== "inside")
          throw new UsageError("移动位置只能是 before、after 或 inside。");
        const project = readProject(file, revision);
        const entries = moveOutline(
          project.contents.entries,
          first,
          projectEntry(project, third).position,
          second,
        );
        output(
          save(file, {
            revision,
            positions: entries.map(({ id, position }) => ({ id, position })),
          }),
        );
        break;
      }
      case "import":
        output(
          mdk.importMdkResource(file, second, first as ResourceKind, revision),
        );
        break;
      case "validate": {
        const report = mdk.validateMdk(file);
        if (json) output(report);
        else {
          console.log(report.valid ? "MDK 校验通过。" : "MDK 校验未通过。");
          for (const issue of report.issues)
            console.log(
              [issue.severity, issue.code, issue.path, issue.message]
                .filter(Boolean)
                .join("\t"),
            );
        }
        return report.valid ? 0 : 1;
      }
      case "watch": {
        let previous: string | null = mdk.fileRevision(file);
        const event = (revision: string | null) => {
          if (json) output({ path: path.resolve(file), revision });
          else console.log(revision ?? "文件暂不可读取");
        };
        event(previous);
        watchProjectFile(
          file,
          (revision) => {
            if (revision === previous) return;
            previous = revision;
            event(revision);
          },
          true,
        );
        break;
      }
      case "unlock":
        output({ unlocked: mdk.unlockMdk(file) });
        break;
    }
    return 0;
  } catch (error) {
    const conflict =
      error instanceof mdk.MdkRevisionError ||
      error instanceof mdk.MdkLockedError;
    const code = conflict
      ? error.code
      : error instanceof UsageError
        ? "E_USAGE"
        : "E_MDK";
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      json ? JSON.stringify({ code, message }) : code + " " + message,
    );
    return conflict ? 3 : error instanceof UsageError ? 2 : 1;
  }
}

void run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
