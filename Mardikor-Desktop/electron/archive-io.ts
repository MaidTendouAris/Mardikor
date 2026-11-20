import fs from "node:fs";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { MdkValidationError } from "../shared/mdk-v2";
import { t } from "../shared/i18n";
import { archiveCheckpoint } from "./archive-operation";

export const BUFFERED_ENTRY_LIMIT = 64 * 1024 * 1024;
export const BLOCK_SIZE = 1024 * 1024;
export const classicSize = 0xffffffff;
const read = promisify(fs.read);

export function archiveLimit(
  operation: string,
  path: string | undefined,
  required: number,
  available: number,
  unit = t("字节"),
): never {
  throw new MdkValidationError(
    "container",
    "unverified",
    "mdk.limit.exceeded",
    t(
      "{0}超过操作限额：需要 {1} {3}，可用 {2} {3}。",
      operation,
      required,
      available,
      unit,
    ),
    path,
  );
}

export function exactSize(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new MdkValidationError(
      "container",
      "unverified",
      "mdk.limit.exceeded",
      t("ZIP64 数值超出实现限额。"),
    );
  return Number(value);
}

function identity(info: fs.BigIntStats) {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}`;
}

function fingerprint(info: fs.BigIntStats) {
  return `${identity(info)}:${info.ctimeNs}`;
}

export class FileSnapshotChangedError extends Error {
  constructor(readonly file: string) {
    super(t("读取期间文件发生变化：{0}", file));
  }
}

export class FileSnapshot {
  readonly size: number;
  readonly key: string;
  private readonly dataKey: string;
  constructor(readonly path: string) {
    const info = fs.lstatSync(path, { bigint: true });
    if (!info.isFile())
      throw new Error(t("仅允许普通文件和目录，不允许链接或设备。"));
    this.size = exactSize(info.size);
    this.key = fingerprint(info);
    // Publishing by hard link can update Windows change time after the first
    // open. Use it to invalidate cached indexes, and use the file's identity
    // and last data write to track reads from a verified handle on Windows.
    this.dataKey = process.platform === "win32" ? identity(info) : this.key;
  }
  open() {
    const fd = fs.openSync(this.path, "r");
    try {
      this.check(fd);
      return fd;
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  }
  check(fd: number) {
    const info = fs.fstatSync(fd, { bigint: true });
    const key =
      process.platform === "win32" ? identity(info) : fingerprint(info);
    if (key !== this.dataKey) throw new FileSnapshotChangedError(this.path);
  }
  withFile<T>(work: (fd: number) => T) {
    const fd = this.open();
    try {
      const result = work(fd);
      this.check(fd);
      return result;
    } finally {
      fs.closeSync(fd);
    }
  }
}

export function readAt(
  fd: number,
  bytes: Buffer,
  offset: number,
  length = bytes.length,
) {
  for (let done = 0; done < length;) {
    const n = fs.readSync(fd, bytes, done, length - done, offset + done);
    if (!n) throw new Error(t("文件在读取期间被截断。"));
    done += n;
  }
}

export function writeAt(
  fd: number,
  bytes: Buffer,
  offset: number | null = null,
) {
  for (let done = 0; done < bytes.length;) {
    const n = fs.writeSync(
      fd,
      bytes,
      done,
      bytes.length - done,
      offset === null ? null : offset + done,
    );
    if (!n) throw new Error(t("文件写入未完成。"));
    done += n;
  }
}

export class FileRegion {
  constructor(
    readonly file: FileSnapshot,
    readonly offset: number,
    readonly size: number,
  ) {}

  read(start: number, size: number) {
    const output = Buffer.allocUnsafe(size);
    this.file.withFile((fd) => readAt(fd, output, this.offset + start));
    return output;
  }

  visit(work: (chunk: Buffer) => void, fd?: number) {
    const run = (source: number) => {
      const deadline = Date.now() + 30 * 60 * 1000;
      const bytes = Buffer.allocUnsafe(Math.min(BLOCK_SIZE, this.size));
      for (let offset = 0; offset < this.size;) {
        archiveCheckpoint();
        if (Date.now() > deadline)
          throw new MdkValidationError(
            "container",
            "unverified",
            "mdk.limit.exceeded",
            t("单次流式读取超过 30 分钟：{0}", this.file.path),
          );
        const length = Math.min(bytes.length, this.size - offset);
        readAt(source, bytes, this.offset + offset, length);
        work(bytes.subarray(0, length));
        archiveCheckpoint(length);
        offset += length;
      }
    };
    if (fd === undefined) this.file.withFile(run);
    else run(fd);
  }

  stream(start: number, end: number) {
    const file = this.file;
    const offset = this.offset;
    return Readable.from(
      (async function* () {
        if (start > end) return;
        const fd = file.open();
        try {
          let position = start;
          while (position <= end) {
            const bytes = Buffer.allocUnsafe(
              Math.min(256 * 1024, end - position + 1),
            );
            const { bytesRead } = await read(
              fd,
              bytes,
              0,
              bytes.length,
              offset + position,
            );
            if (!bytesRead) throw new Error(t("文件在读取期间被截断。"));
            position += bytesRead;
            file.check(fd);
            yield bytes.subarray(0, bytesRead);
          }
        } finally {
          fs.closeSync(fd);
        }
      })(),
    );
  }
}

export class StoreEntry {
  readonly header: { size: number };
  readonly isDirectory: boolean;
  constructor(
    readonly entryName: string,
    readonly data: Buffer | FileRegion,
    readonly comment: Buffer = Buffer.alloc(0),
    readonly attr = entryName.endsWith("/") ? 0x41ed0010 : 0x81a40000,
    readonly crc?: number,
  ) {
    this.header = { size: Buffer.isBuffer(data) ? data.length : data.size };
    this.isDirectory = entryName.endsWith("/");
  }
  getData(limit = BUFFERED_ENTRY_LIMIT, operation = t("读取正文或预览资源")) {
    if (this.header.size > limit)
      archiveLimit(operation, this.entryName, this.header.size, limit);
    return Buffer.isBuffer(this.data)
      ? this.data
      : this.data.read(0, this.header.size);
  }
  prefix(length = 4096) {
    return Buffer.isBuffer(this.data)
      ? this.data.subarray(0, length)
      : this.data.read(0, Math.min(length, this.header.size));
  }
  copyTo(fd?: number, sourceFd?: number) {
    let crc = 0;
    const consume = (chunk: Buffer) => {
      crc = crc32(chunk, crc);
      if (fd !== undefined) writeAt(fd, chunk);
    };
    if (Buffer.isBuffer(this.data)) consume(this.data);
    else this.data.visit(consume, sourceFd);
    if (this.crc !== undefined && this.crc !== crc)
      throw new MdkValidationError(
        "container",
        "fail",
        "mdk.container.invalid",
        t("实际大小或 CRC 不一致：{0}", this.entryName),
        this.entryName,
      );
    return crc;
  }
  renamed(name: string) {
    return new StoreEntry(name, this.data, this.comment, this.attr, this.crc);
  }
}

export class StoreArchive {
  private readonly entries = new Map<string, StoreEntry>();
  constructor(
    readonly comment: Buffer = Buffer.alloc(0),
    entries: Iterable<StoreEntry> = [],
  ) {
    for (const entry of entries) this.set(entry);
  }
  getEntry(name: string) {
    return this.entries.get(name);
  }
  getEntries() {
    return [...this.entries.values()];
  }
  deleteFile(name: string) {
    this.entries.delete(name);
  }
  set(entry: StoreEntry) {
    this.entries.set(entry.entryName, entry);
  }
  add(name: string, data: Buffer | FileRegion) {
    this.set(new StoreEntry(name, data));
  }
}

export function hashFile(source: FileSnapshot) {
  const hash = createHash("sha256");
  new FileRegion(source, 0, source.size).visit((chunk) => hash.update(chunk));
  return hash.digest("hex");
}

export function addedFile(name: string, file: string) {
  const source = new FileSnapshot(file);
  return new StoreEntry(name, new FileRegion(source, 0, source.size));
}
