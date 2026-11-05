export const releasePage =
  "https://github.com/MaidTendouAris/Mardikor/releases/latest";
export type UpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "downloaded"
  | "preparing"
  | "error";
export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion?: string;
  lastChecked: number;
  percent: number;
  message: string;
  releaseNotes: string;
  releaseUrl: string;
  canInstall: boolean;
}
export type UpdateAction = "status" | "check" | "download" | "install";
