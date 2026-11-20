import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type sodiumModule from "libsodium-wrappers-sumo";
import type { StateAddress } from "libsodium-wrappers-sumo";
import { t } from "../shared/i18n";
import { normalizeUnicode151 } from "../shared/mdk-anchors";
import { compressEnvelope, decompressEnvelope } from "./envelope-zstd";

export type EnvelopeKind = "MDKP" | "MDKE";
type WireKind = EnvelopeKind | "recovery";
export type EnvelopeCodec = "store" | "zstd";
export type EnvelopeKey = { salt: Uint8Array; key: Uint8Array };
export const chunkSize = 1_048_576;
export const maxEnvelopeBytes = 260 * chunkSize;
const maxProjectBytes = 256n * BigInt(chunkSize);
const maxI64 = 0x7fffffffffffffffn;
const overhead = 17;
const finalSize = 56;
const version = 1;
const magic = {
  MDKP: Buffer.from("MDKP\r\n\x1a\n", "ascii"),
  MDKE: Buffer.from("MDKE\r\n\x1a\n", "ascii"),
  recovery: Buffer.from("MDKR\r\n\x1a\n", "ascii"),
};
const endMagic = Buffer.from("MDKEND1\0", "ascii");
const keyDomain = Buffer.from("MDK-ENVELOPE-KEY-V1\0", "ascii");
const recordDomain = Buffer.from("MDK-ENVELOPE-RECORD-V1\0", "ascii");
let sodium: typeof sodiumModule;
let initializing: Promise<void> | undefined;

export function initEnvelopeCrypto() {
  return (initializing ??= import("libsodium-wrappers-sumo").then(
    async ({ default: library }) => {
      await library.ready;
      sodium = library;
    },
  ));
}

export function envelopeKind(bytes: Buffer): EnvelopeKind | undefined {
  const prefix = bytes.subarray(0, 8);
  if (prefix.equals(magic.MDKP)) return "MDKP";
  if (prefix.equals(magic.MDKE)) return "MDKE";
}

export function probeEnvelope(file: string) {
  const fd = fs.openSync(file, "r");
  try {
    const probe = Buffer.alloc(8);
    return envelopeKind(probe.subarray(0, fs.readSync(fd, probe, 0, 8, 0)));
  } finally {
    fs.closeSync(fd);
  }
}

export function readBoundedFile(file: string, limit = maxEnvelopeBytes) {
  const cap = BigInt(limit);
  const before = fs.statSync(file, { bigint: true });
  if (!before.isFile() || before.size > cap) throw limitError();
  const fd = fs.openSync(file, "r");
  try {
    const start = fs.fstatSync(fd, { bigint: true });
    if (!start.isFile() || start.size > cap) throw limitError();
    const data = Buffer.allocUnsafe(Number(start.size));
    let at = 0n;
    while (at < start.size) {
      const count = fs.readSync(
        fd,
        data,
        Number(at),
        Math.min(chunkSize, Number(start.size - at)),
        at,
      );
      if (!count) break;
      at += BigInt(count);
    }
    const end = fs.fstatSync(fd, { bigint: true });
    if (
      at !== start.size ||
      end.mtimeNs !== start.mtimeNs ||
      end.size !== start.size
    )
      throw new Error(t("封装操作期间源文件已变化。"));
    return data;
  } finally {
    fs.closeSync(fd);
  }
}

function limitError() {
  return new Error(t("封装超过本机资源限额。"));
}
function structureError() {
  return new Error(t("封装结构无效或文件已截断。"));
}
function authError() {
  return new Error(t("口令不正确，或文件已损坏。"));
}
function integrityError() {
  return new Error(t("封装长度或 SHA-256 校验失败。"));
}

