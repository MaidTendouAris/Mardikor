import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import type { EnvelopeKey } from "./envelope";

export type AccessSession = EnvelopeKey & { file: string };
const active = new AsyncLocalStorage<AccessSession | undefined>();

export function withAccess<T>(
  session: AccessSession | undefined,
  work: () => T,
) {
  return active.run(session, work);
}

export function accessFor(file: string) {
  const current = active.getStore();
  return current?.file === path.resolve(file) ? current : undefined;
}
