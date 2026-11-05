import type { DesktopApi } from "../../shared/desktop";

export function desktop(): DesktopApi {
  if (!window.mardikor) throw new Error("请通过桌面应用打开工程。");
  return window.mardikor;
}
