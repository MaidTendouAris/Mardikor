import fs from "node:fs";
import { createHash } from "node:crypto";
import { MAX_TOTAL } from "./archive";

// Watching the pathname (not the inode) also catches atomic replacements.
export function watchProjectFile(
  file: string,
  notify: (revision: string | null) => void,
  persistent = false,
) {
  let alive = true;
  let generation = 0;
  const changed = (stats: fs.Stats) => {
    const request = ++generation;
    if (!stats.isFile() || stats.size > MAX_TOTAL) {
      notify(null);
      return;
    }
    const hash = createHash("sha256");
    const input = fs.createReadStream(file);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => {
      if (alive && generation === request) notify(hash.digest("hex"));
    });
    input.on("error", () => {
      if (alive && generation === request) notify(null);
    });
  };
  fs.watchFile(file, { interval: 650, persistent }, changed);
  return () => {
    alive = false;
    fs.unwatchFile(file, changed);
  };
}
