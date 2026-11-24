import { parentPort, workerData } from "node:worker_threads";
import * as mdk from "./mdk";
import { setAppLocale, type AppLocale } from "../shared/i18n";
import { archiveCheckpoint, withArchiveOperation } from "./archive-operation";
import path from "node:path";
import { archiveIndexSnapshot } from "./archive";

const methods = {
  open: mdk.openMdkProject,
  validate: mdk.validateMdk,
  saveSnapshot: mdk.saveMdkSnapshot,
  copyDraft: mdk.copyMdkDraft,
  importResource: mdk.importMdkResource,
  packFont: (file: string, name: string, bytes: Uint8Array, revision: string, license?: Uint8Array) =>
    mdk.packMdkFont(file, name, Buffer.from(bytes), revision, license && Buffer.from(license)),
  saveMdkPublication: mdk.saveMdkPublication,
  importResourcesTo: mdk.importMdkResourceBatch,
  insertResources: (
    file: string,
    sources: Parameters<typeof mdk.insertMdkResources>[1],
    insertion: Parameters<typeof mdk.insertMdkResources>[2],
  ) =>
    mdk.insertMdkResources(
      file,
      sources.map((source) =>
        typeof source === "string"
          ? source
          : { ...source, bytes: Buffer.from(source.bytes) },
      ),
      insertion,
    ),
  extractPlan: (
    file: string,
    paths: string[],
    revision: string,
    resourcesOnly: boolean,
  ) =>
    mdk.prepareMdkResourceExtraction(file, paths, revision, resourcesOnly)
      .filename,
  extractFiles: (
    file: string,
    paths: string[],
    revision: string,
    resourcesOnly: boolean,
    output: string,
  ) =>
    mdk
      .prepareMdkResourceExtraction(file, paths, revision, resourcesOnly)
      .extract(output),
  export: mdk.exportMdk,
  exportPlan: mdk.planMdkExport,
  pack: mdk.packMdk,
  unpack: mdk.unpackMdk,
};

export type ArchiveTask = keyof typeof methods;
const { task, args, progress, locale, expected } = workerData as {
  task: ArchiveTask;
  args: unknown[];
  progress: SharedArrayBuffer;
  locale: AppLocale;
  expected?: string;
};
setAppLocale(locale);

try {
  const result = withArchiveOperation(
    new Int32Array(progress),
    (state) => parentPort!.postMessage({ progress: state }),
    () => {
      archiveCheckpoint();
      if (
        expected !== undefined &&
        mdk.fileRevision(args[0] as string) !== expected
      )
        throw new mdk.MdkRevisionError();
      const value = (methods[task] as (...args: unknown[]) => unknown)(...args);
      archiveCheckpoint();
      return value;
    },
  );
  parentPort!.postMessage({ result, index: archiveIndexSnapshot(path.resolve(args[0] as string)) });
} catch (error) {
  parentPort!.postMessage({
    error: error instanceof Error ? error.message : String(error),
  });
}
