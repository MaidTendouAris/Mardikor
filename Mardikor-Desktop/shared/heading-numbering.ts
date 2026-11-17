export function reservedSectionNumbers(positions: Iterable<string>) {
  const sections = new Map<string, Set<string>>();
  for (const position of positions) {
    const parts = position.split(".");
    for (let depth = 1; depth < parts.length; depth++) {
      const parent = parts.slice(0, depth).join(".");
      let children = sections.get(parent);
      if (!children) sections.set(parent, (children = new Set()));
      children.add(parts[depth]);
    }
  }
  return sections;
}

export function chapterHeadingNumberer(
  position: string,
  reserved?: ReadonlySet<string>,
) {
  const counters = [0, 0, 0, 0, 0];
  let chapterTitleSeen = false;
  return (level: number) => {
    if (level === 1 && !chapterTitleSeen) {
      chapterTitleSeen = true;
      return position;
    }
    const index = Math.max(0, level - 2);
    counters[index]++;
    counters.fill(0, index + 1);
    for (let i = 0; i < index; i++) counters[i] ||= 1;
    while (reserved?.has(String(counters[0]))) counters[0]++;
    return [position, ...counters.slice(0, index + 1)]
      .filter(Boolean)
      .join(".");
  };
}