export function passwordBytes(password: unknown) {
  if (
    typeof password !== "string" ||
    password.length > 4096 ||
    password.includes("\0") ||
    /[\r\n\uD800-\uDFFF]/u.test(password) ||
    Buffer.byteLength(password) > 4096
  )
    throw new Error(t("口令包含非法字符或超出长度限制。"));
  const normalized = normalizeUnicode151(password);
  const length = Buffer.byteLength(normalized);
  if (!length || length > 1024)
    throw new Error(t("规范化后的口令须为 1 至 1024 字节。"));
  return Buffer.from(normalized, "utf8");
}

export function deriveEnvelopeKey(
  password: string,
  salt: Uint8Array = randomBytes(16),
): EnvelopeKey {
  const bytes = passwordBytes(password);
  try {
    return {
      salt: Uint8Array.from(salt),
      key: sodium.crypto_pwhash(
        32,
        bytes,
        salt,
        3,
        67_108_864,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      ),
    };
  } catch {
    throw limitError();
  } finally {
    bytes.fill(0);
  }
}

function disposeStream(state: StateAddress) {
  // The pinned wrapper exposes the WASM allocator and returns a pointer.
  const { libsodium: wasm } = sodium as unknown as {
    libsodium: {
      HEAPU8: Uint8Array;
      _crypto_secretstream_xchacha20poly1305_statebytes(): number;
      _free(pointer: number): void;
    };
  };
  const pointer = state as unknown as number;
  wasm.HEAPU8.fill(
    0,
    pointer,
    pointer + wasm._crypto_secretstream_xchacha20poly1305_statebytes(),
  );
  wasm._free(pointer);
}

function readWireHeader(bytes: Buffer, recovery = false) {
  const kind: WireKind | false | undefined = recovery
    ? bytes.subarray(0, 8).equals(magic.recovery) && "recovery"
    : envelopeKind(bytes);
  if (!kind) throw new Error(t("无法识别 MDKP 或 MDKE 封装。"));
  if (bytes.length < 32) throw structureError();
  if (bytes.readUInt16LE(8) !== version)
    throw new Error(t("封装版本或算法配置不受支持。"));
  const codecId = bytes[12],
    cipher = bytes[13],
    kdf = bytes[14];
  const encrypted = cipher === 1;
  if (
    codecId > 1 ||
    cipher > 1 ||
    kdf !== cipher ||
    (kind !== "MDKE" && (codecId !== 0 || !encrypted))
  )
    throw new Error(t("封装版本或算法配置不受支持。"));
  const length = encrypted ? 144 : 32;
  if (
    bytes.length < length ||
    bytes.readUInt16LE(10) !== length ||
    bytes[15] !== 0 ||
    bytes.readUInt32LE(16) !== chunkSize ||
    bytes.subarray(20, 32).some((byte) => byte !== 0)
  )
    throw structureError();
  return {
    kind,
    encrypted,
    codec: (codecId === 0 ? "store" : "zstd") as EnvelopeCodec,
    bytes: bytes.subarray(0, length),
    salt: encrypted ? bytes.subarray(32, 48) : undefined,
  };
}
export const readEnvelopeHeader = (bytes: Buffer) => readWireHeader(bytes);

function recordAAD(header: Buffer, index: bigint, prefix: Buffer) {
  const counter = Buffer.allocUnsafe(8);
  counter.writeBigUInt64LE(index);
  return Buffer.concat([recordDomain, header, counter, prefix]);
}

