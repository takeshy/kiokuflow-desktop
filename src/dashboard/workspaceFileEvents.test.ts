import { afterEach, expect, test, vi } from "vitest";
import { subscribeWorkspaceFileChanges } from "./workspaceFileEvents";

afterEach(() => vi.useRealTimers());

test("an open widget updates after external files arrive and after a workspace switch", () => {
  vi.useFakeTimers();
  const events = new EventTarget();
  let files: string[] = [];
  let displayed = files;
  const unsubscribe = subscribeWorkspaceFileChanges(events, () => { displayed = files; });
  try {
    files = ["Secrets/account.encrypted"];
    events.dispatchEvent(new Event("llm-hub:file-tree-refresh"));
    vi.advanceTimersByTime(300);
    expect(displayed).toEqual(files);

    files = ["Secrets/other-workspace.encrypted"];
    events.dispatchEvent(new Event("llm-hub:workspace-changed"));
    vi.advanceTimersByTime(300);
    expect(displayed).toEqual(files);
  } finally {
    unsubscribe();
  }
});

test("related notifications coalesce and closing the widget cancels queued updates", () => {
  vi.useFakeTimers();
  const events = new EventTarget();
  const refresh = vi.fn();
  const unsubscribe = subscribeWorkspaceFileChanges(events, refresh);
  events.dispatchEvent(new Event("llm-hub:dashboard-data-changed"));
  vi.advanceTimersByTime(100);
  events.dispatchEvent(new Event("llm-hub:file-tree-refresh"));
  vi.advanceTimersByTime(299);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(1);

  events.dispatchEvent(new Event("llm-hub:file-tree-refresh"));
  unsubscribe();
  vi.advanceTimersByTime(300);
  events.dispatchEvent(new Event("llm-hub:workspace-changed"));
  vi.advanceTimersByTime(300);
  expect(refresh).toHaveBeenCalledTimes(1);
});
