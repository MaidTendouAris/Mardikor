import { t } from "../shared/i18n";
import AdmZip from "adm-zip";
import { inflateRawSync, crc32 } from "node:zlib";
import { validatePath } from "../shared/schema";

export const MAX_FILE = 64 * 1024 * 1024,
  MAX_TOTAL = 256 * 1024 * 1024,
  MAX_ENTRIES = 10000;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MIME = "application/vnd.mardikor.mdk+zip";
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
    throw new Error(t("ZIP 校验失败：") + message);
  };
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
  const count = payload.readUInt16LE(end + 10),
    size = payload.readUInt32LE(end + 12),
    start = payload.readUInt32LE(end + 16);
  if (
    payload.readUInt16LE(end + 4) ||
    payload.readUInt16LE(end + 6) ||
    payload.readUInt16LE(end + 8) !== count
  )
    fail(t("v1 不支持分卷 ZIP。"));
  if (count === 65535 || size === 0xffffffff || start === 0xffffffff)
    fail(t("v1 不支持 ZIP64。"));
  if (count > MAX_ENTRIES) fail(t("超出实现支持范围：最多 10,000 个 ZIP 项。"));
  if (start + size !== end)
    fail(t("中央目录偏移不是以 payload 起点为基准，或使用不支持的 ZIP 扩展。"));
  const extra = (offset: number, length: number) => {
    const stop = offset + length;
    span(offset, length);
    while (offset < stop) {
      if (offset + 4 > stop) fail(t("损坏的 extra 字段。"));
      const id = payload.readUInt16LE(offset),
        n = payload.readUInt16LE(offset + 2);
      offset += 4;
      if (offset + n > stop) fail(t("损坏的 extra 字段。"));
      if (id === 1) fail(t("v1 不支持 ZIP64。"));
      if (id === 0x756e || (id === 0x000d && n > 12))
        fail(t("不支持可能包含链接的 UNIX 扩展。"));
      offset += n;
    }
  };
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
      crc = payload.readUInt32LE(cursor + 16),
      compressed = payload.readUInt32LE(cursor + 20),
      size = payload.readUInt32LE(cursor + 24);
    const n = payload.readUInt16LE(cursor + 28),
      x = payload.readUInt16LE(cursor + 30),
      c = payload.readUInt16LE(cursor + 32),
      attr = payload.readUInt32LE(cursor + 38),
      offset = payload.readUInt32LE(cursor + 42);
    if (payload.readUInt16LE(cursor + 34)) fail(t("不支持分卷条目。"));
    if (flags & 0x2041) fail(t("v1 不支持加密 ZIP。"));
    if (![0, 8].includes(method)) fail(t("v1 不支持压缩方法 {0}。", method));
    if ([size, compressed, offset].includes(0xffffffff))
      fail(t("v1 不支持 ZIP64。"));
    if (size > MAX_FILE || (total += size) > MAX_TOTAL)
      fail(t("超出实现支持范围：单文件 64 MiB / 总量 256 MiB。"));
    span(cursor + 46, n + x + c);
    const rawName = payload.subarray(cursor + 46, cursor + 46 + n);
    let name = "";
    try {
      name = utf8.decode(rawName);
    } catch {
      fail(t("文件名不是有效 UTF-8。"));
    }
    if (!(flags & 0x800) && rawName.some((b) => b > 127))
      fail(t("非 ASCII 文件名必须明确采用 UTF-8 bit 11。"));
    const directory = name!.endsWith("/"),
      type = (attr >>> 16) & 0xf000;
    if (![0, 0x4000, 0x8000].includes(type) || attr & 0x440)
      fail(t("仅允许普通文件和目录，不允许链接或设备。"));
    if ((type === 0x4000 && !directory) || (type === 0x8000 && directory))
      fail(t("目录属性与名称不一致。"));
    if (directory && size) fail(t("目录条目不得包含数据。"));
    extra(cursor + 46 + n, x);
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
    extra(offset + 30 + ln, lx);
    span(dataOffset, compressed);
    const local = [
        payload.readUInt32LE(offset + 14),
        payload.readUInt32LE(offset + 18),
        payload.readUInt32LE(offset + 22),
      ],
      expected = [crc, compressed, size];
    let stop = dataOffset + compressed;
    if (flags & 8) {
      if (
        name !== "mimetype" &&
        local.some((v, j) => v !== 0 && v !== expected[j])
      )
        fail(t("本地 data descriptor 占位值不一致。"));
      span(stop, 4);
      if (payload.readUInt32LE(stop) === 0x08074b50) stop += 4;
      span(stop, 12);
      if (expected.some((v, j) => payload.readUInt32LE(stop + j * 4) !== v))
        fail(t("data descriptor 与中央目录不一致。"));
      stop += 12;
    } else if (local.some((v, j) => v !== expected[j]))
      fail(t("本地头与中央目录 CRC 或大小不一致。"));
    if (name === "mimetype" && (offset !== 0 || method !== 0 || flags & 8))
      fail(t("mimetype 必须为物理首项 STORE，且不能使用 data descriptor。"));
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
  if (physical[0]?.name !== "mimetype" || physical[0]?.offset !== 0)
    fail(t("物理首项必须是 mimetype。"));
  for (let i = 1; i < physical.length; i++)
    if (physical[i].offset < physical[i - 1].end) fail(t("本地条目范围重叠。"));
  const zip = new AdmZip(undefined, { noSort: true });
  let actual = 0;
  const deadline = Date.now() + 15000;
  for (const item of physical) {
    if (Date.now() > deadline)
      fail(t("超出实现支持范围：解压处理时间超过 15 秒。"));
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
      fail(t("超出实现支持范围：解压处理时间超过 15 秒。"));
    if ((actual += bytes.length) > MAX_TOTAL)
      fail(t("超出实现支持范围：实际解压总量超过 256 MiB。"));
    if (item.name === "mimetype" && !bytes.equals(Buffer.from(MIME, "ascii")))
      fail(t("mimetype 字节内容无效。"));
    zip.addFile(item.name, bytes, item.comment, item.attr);
  }
  return zip;
}