function scanRecords(
  data: Buffer,
  header: ReturnType<typeof readEnvelopeHeader>,
) {
  if (data.length > maxEnvelopeBytes) throw limitError();
  const records: { prefix: Buffer; body: Buffer }[] = [];
  const end = BigInt(data.length);
  for (let at = BigInt(header.bytes.length); at < end;) {
    if (end - at < 4n) throw structureError();
    const prefix = data.subarray(Number(at), Number(at + 4n));
    const length = prefix.readUInt32LE();
    if (
      header.encrypted
        ? length < 18 || length > chunkSize + overhead
        : length > chunkSize
    )
      throw structureError();
    const start = at + 4n;
    at = start + BigInt(!header.encrypted && length === 0 ? finalSize : length);
    if (at > end) throw structureError();
    const body = data.subarray(Number(start), Number(at));
    records.push({ prefix, body });
    if (records.length > Math.ceil(maxEnvelopeBytes / chunkSize) + 1)
      throw structureError();
    if (!header.encrypted && length === 0 && at !== end) throw structureError();
  }
  const last = records.at(-1);
  if (
    records.length < 2 ||
    (header.encrypted
      ? last!.body.length !== finalSize + overhead
      : last!.prefix.readUInt32LE() !== 0)
  )
    throw structureError();
  const full = chunkSize + (header.encrypted ? overhead : 0);
  for (let i = 0; i < records.length - 2; i++)
    if (records[i].body.length !== full) throw structureError();
  return records;
}

export function inspectEnvelope(data: Buffer) {
  const header = readEnvelopeHeader(data);
  scanRecords(data, header);
  return {
    kind: header.kind as EnvelopeKind,
    codec: header.codec,
    encrypted: header.encrypted,
  };
}

function encodeWire(
  restored: Buffer,
  kind: WireKind,
  codec: EnvelopeCodec,
  access?: EnvelopeKey,
  compressionLevel: 3 | 9 = 3,
) {
  if (kind !== "MDKE" && (!access || codec !== "store")) throw structureError();
  const n = BigInt(restored.length);
  if (
    !n ||
    n >
      (kind === "MDKP" ? maxProjectBytes : BigInt(maxEnvelopeBytes - chunkSize))
  )
    throw limitError();
  const encoded = codec === "zstd" ? compressEnvelope(restored, compressionLevel) : restored;
  const header = Buffer.alloc(access ? 144 : 32);
  magic[kind].copy(header);
  header.writeUInt16LE(version, 8);
  header.writeUInt16LE(header.length, 10);
  header[12] = codec === "zstd" ? 1 : 0;
  header.writeUInt32LE(chunkSize, 16);
  let state: StateAddress | undefined;
  const parts: Uint8Array[] = [header];
  try {
    if (access) {
      const dek = randomBytes(32);
      try {
        const stream =
          sodium.crypto_secretstream_xchacha20poly1305_init_push(dek);
        state = stream.state;
        const nonce = randomBytes(24);
        header[13] = header[14] = 1;
        header.set(access.salt, 32);
        header.set(nonce, 48);
        header.set(stream.header, 72);
        header.set(
          sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
            dek,
            Buffer.concat([keyDomain, header.subarray(0, 96)]),
            null,
            nonce,
            access.key,
          ),
          96,
        );
      } finally {
        dek.fill(0);
      }
    }
    let index = 0n;
    function record(body: Buffer, final: boolean) {
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32LE(
        state === undefined
          ? final
            ? 0
            : body.length
          : body.length + overhead,
      );
      parts.push(
        prefix,
        state === undefined
          ? body
          : sodium.crypto_secretstream_xchacha20poly1305_push(
              state,
              body,
              recordAAD(header, index, prefix),
              final ? 3 : 0,
            ),
      );
      index++;
    }
    for (let at = 0; at < encoded.length; at += chunkSize)
      record(encoded.subarray(at, at + chunkSize), false);
    const ending = Buffer.alloc(finalSize);
    endMagic.copy(ending);
    ending.writeBigUInt64LE(n, 8);
    ending.writeBigUInt64LE(BigInt(encoded.length), 16);
    createHash("sha256").update(restored).digest().copy(ending, 24);
    record(ending, true);
    const output = Buffer.concat(parts);
    if (output.length > maxEnvelopeBytes) throw limitError();
    return output;
  } finally {
    if (state !== undefined) disposeStream(state);
    if (access && encoded !== restored) encoded.fill(0);
  }
}

export function encodeEnvelope(
  restored: Buffer,
  kind: EnvelopeKind,
  codec: EnvelopeCodec,
  access?: EnvelopeKey,
  compressionLevel?: 3 | 9,
) {
  return encodeWire(restored, kind, codec, access, compressionLevel);
}

