import { t } from "../shared/i18n";
import AdmZip from "adm-zip";
import { inflateRawSync, crc32 } from "node:zlib";
import { validatePath } from "../shared/schema";
import { MAX_MANIFEST_BYTES, MdkValidationError } from "../shared/mdk-v2";

export const MAX_FILE = 64 * 1024 * 1024,
  MAX_TOTAL = 256 * 1024 * 1024,
  MAX_ENTRIES = 10000;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MIME = "application/vnd.mardikor.mdk+zip";
const ZIP64 = 0xffffffff;
const UTF8 = 0x800;
export const archiveComments = new WeakMap<AdmZip, Buffer>();
export function addArchiveMember(
  zip: AdmZip,
  name: string,
  bytes: Buffer,
  comment = "",
  attr?: number,
) {
  zip.addFile(name, bytes, comment, attr);
  const entry = zip.getEntry(name)!;
  if (entry.isDirectory || name === "mimetype" || name === "mdk.toml")
    entry.header.method = 0;
  // AdmZip bases the UTF-8 flag on its codec when serializing.
  return entry;
}
export function checkNames(items: { name: string; directory: boolean }[]) {
  const names = new Map<string, boolean>();
  for (const item of items) {
    const key = item.directory ? item.name.slice(0, -1) : item.name;
    validatePath(key);
    if (names.has(key))
      throw new Error(t("ZIP 路径重复或文件目录同名：{0}", key));
    names.set(key, item.directory);
  }
  for (const name of names.keys()) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++)
      if (names.get(parts.slice(0, i).join("/")) === false)
        throw new Error(t("普通文件不能作为父目录：{0}", name));
  }
}
// Verify raw ZIP records before passing independently based payload offsets to
// the ZIP library. Inflate with a hard output bound; never trust declared sizes.
export function readArchive(payload: Buffer): AdmZip {
  const fail = (message: string): never => {
    throw new MdkValidationError(
      "container",
      "fail",
      "mdk.container.invalid",
      t("ZIP 校验失败：") + message,
    );
  };
  const limit = (message: string): never => {
    throw new MdkValidationError(
      "container",
      "unverified",
      "mdk.limit.exceeded",
      message,
    );
  };
  if (payload.length < 4 || payload.readUInt32LE(0) !== 0x04034b50)
    throw new MdkValidationError(
      "container",
      "unverified",
      "mdk.container.unrecognized",
      t("无法识别为 MDK v2 容器。"),
    );
  const span = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > payload.length)
      fail(t("记录超出 payload 边界。"));
  };
  let end = -1;
  for (
    let i = payload.length - 22;
    i >= Math.max(0, payload.length - 65557);
    i--
  )
    if (
      payload.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + payload.readUInt16LE(i + 20) === payload.length
    ) {
      end = i;
      break;
    }
  if (end < 0) fail(t("缺少完整的中央目录结束记录。"));
  const uint64 = (at: number) => {
    span(at, 8);
    const value = payload.readBigUInt64LE(at);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      limit(t("ZIP64 数值超出实现限额。"));
    return Number(value);
  };
  let count = payload.readUInt16LE(end + 10),
    size = payload.readUInt32LE(end + 12),
    start = payload.readUInt32LE(end + 16);
  const diskCount = payload.readUInt16LE(end + 8);
  if (payload.readUInt16LE(end + 4) || payload.readUInt16LE(end + 6))
    fail(t("MDK v2 不支持分卷 ZIP。"));
  let directoryEnd = end;
  const locator = end - 20;
  if (locator >= 0 && payload.readUInt32LE(locator) === 0x07064b50) {
    if (
      payload.readUInt32LE(locator + 4) ||
      payload.readUInt32LE(locator + 16) !== 1
    )
      fail(t("ZIP64 的卷信息无效。"));
    const record = uint64(locator + 8);
    span(record, 56);
    if (
      payload.readUInt32LE(record) !== 0x06064b50 ||
      uint64(record + 4) !== locator - record - 12 ||
      payload.readUInt32LE(record + 16) ||
      payload.readUInt32LE(record + 20)
    )
      fail(t("ZIP64 结束记录无效。"));
    const zipCount = uint64(record + 32),
      zipSize = uint64(record + 40),
      zipStart = uint64(record + 48);
    if (
      uint64(record + 24) !== zipCount ||
      (diskCount !== 65535 && diskCount !== zipCount) ||
      (count !== 65535 && count !== zipCount) ||
      (size !== ZIP64 && size !== zipSize) ||
      (start !== ZIP64 && start !== zipStart)
    )
      fail(t("ZIP64 与普通结束记录不一致。"));
    count = zipCount;
    size = zipSize;
    start = zipStart;
    directoryEnd = record;
  } else if (
    count === 65535 ||
    size === ZIP64 ||
    start === ZIP64 ||
    diskCount !== count
  )
    fail(t("缺少有效的 ZIP64 结束记录。"));
  if (count > MAX_ENTRIES)
    limit(t("超出实现支持范围：最多 10,000 个 ZIP 项。"));
  if (start > directoryEnd || size !== directoryEnd - start)
    fail(t("中央目录的偏移或大小无效。"));
  const extra = (offset: number, length: number) => {
    let wide: { offset: number; end: number } | undefined;
    const stop = offset + length;
    span(offset, length);
    while (offset < stop) {
      if (offset + 4 > stop) fail(t("损坏的 extra 字段。"));
      const id = payload.readUInt16LE(offset),
        n = payload.readUInt16LE(offset + 2);
      offset += 4;
      if (offset + n > stop) fail(t("损坏的 extra 字段。"));
      if (id === 1) {
        if (wide) fail(t("重复的 ZIP64 extra 字段。"));
        wide = { offset, end: offset + n };
      }
      if (id === 0x7075 || id === 0x756e || (id === 0x000d && n > 12))
        fail(t("不支持可能包含链接的 UNIX 扩展。"));
      offset += n;
    }
    return wide;
  };
  function nextWide(field: ReturnType<typeof extra>, length = 8) {
    if (!field || field.offset + length > field.end)
      return fail(t("ZIP64 extra 字段缺失或长度不足。"));
    const value =
      length === 8 ? uint64(field.offset) : payload.readUInt32LE(field.offset);
    field.offset += length;
    return value;
  }
  type Item = {
    name: string;
    directory: boolean;
    offset: number;
    dataOffset: number;
    compressed: number;
    size: number;
    crc: number;
    method: number;
    attr: number;
    comment: string;
    end: number;
  };
  const items: Item[] = [];
  let cursor = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    span(cursor, 46);
    if (payload.readUInt32LE(cursor) !== 0x02014b50)
      fail(t("中央目录记录损坏。"));
    const flags = payload.readUInt16LE(cursor + 8),
      method = payload.readUInt16LE(cursor + 10),
      crc = payload.readUInt32LE(cursor + 16);
    let compressed = payload.readUInt32LE(cursor + 20),
      size = payload.readUInt32LE(cursor + 24),
      offset = payload.readUInt32LE(cursor + 42),
      disk = payload.readUInt16LE(cursor + 34);
    const n = payload.readUInt16LE(cursor + 28),
      x = payload.readUInt16LE(cursor + 30),
      c = payload.readUInt16LE(cursor + 32),
      attr = payload.readUInt32LE(cursor + 38);
    if (cursor + 46 + n + x + c > directoryEnd) fail(t("中央目录记录越界。"));
    const centralWide = extra(cursor + 46 + n, x);
    const wideSize = size === ZIP64 || compressed === ZIP64;
    if (size === ZIP64) size = nextWide(centralWide);
    if (compressed === ZIP64) compressed = nextWide(centralWide);
    if (offset === ZIP64) offset = nextWide(centralWide);
    if (disk === 65535) disk = nextWide(centralWide, 4);
    if (disk) fail(t("不支持分卷条目。"));
    if (flags & 0x2041) fail(t("MDK v2 不支持加密 ZIP。"));
    if (![0, 8].includes(method))
      fail(t("MDK v2 不允许压缩方法 {0}。", method));
    if (size > MAX_FILE || (total += size) > MAX_TOTAL)
      limit(t("超出实现支持范围：单文件 64 MiB / 总量 256 MiB。"));
    span(cursor + 46, n + x + c);
    const rawName = payload.subarray(cursor + 46, cursor + 46 + n);
    let name = "";
    try {
      name = utf8.decode(rawName);
    } catch {
      fail(t("文件名不是有效 UTF-8。"));
    }
    if (!(flags & UTF8)) fail(t("ZIP 文件名必须设置 UTF-8 bit 11。"));
    const directory = name!.endsWith("/"),
      type = (attr >>> 16) & 0xf000;
    if (![0, 0x4000, 0x8000].includes(type) || attr & 0x440)
      fail(t("仅允许普通文件和目录，不允许链接或设备。"));
    if ((type === 0x4000 && !directory) || (type === 0x8000 && directory))
      fail(t("目录属性与名称不一致。"));
    if (
      (directory && (method !== 0 || size || crc)) ||
      (method === 0 && size !== compressed)
    )
      fail(t("目录条目或 STORE 条目的大小、压缩方法或 CRC 无效。"));
    span(offset, 30);
    if (payload.readUInt32LE(offset) !== 0x04034b50)
      fail(t("本地文件头损坏或偏移错误。"));
    const localFlags = payload.readUInt16LE(offset + 6),
      ln = payload.readUInt16LE(offset + 26),
      lx = payload.readUInt16LE(offset + 28),
      dataOffset = offset + 30 + ln + lx;
    span(offset + 30, ln + lx);
    if (
      localFlags !== flags ||
      payload.readUInt16LE(offset + 8) !== method ||
      !rawName.equals(payload.subarray(offset + 30, offset + 30 + ln))
    )
      fail(t("本地头与中央目录名称、标志或方法不一致。"));
    const localWide = extra(offset + 30 + ln, lx);
    span(dataOffset, compressed);
    let localSize = payload.readUInt32LE(offset + 22),
      localCompressed = payload.readUInt32LE(offset + 18);
    const wideLocalSize = localSize === ZIP64 || localCompressed === ZIP64;
    if (localSize === ZIP64) localSize = nextWide(localWide);
    if (localCompressed === ZIP64) localCompressed = nextWide(localWide);
    const local = [
        payload.readUInt32LE(offset + 14),
        localCompressed,
        localSize,
      ],
      expected = [crc, compressed, size];
    let stop = dataOffset + compressed;
    if (flags & 8) {
      if (local.some((v, j) => v !== 0 && v !== expected[j]))
        fail(t("本地 data descriptor 占位值不一致。"));
      const width = wideSize || wideLocalSize ? 8 : 4;
      const length = 4 + 2 * width;
      const matches = (at: number) =>
        at + length <= start &&
        payload.readUInt32LE(at) === crc &&
        (width === 8
          ? uint64(at + 4) === compressed && uint64(at + 12) === size
          : payload.readUInt32LE(at + 4) === compressed &&
            payload.readUInt32LE(at + 8) === size);
      if (
        stop + 4 <= start &&
        payload.readUInt32LE(stop) === 0x08074b50 &&
        matches(stop + 4)
      )
        stop += 4;
      else if (!matches(stop)) fail(t("data descriptor 与中央目录不一致。"));
      stop += length;
    } else if (local.some((v, j) => v !== expected[j]))
      fail(t("本地头与中央目录 CRC 或大小不一致。"));
    if (name === "mimetype" || name === "mdk.toml") {
      if (
        method !== 0 ||
        flags & 8 ||
        wideSize ||
        wideLocalSize ||
        centralWide ||
        localWide ||
        (name === "mimetype" ? lx > 0 : size > MAX_MANIFEST_BYTES)
      )
        fail(
          t("mimetype 或 mdk.toml 的存储方法、标志、大小或 extra 字段无效。"),
        );
    }
    if (stop > start) fail(t("条目与中央目录重叠。"));
    items.push({
      name: name!,
      directory,
      offset,
      dataOffset,
      compressed,
      size,
      crc,
      method,
      attr,
      comment: payload
        .subarray(cursor + 46 + n + x, cursor + 46 + n + x + c)
        .toString("utf8"),
      end: stop,
    });
    cursor += 46 + n + x + c;
  }
  if (cursor !== start + size) fail(t("中央目录大小或条目计数不一致。"));
  checkNames(items);
  const physical = [...items].sort((a, b) => a.offset - b.offset);
  if (
    physical[0]?.name !== "mimetype" ||
    physical[0]?.offset !== 0 ||
    physical[1]?.name !== "mdk.toml"
  )
    fail(t("物理前两项必须为 mimetype 和 mdk.toml。"));
  for (let i = 1; i < physical.length; i++)
    if (physical[i].offset !== physical[i - 1].end)
      fail(t("条目重叠或含未声明数据。"));
  if (physical.at(-1)?.end !== start) fail(t("中央目录前含未声明数据。"));
  const zip = new AdmZip(undefined, { noSort: true });
  archiveComments.set(zip, payload.subarray(end + 22));
  let actual = 0;
  const deadline = Date.now() + 15000;
  for (const item of physical) {
    if (Date.now() > deadline)
      limit(t("超出实现支持范围：解压处理时间超过 15 秒。"));
    const compressed = payload.subarray(
      item.dataOffset,
      item.dataOffset + item.compressed,
    );
    const bytes =
      item.method === 0
        ? compressed
        : inflateRawSync(compressed, {
            maxOutputLength: Math.max(1, Math.min(item.size, MAX_FILE)),
          });
    if (bytes.length !== item.size || crc32(bytes) !== item.crc)
      fail(t("实际大小或 CRC 不一致：{0}", item.name));
    if (Date.now() > deadline)
      limit(t("超出实现支持范围：解压处理时间超过 15 秒。"));
    if ((actual += bytes.length) > MAX_TOTAL)
      fail(t("超出实现支持范围：实际解压总量超过 256 MiB。"));
    if (item.name === "mimetype" && !bytes.equals(Buffer.from(MIME, "ascii")))
      fail(t("mimetype 字节内容无效。"));
    zip.addFile(item.name, bytes, item.comment, item.attr);
  }
  return zip;
}
