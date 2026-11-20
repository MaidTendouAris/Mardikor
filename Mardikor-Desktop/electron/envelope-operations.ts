import { createHash, timingSafeEqual } from "node:crypto";
import { t } from "../shared/i18n";
import type {
  EnvelopeAction,
  EnvelopeInfo,
  EnvelopeReport,
} from "../shared/envelopes";
import type { MdkProject, SaveSnapshot } from "../shared/mdk";
import {
  decodeEnvelope,
  deriveEnvelopeKey,
  encodeEnvelope,
  envelopeKind,
  initEnvelopeCrypto,
  inspectEnvelope,
  readBoundedFile,
  readEnvelopeHeader,
  type EnvelopeKey,
} from "./envelope";
import { MdkRevisionError, prepareMdkAccessSnapshot, publishVerifiedFile, validateBareMdk } from "./mdk";

export type EnvelopeTask =
  | { kind: "inspect"; file: string }
  | (Extract<EnvelopeAction, { kind: "unlock" }> & { file: string })
  | (Omit<Extract<EnvelopeAction, { kind: "set-access" }>, "snapshot"> & {
      file: string;
      access?: EnvelopeKey;
      revision?: string;
      snapshot?: SaveSnapshot;
    })
  | (Omit<Extract<EnvelopeAction, { kind: "pack" }>, "output"> & {
      file: string;
      access?: EnvelopeKey;
    })
  | {
      kind: "extract" | "rekey";
      file: string;
      passphrase?: string;
      nextPassphrase?: string;
      recovery?: boolean;
    };

type EnvelopeOutput = {
  bytes: Uint8Array;
  revision: string;
  access?: EnvelopeKey;
  project?: MdkProject;
  report?: EnvelopeReport;
};
export type EnvelopeResult =
  EnvelopeInfo | { access: EnvelopeKey } | { overlap: true } | EnvelopeOutput;
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

function inner(
  data: Buffer,
): Pick<
  EnvelopeReport,
  "innerIdentity" | "innerAuthentication" | "innerProject"
> {
  if (envelopeKind(data) === "MDKP") {
    inspectEnvelope(data);
    return {
      innerIdentity: "MDKP",
      innerAuthentication: "unverified",
      innerProject: "unverified",
    };
  }
  const report = validateBareMdk(data);
  return {
    innerIdentity: "MDK",
    innerAuthentication: "not-applicable",
    innerProject: report.valid ? "pass" : "fail",
  };
}

