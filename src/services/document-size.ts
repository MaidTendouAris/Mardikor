// Full-document parsing and source editor tuning use separate budgets.
const sourceOptimizationThreshold = 160_000;
export const previewTextLimit = 2_000_000;
export const canEditVisually = (text: string) =>
  text.length <= previewTextLimit;
export const isLargeDocument = (text: string) =>
  text.length >= sourceOptimizationThreshold ||
  /(?:^|[\r\n])[^\r\n]{8192}/.test(text);