function decodeWire(data: Buffer, access?: EnvelopeKey, recovery = false) {
  const header = readWireHeader(data, recovery);
  const records = scanRecords(data, header);
  let state: StateAddress | undefined;
  const chunks: Uint8Array[] = [];
  let encoded: Buffer | undefined,
    restored: Buffer | undefined,
    finished = false;
  let final: Buffer | undefined;
  try {
    if (header.encrypted) {
      if (!access) throw new Error(t("需要输入该封装的口令。"));
      if (!header.salt!.equals(access.salt)) throw authError();
      let dek: Uint8Array;
      try {
        dek = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          header.bytes.subarray(96),
          Buffer.concat([keyDomain, header.bytes.subarray(0, 96)]),
          header.bytes.subarray(48, 72),
          access.key,
        );
      } catch {
        throw authError();
      }
      try {
        state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
          header.bytes.subarray(72, 96),
          dek,
        );
      } finally {
        dek.fill(0);
      }
    }
    let total = 0n,
      index = 0n;
    for (const { prefix, body } of records) {
      const last = index === BigInt(records.length - 1);
      let plain: Uint8Array = body;
      if (state !== undefined) {
        const result = sodium.crypto_secretstream_xchacha20poly1305_pull(
          state,
          body,
          recordAAD(header.bytes, index, prefix),
        );
        if (!result) throw authError();
        if (result.tag !== (last ? 3 : 0)) {
          result.message.fill(0);
          throw structureError();
        }
        plain = result.message;
      }
      if (last) {
        final = Buffer.from(plain.buffer, plain.byteOffset, plain.byteLength);
        if (
          final.length !== finalSize ||
          !final.subarray(0, 8).equals(endMagic)
        )
          throw structureError();
      } else {
        chunks.push(plain);
        total += BigInt(plain.length);
        if (total > BigInt(maxEnvelopeBytes)) throw limitError();
      }
      index++;
    }
    const n = final!.readBigUInt64LE(8),
      l = final!.readBigUInt64LE(16);
    if (!n || !l || n > maxI64 || l > maxI64) throw structureError();
    if (
      n >
      (header.kind === "MDKP"
        ? maxProjectBytes
        : BigInt(maxEnvelopeBytes - chunkSize))
    )
      throw limitError();
    if (total !== l || (header.codec === "store" && n !== l))
      throw integrityError();
    encoded = Buffer.concat(chunks, Number(total));
    restored =
      header.codec === "store" ? encoded : decompressEnvelope(encoded, n);
    if (
      BigInt(restored.length) !== n ||
      !timingSafeEqual(
        createHash("sha256").update(restored).digest(),
        final!.subarray(24),
      )
    )
      throw integrityError();
    finished = true;
    return restored;
  } finally {
    if (state !== undefined) disposeStream(state);
    if (header.encrypted) {
      for (const bytes of chunks) bytes.fill(0);
      final?.fill(0);
      if (encoded !== restored || !finished) encoded?.fill(0);
      if (!finished) restored?.fill(0);
    }
  }
}

export function decodeEnvelope(data: Buffer, access?: EnvelopeKey) {
  return decodeWire(data, access);
}

export function sealRecovery(data: Buffer, access: EnvelopeKey, owner: string) {
  const plain = Buffer.concat([
    createHash("sha256").update(owner).digest(),
    data,
  ]);
  try {
    return encodeWire(plain, "recovery", "store", access);
  } finally {
    plain.fill(0);
  }
}

export function openRecovery(data: Buffer, access: EnvelopeKey, owner: string) {
  const plain = decodeWire(data, access, true);
  const expected = createHash("sha256").update(owner).digest();
  if (plain.length < 32 || !timingSafeEqual(expected, plain.subarray(0, 32))) {
    plain.fill(0);
    throw authError();
  }
  return plain.subarray(32);
}
