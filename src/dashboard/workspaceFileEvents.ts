// Both external file updates and workspace switches can change an open widget.
const WORKSPACE_FILE_EVENTS = [
  "llm-hub:file-tree-refresh",
  "llm-hub:dashboard-data-changed",
  "llm-hub:workspace-changed",
] as const;

export function subscribeWorkspaceFileChanges(
  target: EventTarget,
  refresh: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  };
  for (const event of WORKSPACE_FILE_EVENTS) target.addEventListener(event, schedule);
  return () => {
    clearTimeout(timer);
    for (const event of WORKSPACE_FILE_EVENTS) target.removeEventListener(event, schedule);
  };
}
