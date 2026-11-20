import { mkdirSync, mkdtempSync, renameSync, rmdirSync, rmSync } from "node:fs";
import path from "node:path";
import { createMdkProject } from "../electron/mdk";

const directory = path.resolve("build-output/shellnew");
mkdirSync(directory, { recursive: true });
const staging = mkdtempSync(path.join(directory, "template-"));
const template = path.join(staging, "Blank.mdk");
try {
  createMdkProject(template, "00", false);
  renameSync(template, path.join(directory, "Blank.mdk"));
} finally {
  rmSync(template, { force: true });
  rmdirSync(staging);
}
