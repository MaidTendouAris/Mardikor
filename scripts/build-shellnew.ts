import { mkdirSync } from "node:fs";
import path from "node:path";
import { createMdkProject } from "../electron/mdk";

const directory = path.resolve("build-output/shellnew");
mkdirSync(directory, { recursive: true });
createMdkProject(path.join(directory, "Blank.mdk"), "00");
