import { useEffect, useMemo, useRef, useState } from "react";
import type { MdkProject } from "../../shared/mdk";
import type { TextBuffer } from "./editor-groups";
import { desktop } from "./desktop";
import {
  readFindOptions,
  searchDocuments,
  searchHit,
  searchPaths,
  writeFindOptions,
  type FindAnchor,
  type FindOptions,
  type SearchHit,
  type SearchResults,
} from "./document-find";

export function useSourceFind(
  file: string,
  project: MdkProject | null,
  buffers: Record<string, TextBuffer>,
  reveal: (hit: SearchHit) => boolean,
) {
  const [anchor, setAnchor] = useState<FindAnchor>();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(readFindOptions);
  const [composing, setComposition] = useState(false);
  const [active, setActive] = useState(-1);
  const [hit, setHit] = useState<SearchHit>();
  const queued = useRef<{ direction: number; paths: string[] } | undefined>(
    undefined,
  );
  const cache = useMemo(
    () => new Map<string, string>(),
    [file, project?.revision],
  );
  const paths = useMemo(
    () =>
      anchor && project ? searchPaths(project, anchor, options.scope) : [],
    [anchor, project, options.scope],
  );
  const snapshot = paths.map(
    (path) => buffers[path]?.content ?? cache.get(path),
  );
  const [computed, setComputed] = useState<{
    paths: string[];
    snapshot: (string | undefined)[];
    query: string;
    matchCase: boolean;
    result?: SearchResults;
  }>();
  const fresh =
    computed?.paths === paths &&
    computed.query === query &&
    computed.matchCase === options.matchCase &&
    snapshot.every((content, index) => content === computed.snapshot[index]);
  const current = anchor && query && !composing && fresh ? computed : undefined;

  useEffect(() => {
    // Clean buffers can be evicted when navigation opens a different document.
    for (const path of paths) {
      const buffer = buffers[path];
      if (buffer) cache.set(path, buffer.saved);
    }
    if (!anchor || !query || composing || fresh) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const missing = paths.filter(
            (_, index) => snapshot[index] === undefined,
          );
          if (missing.length) {
            const api = desktop();
            const saved =
              project?.format === "markdown"
                ? [await api.invoke("readText", file, missing[0])]
                : await api.invoke("readDocuments", file, missing);
            signal.throwIfAborted();
            for (const { path, content } of saved) cache.set(path, content);
          }
          const contents = snapshot.map(
            (content, index) => content ?? cache.get(paths[index]),
          );
          const result = await searchDocuments(
            paths.map((path, index) => ({
              path,
              content: contents[index] ?? "",
            })),
            query,
            options.matchCase,
            signal,
          );
          signal.throwIfAborted();
          setActive(-1);
          setHit(undefined);
          setComputed({
            paths,
            snapshot: contents,
            query,
            matchCase: options.matchCase,
            result,
          });
        } catch {
          if (!signal.aborted)
            setComputed({
              paths,
              snapshot,
              query,
              matchCase: options.matchCase,
            });
        }
      })();
    }, 60);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [
    anchor,
    query,
    options.matchCase,
    paths,
    composing,
    buffers,
    cache,
    file,
    fresh,
  ]);

  function navigate(result: SearchResults | undefined, direction: number) {
    if (!result?.total) return;
    const next =
      active < 0
        ? direction > 0
          ? 0
          : result.total - 1
        : (active + direction + result.total) % result.total;
    jump(result, next);
  }

  function jump(result: SearchResults, index: number) {
    const match = searchHit(result, index);
    if (!match || !reveal(match)) return;
    setActive(index);
    setHit(match);
  }

  useEffect(() => {
    if (!current) return;
    const request = queued.current;
    queued.current = undefined;
    if (request?.paths === paths) navigate(current.result, request.direction);
  }, [current]);

  return {
    anchor,
    setAnchor,
    open(value: FindAnchor) {
      if (anchor) return;
      setOptions(readFindOptions());
      setAnchor(value);
    },
    close() {
      setAnchor(undefined);
      queued.current = undefined;
      setComputed(undefined);
      setActive(-1);
      setHit(undefined);
      setComposition(false);
    },
    query,
    setQuery(value: string) {
      queued.current = undefined;
      setQuery(value);
    },
    setComposition,
    options,
    changeOptions(value: FindOptions) {
      queued.current = undefined;
      writeFindOptions(value);
      setOptions(value);
    },
    active: current?.result ? active : -1,
    total: current?.result?.total ?? 0,
    pending: !!query && !current,
    error: !!current && !current.result,
    hit: current?.result ? hit : undefined,
    results: current?.result,
    jump(index: number) {
      if (current?.result && Number.isSafeInteger(index))
        jump(current.result, index);
    },
    step(direction: number) {
      if (current) navigate(current.result, direction);
      else if (anchor && query && !composing)
        queued.current = { direction, paths };
    },
  };
}