export async function runEnvelopeTask(
  task: EnvelopeTask,
): Promise<EnvelopeResult> {
  const bytes = readBoundedFile(task.file);
  const kind = envelopeKind(bytes);
  if (task.kind === "inspect")
    return kind ? inspectEnvelope(bytes) : { kind: "plain" };
  const revision = hash(bytes);
  if (task.kind === "unlock") {
    if (kind !== "MDKP") throw new Error(t("需要选择受保护的 MDK。"));
    const header = readEnvelopeHeader(bytes);
    inspectEnvelope(bytes);
    await initEnvelopeCrypto();
    const access = deriveEnvelopeKey(task.passphrase, header.salt);
    let plain: Buffer | undefined;
    try {
      plain = decodeEnvelope(bytes, access);
      validateBareMdk(plain);
      return { access };
    } catch (error) {
      access.key.fill(0);
      throw error;
    } finally {
      plain?.fill(0);
    }
  }
  if (task.kind === "set-access") {
    if (task.revision !== undefined && revision !== task.revision)
      throw new MdkRevisionError();
    await initEnvelopeCrypto();
    const original = kind === "MDKP" ? decodeEnvelope(bytes, task.access) : bytes;
    let plain = original;
    let access: EnvelopeKey | undefined;
    let returnPlain = false;
    try {
      const snapshot = task.snapshot && prepareMdkAccessSnapshot(original, revision, task.snapshot);
      if (snapshot) plain = snapshot.bytes;
      validateBareMdk(plain);
      if (task.passphrase === null) {
        returnPlain = true;
        return { bytes: plain, revision, project: snapshot?.project };
      }
      access = deriveEnvelopeKey(task.passphrase);
      const encoded = encodeEnvelope(plain, "MDKP", "store", access);
      const verified = decodeEnvelope(encoded, access);
      try {
        if (!verified.equals(plain))
          throw new Error(t("封装长度或 SHA-256 校验失败。"));
      } finally {
        verified.fill(0);
      }
      return { bytes: encoded, revision, access, project: snapshot?.project };
    } catch (error) {
      access?.key.fill(0);
      throw error;
    } finally {
      if (original !== plain) original.fill(0);
      if (!returnPlain) plain.fill(0);
    }
  }
  if (task.kind === "pack") {
    const identity = inner(bytes);
    let access: EnvelopeKey | undefined;
    try {
      if (task.passphrase !== undefined) {
        await initEnvelopeCrypto();
        if (task.access && !task.allowOverlap) {
          const candidate = deriveEnvelopeKey(
            task.passphrase,
            task.access.salt,
          );
          try {
            if (timingSafeEqual(candidate.key, task.access.key))
              return { overlap: true };
          } finally {
            candidate.key.fill(0);
          }
        }
        access = deriveEnvelopeKey(task.passphrase);
      }
      const compression = task.compression ?? "auto";
      const store = compression === "store" || (compression === "auto" && kind === "MDKP");
      const encoded = encodeEnvelope(
        bytes,
        "MDKE",
        store ? "store" : "zstd",
        access,
        compression === "zstd-9" ? 9 : 3,
      );
      const verified = decodeEnvelope(encoded, access);
      try {
        if (!verified.equals(bytes))
          throw new Error(t("封装长度或 SHA-256 校验失败。"));
      } finally {
        verified.fill(0);
      }
      return {
        bytes: encoded,
        revision,
        report: { outer: "pass", ...identity },
      };
    } finally {
      access?.key.fill(0);
      bytes.fill(0);
    }
  }
  if (kind !== "MDKE") throw new Error(t("请选择有效的 MDKE 分发包。"));
  const header = readEnvelopeHeader(bytes);
  inspectEnvelope(bytes);
  let key: EnvelopeKey | undefined, next: EnvelopeKey | undefined;
  let restored: Buffer | undefined,
    returnPlain = false;
  try {
    if (header.encrypted && task.passphrase !== undefined) {
      await initEnvelopeCrypto();
      key = deriveEnvelopeKey(task.passphrase, header.salt);
    }
    restored = decodeEnvelope(bytes, key);
    let identity: ReturnType<typeof inner>;
    try {
      identity = inner(restored);
    } catch (error) {
      if (task.kind !== "extract" || !task.recovery) throw error;
      identity = {
        innerIdentity: "invalid",
        innerAuthentication: "unverified",
        innerProject: "fail",
      };
    }
    const report: EnvelopeReport = { outer: "pass", ...identity };
    if (task.kind === "extract") {
      returnPlain = true;
      return { bytes: restored, revision, report };
    }
    if (task.nextPassphrase !== undefined) {
      await initEnvelopeCrypto();
      next = deriveEnvelopeKey(task.nextPassphrase);
    }
    const encoded = encodeEnvelope(restored, "MDKE", header.codec, next);
    const verified = decodeEnvelope(encoded, next);
    try {
      if (!verified.equals(restored))
        throw new Error(t("封装长度或 SHA-256 校验失败。"));
    } finally {
      verified.fill(0);
    }
    return { bytes: encoded, revision, report };
  } finally {
    key?.key.fill(0);
    next?.key.fill(0);
    if (!returnPlain) restored?.fill(0);
  }
}

export function publishEnvelopeOutput(
  source: string,
  output: string,
  value: EnvelopeOutput,
  overwrite = false,
) {
  const data = Buffer.from(
    value.bytes.buffer,
    value.bytes.byteOffset,
    value.bytes.byteLength,
  );
  const expected = hash(data);
  try {
    return publishVerifiedFile(
      output,
      data,
      (temporary) => {
        if (hash(readBoundedFile(source)) !== value.revision)
          throw new MdkRevisionError();
        const staged = readBoundedFile(temporary);
        try {
          if (hash(staged) !== expected)
            throw new Error(t("封装长度或 SHA-256 校验失败。"));
        } finally {
          staged.fill(0);
        }
        return expected;
      },
      { overwrite, expectedRevision: overwrite ? value.revision : undefined },
    );
  } finally {
    data.fill(0);
  }
}
