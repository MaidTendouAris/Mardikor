import type { MdkEntry } from "./mdk";

export function comparePosition(a: string, b: string) {
  const left = a.split(".").map(BigInt);
  const right = b.split(".").map(BigInt);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0n) - (right[i] ?? 0n);
    if (difference !== 0n) return difference < 0n ? -1 : 1;
  }
  return 0;
}

export function normalizeOutline(entries: MdkEntry[]): MdkEntry[] {
  const counters: number[] = [];
  let previousDepth = 0;
  return entries.map((entry) => {
    const depth = Math.min(
      entry.position.split(".").length,
      previousDepth + 1,
    );
    counters[depth - 1] = (counters[depth - 1] ?? 0) + 1;
    counters.length = depth;
    previousDepth = depth;
    return { ...entry, position: counters.slice(0, depth).join(".") };
  });
}
