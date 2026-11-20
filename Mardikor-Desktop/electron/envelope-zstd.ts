import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { t } from "../shared/i18n";

const windowLimit = 8n * 1024n * 1024n;

export function verifyZstdFrame(data: Buffer, restored: bigint) {
  const invalid = () => new Error(t("Zstandard 帧不符合 MDKE v1 规则。"));
  if (data.length < 9 || data.readUInt32LE(0) !== 0xfd2fb528) throw invalid();
  const descriptor = data[4];
  const single = Boolean(descriptor & 0x20);
  if (descriptor & 8 || !(descriptor & 4)) throw invalid();
  let at = 5;
  if (!single) {
    const window = data[at++];
    const base = 1n << BigInt(10 + (window >> 3));
    if (base + (base / 8n) * BigInt(window & 7) > windowLimit) throw invalid();
  }
  const dictBytes = [0, 1, 2, 4][descriptor & 3];
  if (
    at + dictBytes > data.length ||
    data.subarray(at, at + dictBytes).some((byte) => byte !== 0)
  )
    throw invalid();
  at += dictBytes;
  const sizeBytes = [single ? 1 : 0, 2, 4, 8][descriptor >> 6];
  if (at + sizeBytes > data.length) throw invalid();
  if (sizeBytes) {
    const size =
      sizeBytes === 8
        ? data.readBigUInt64LE(at)
        : BigInt(data.readUIntLE(at, sizeBytes) + (sizeBytes === 2 ? 256 : 0));
    if (size !== restored || (single && size > windowLimit)) throw invalid();
    at += sizeBytes;
  }
  for (;;) {
    if (at + 3 > data.length - 4) throw invalid();
    const block = data.readUIntLE(at, 3);
    const type = (block >> 1) & 3;
    if (type === 3) throw invalid();
    at += 3 + (type === 1 ? 1 : block >> 3);
    if (at > data.length - 4) throw invalid();
    if (block & 1) break;
  }
  if (at !== data.length - 4) throw invalid();
}

export function compressEnvelope(data: Buffer, level: 3 | 9 = 3) {
  if (typeof zstdCompressSync !== "function")
    throw new Error(t("Zstandard 需要 Node.js 22.15 或更新版本。"));
  const encoded = zstdCompressSync(data, {
    params: {
      [constants.ZSTD_c_compressionLevel]: level,
      [constants.ZSTD_c_windowLog]: 23,
      [constants.ZSTD_c_contentSizeFlag]: 0,
      [constants.ZSTD_c_checksumFlag]: 1,
    },
  });
  verifyZstdFrame(encoded, BigInt(data.length));
  return encoded;
}

export function decompressEnvelope(data: Buffer, restored: bigint) {
  if (typeof zstdDecompressSync !== "function")
    throw new Error(t("Zstandard 需要 Node.js 22.15 或更新版本。"));
  verifyZstdFrame(data, restored);
  try {
    return zstdDecompressSync(data, {
      maxOutputLength: Number(restored),
      params: { [constants.ZSTD_d_windowLogMax]: 23 },
    });
  } catch {
    throw new Error(t("Zstandard 解码或帧校验失败。"));
  }
}
