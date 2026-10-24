import { test } from "vitest";
import { assertEquals } from "../testing/assert";
import {
  absoluteFilesPath,
  defaultCreateDirectory,
  canMoveWorkspacePath,
  filesystemParentPath,
  focusedExternalTree,
  isProtectedWorkspaceRoot,
  scopedTreeRef,
  workspaceMoveTarget,
  treeMoveIssue,
} from "../lib/fileTreePaths.ts";
import type { FileTreeNode } from "../lib/wailsBackend.ts";

const node = (name: string, isDir = true): FileTreeNode => ({
  name,
  path: name,
  isDir,
  size: 0,
  modTime: 0,
});

test("outside Workspace drag paths are pinned to their absolute Files path", () => {
  assertEquals(
    absoluteFilesPath("C:\\Users\\takes\\Documents", "projects/Research"),
    "C:\\Users\\takes\\Documents/projects/Research",
  );
  assertEquals(
    absoluteFilesPath("C:\\Users\\takes\\Documents\\", "."),
    "C:\\Users\\takes\\Documents",
  );
});

test("outside Workspace can reveal one selected file and climb its parents", () => {
  const files = [node("one.md", false), node("two.md", false)];
  assertEquals(
    focusedExternalTree(
      files,
      "C:\\Users\\me\\docs",
      "C:\\Users\\me\\docs\\two.md",
    ),
    [files[1]],
  );
  assertEquals(
    filesystemParentPath("C:\\Users\\me\\docs\\two.md"),
    "C:\\Users\\me\\docs",
  );
  assertEquals(filesystemParentPath("C:\\Users\\me\\docs"), "C:\\Users\\me");
  assertEquals(filesystemParentPath("/Users/me/docs"), "/Users/me");
  assertEquals(filesystemParentPath("/"), "");
});

test("only managed workspace roots are protected", () => {
  assertEquals(isProtectedWorkspaceRoot(node("skills"), 0), true);
  assertEquals(isProtectedWorkspaceRoot(node("notes"), 0), false);
  assertEquals(isProtectedWorkspaceRoot(node("loose.md", false), 0), false);
  assertEquals(isProtectedWorkspaceRoot(node("skills"), 1), false);
});

test("workspace files retain their filesystem scope", () => {
  assertEquals(
    scopedTreeRef("workspace", "readme.md"),
    { scope: "workspace", path: "readme.md" },
  );
  assertEquals(
    scopedTreeRef("workspace", "notes/readme.md"),
    { scope: "workspace", path: "notes/readme.md" },
  );
  assertEquals(
    scopedTreeRef("workspace", "Memos/today.md"),
    { scope: "workspace", path: "Memos/today.md" },
  );
  assertEquals(scopedTreeRef("files", "readme.md"), {
    scope: "files",
    path: "readme.md",
  });
});

test("workspace drag targets preserve the item name", () => {
  assertEquals(
    workspaceMoveTarget("notes/today.md", "archive"),
    "archive/today.md",
  );
  assertEquals(workspaceMoveTarget("notes/today.md", ""), "today.md");
});

test("workspace drag rejects no-op and recursive directory moves", () => {
  assertEquals(canMoveWorkspacePath("notes/today.md", false, "archive"), true);
  assertEquals(canMoveWorkspacePath("notes/today.md", false, "notes"), false);
  assertEquals(canMoveWorkspacePath("notes", true, "notes/old"), false);
  assertEquals(canMoveWorkspacePath("notes", true, "notes"), false);
  assertEquals(canMoveWorkspacePath("notes", true, ""), false);
});

test("folder picker rejects collisions, current parents, and recursive moves", () => {
  const tree: FileTreeNode[] = [
    { ...node("notes"), children: [{ ...node("today.md", false), path: "notes/today.md" }, { ...node("nested"), path: "notes/nested" }] },
    { ...node("archive"), children: [{ ...node("TODAY.md", false), path: "archive/TODAY.md" }] },
    node("empty"),
    node("notes-other"),
  ];
  assertEquals(treeMoveIssue(tree, "notes/today.md", "notes"), "sameFolder");
  assertEquals(treeMoveIssue(tree, "notes", "notes"), "descendant");
  assertEquals(treeMoveIssue(tree, "notes", "notes/nested"), "descendant");
  assertEquals(treeMoveIssue(tree, "notes/today.md", "archive"), "nameConflict");
  assertEquals(treeMoveIssue(tree, "notes/today.md", "empty"), null);
  assertEquals(treeMoveIssue(tree, "notes", "notes-other"), null);
  assertEquals(treeMoveIssue(tree, "notes/today.md", "missing"), "missing");
  assertEquals(treeMoveIssue(tree, "notes/today.md", "notes/today.md"), "missing");
  assertEquals(treeMoveIssue(tree, "notes/today.md", ""), null);
});

test("Files root dot paths resolve to the scope root", () => {
  assertEquals(workspaceMoveTarget("notes/today.md", "."), "today.md");
  assertEquals(canMoveWorkspacePath("today.md", false, "."), false);
  assertEquals(canMoveWorkspacePath("notes", true, "./notes/old"), false);
});

test("new-file directory keeps an explicit selection ahead of the active editor", () => {
  assertEquals(defaultCreateDirectory({ scope: "workspace", path: "Notes" }, { scope: "files", path: "Research/readme.md" }), { scope: "workspace", path: "Notes" });
  assertEquals(defaultCreateDirectory({ scope: "files", path: "." }, { scope: "workspace", path: "Notes/readme.md" }), { scope: "files", path: "" });
});

test("new-file directory follows the active file and retains its filesystem scope", () => {
  assertEquals(defaultCreateDirectory(null, { scope: "workspace", path: "Notes/Nested/readme.md" }), { scope: "workspace", path: "Notes/Nested" });
  assertEquals(defaultCreateDirectory(null, { scope: "files", path: "Notes/Nested/readme.md" }), { scope: "files", path: "Notes/Nested" });
  assertEquals(defaultCreateDirectory(null, { scope: "files", path: "readme.md" }), { scope: "files", path: "" });
  assertEquals(defaultCreateDirectory(null, null), { scope: "workspace", path: "" });
});

test("native absolute file opens resolve their parent relative to the matching tree root", () => {
  assertEquals(defaultCreateDirectory(null, { scope: "absolute", path: "/workspace/Notes/readme.md" }, "/workspace", "/external"), { scope: "workspace", path: "Notes" });
  assertEquals(defaultCreateDirectory(null, { scope: "absolute", path: "/external/Research/readme.md" }, "/workspace", "/external"), { scope: "files", path: "Research" });
  assertEquals(defaultCreateDirectory(null, { scope: "absolute", path: "C:\\Users\\me\\Docs\\readme.md" }, "C:\\Project", "C:\\Users\\me"), { scope: "files", path: "Docs" });
  assertEquals(defaultCreateDirectory(null, { scope: "absolute", path: "/notes.md" }, "/workspace", "/"), { scope: "files", path: "" });
});

test("an absolute file outside both writable tree roots cannot redirect creation", () => {
  assertEquals(defaultCreateDirectory(null, { scope: "absolute", path: "/workspace-other/notes.md" }, "/workspace", "/external"), { scope: "workspace", path: "" });
});
