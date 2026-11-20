import fs from "node:fs";
import path from "node:path";
import { t } from "../shared/i18n";
import { MAX_ENTRIES } from "./archive";
import {
  archiveLimit,
  classicSize,
  exactSize,
  writeAt,
  type StoreArchive,
} from "./archive-io";

function wideExtra(values: number[]) {
  if (!values.length) return Buffer.alloc(0);
  const bytes = Buffer.alloc(4 + 8 * values.length);
  bytes.writeUInt16LE(1, 0);
  bytes.writeUInt16LE(bytes.length - 4, 2);
  values.forEach((value, i) =>
    bytes.writeBigUInt64LE(BigInt(value), 4 + i * 8),
  );
  return bytes;
}

function directoryEnd(
  count: number,
  size: number,
  start: number,
  comment: Buffer,
) {
  const wide = count >= 0xffff || size >= classicSize || start >= classicSize;
  const bytes = Buffer.alloc((wide ? 76 : 0) + 22 + comment.length);
  let at = 0;
  if (wide) {
    bytes.writeUInt32LE(0x06064b50);
    bytes.writeBigUInt64LE(44n, 4);
    bytes.writeUInt16LE(45, 12);
    bytes.writeUInt16LE(45, 14);
    bytes.writeBigUInt64LE(BigInt(count), 24);
    bytes.writeBigUInt64LE(BigInt(count), 32);
    bytes.writeBigUInt64LE(BigInt(size), 40);
    bytes.writeBigUInt64LE(BigInt(start), 48);
    bytes.writeUInt32LE(0x07064b50, 56);
    bytes.writeBigUInt64LE(BigInt(start) + BigInt(size), 64);
    bytes.writeUInt32LE(1, 72);
    at = 76;
  }
  bytes.writeUInt32LE(0x06054b50, at);
  bytes.writeUInt16LE(Math.min(count, 0xffff), at + 8);
  bytes.writeUInt16LE(Math.min(count, 0xffff), at + 10);
  bytes.writeUInt32LE(Math.min(size, classicSize), at + 12);
  bytes.writeUInt32LE(Math.min(start, classicSize), at + 16);
  bytes.writeUInt16LE(comment.length, at + 20);
  comment.copy(bytes, at + 22);
  return bytes;
}

export function requireDiskSpace(
  destination: string,
  bytes: number,
  operation: string,
) {
  const space = fs.statfsSync(path.dirname(path.resolve(destination)), {
    bigint: true,
  });
  const available = space.bavail * space.bsize;
  if (BigInt(bytes) > available)
    archiveLimit(operation, destination, bytes, Number(available));
}

export function writeStoreArchive(
  fd: number,
  zip: StoreArchive,
  destination: string,
) {
  let start = 0n;
  let directorySize = 0n;
  const entries = zip.getEntries();
  const quota = (key: string) => {
    const value = process.env[key];
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value))
      throw new Error(t("无效的 MDK 字节配额：{0}", key));
    return exactSize(BigInt(value));
  };
  const fileQuota = quota("MARDIKOR_MAX_ENTRY_BYTES");
  const projectQuota = quota("MARDIKOR_MAX_PROJECT_BYTES");
  if (projectQuota !== undefined) {
    const bytes = exactSize(
      entries.reduce((total, entry) => total + BigInt(entry.header.size), 0n),
    );
    if (bytes > projectQuota)
      archiveLimit(t("写入 MDK 快照配额"), destination, bytes, projectQuota);
  }
  if (entries.length > MAX_ENTRIES)
    archiveLimit(
      t("写入 ZIP 索引（条目数）"),
      destination,
      entries.length,
      MAX_ENTRIES,
      t("条目"),
    );
  const records = entries.map((entry) => {
    const offset = exactSize(start);
    const size = entry.header.size;
    if (fileQuota !== undefined && size > fileQuota)
      archiveLimit(t("写入 MDK 条目配额"), entry.entryName, size, fileQuota);
    const name = Buffer.from(entry.entryName, "utf8");
    if (name.length > 0xffff)
      archiveLimit(t("写入 ZIP 文件名"), entry.entryName, name.length, 0xffff);
    const sizeFields = size >= classicSize ? [size, size] : [];
    const localExtra = wideExtra(sizeFields);
    const centralExtra = wideExtra(
      offset >= classicSize ? [...sizeFields, offset] : sizeFields,
    );
    start += BigInt(30 + name.length + localExtra.length) + BigInt(size);
    directorySize += BigInt(
      46 + name.length + centralExtra.length + entry.comment.length,
    );
    return { entry, offset, size, name, localExtra, centralExtra, crc: 0 };
  });
  const size = exactSize(directorySize);
  if (size > 32 * 1024 * 1024)
    archiveLimit(t("写入 ZIP 中央目录"), destination, size, 32 * 1024 * 1024);
  const tail = directoryEnd(
    records.length,
    size,
    exactSize(start),
    zip.comment,
  );
  const containerSize = exactSize(start + directorySize + BigInt(tail.length));
  const operation = t("写入 MDK 暂存容器");
  requireDiskSpace(destination, containerSize, operation);
  try {
    for (const record of records) {
      const { entry, offset, size, name, localExtra } = record;
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50);
      head.writeUInt16LE(localExtra.length ? 45 : 20, 4);
      head.writeUInt16LE(0x800, 6);
      head.writeUInt16LE(0x21, 12); // 1980-01-01
      head.writeUInt32LE(Math.min(size, classicSize), 18);
      head.writeUInt32LE(Math.min(size, classicSize), 22);
      head.writeUInt16LE(name.length, 26);
      head.writeUInt16LE(localExtra.length, 28);
      for (const bytes of [head, name, localExtra]) writeAt(fd, bytes);
      record.crc = entry.copyTo(fd);
      head.writeUInt32LE(record.crc, 14);
      writeAt(fd, head.subarray(14, 18), offset + 14);
    }
    for (const { entry, offset, size, crc, name, centralExtra } of records) {
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50);
      head.writeUInt16LE(0x032d, 4);
      head.writeUInt16LE(centralExtra.length ? 45 : 20, 6);
      head.writeUInt16LE(0x800, 8);
      head.writeUInt16LE(0x21, 14);
      head.writeUInt32LE(crc, 16);
      head.writeUInt32LE(Math.min(size, classicSize), 20);
      head.writeUInt32LE(Math.min(size, classicSize), 24);
      head.writeUInt16LE(name.length, 28);
      head.writeUInt16LE(centralExtra.length, 30);
      head.writeUInt16LE(entry.comment.length, 32);
      head.writeUInt32LE(entry.attr >>> 0, 38);
      head.writeUInt32LE(Math.min(offset, classicSize), 42);
      for (const bytes of [head, name, centralExtra, entry.comment])
        writeAt(fd, bytes);
    }
    writeAt(fd, tail);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOSPC" || code === "EDQUOT")
      throw new Error(
        t(
          "写入 MDK 时目标卷空间或配额不足：{0}（容器需要 {1} 字节）。",
          destination,
          containerSize,
        ),
        { cause: error },
      );
    if (code === "EFBIG")
      throw new Error(
        t(
          "目标文件系统的单文件上限不足：{0}（容器需要 {1} 字节）。",
          destination,
          containerSize,
        ),
        { cause: error },
      );
    throw error;
  }
}
