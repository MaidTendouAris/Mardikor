import type { MdkProject, SaveSnapshot } from "./mdk";

export const mdkeCompressionOptions = ["auto", "store", "zstd-3", "zstd-9"] as const;
export type MdkeCompression = (typeof mdkeCompressionOptions)[number];

export function isMdkeCompression(value: unknown): value is MdkeCompression {
  return mdkeCompressionOptions.some((option) => option === value);
}

export type EnvelopeInfo =
  | { kind: "plain" }
  | { kind: "MDKP" | "MDKE"; encrypted: boolean; codec: "store" | "zstd" };

export interface EnvelopeReport {
  outer: "pass";
  innerIdentity: "MDK" | "MDKP" | "invalid";
  innerAuthentication: "not-applicable" | "unverified";
  innerProject: "pass" | "fail" | "unverified";
}

export interface AccessChangeResult {
  project: MdkProject;
  recoveryWarning?: string;
}

export type EnvelopeAction =
  | { kind: "unlock"; passphrase: string }
  | { kind: "set-access"; passphrase: string | null; snapshot: SaveSnapshot }
  | {
      kind: "pack";
      passphrase?: string;
      output: string;
      allowOverlap?: boolean;
      compression?: MdkeCompression;
    }
  | { kind: "extract"; passphrase?: string; output: string }
  | {
      kind: "rekey";
      passphrase?: string;
      nextPassphrase?: string;
      output: string;
    };
