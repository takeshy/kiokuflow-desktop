import type { FileTreeNode } from "./wailsBackend";
import { type FileRef, fileRef } from "./fileRef";

export type FileTreeScope = "workspace" | "files";

const MANAGED_PROJECT_ROOTS = [
  "Dashboards",
  "Memos",
  "Secrets",
  "skills",
  "workflows",
];

function isWorkspaceResourcePath(path: string): boolean {
  const root = path.split("/", 1)[0];
  return MANAGED_PROJECT_ROOTS.some(
    (name) => name.toLowerCase() === root.toLowerCase(),
  );
}

export function isProtectedWorkspaceRoot(
  node: FileTreeNode,
  depth: number,
): boolean {
  return depth === 0 && node.isDir && isWorkspaceResourcePath(node.name);
}

export function scopedTreeRef(scope: FileTreeScope, path: string): FileRef {
  return fileRef(scope, path);
}

export function absoluteFilesPath(base: string, relative: string): string {
  const normalizedBase = base.replace(/[\\/]+$/, "");
  const normalizedRelative = relative.replace(/^\.\/?/, "");
  return normalizedRelative
    ? `${normalizedBase}/${normalizedRelative}`
    : normalizedBase;
}

export function filesystemParentPath(path: string): string {
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed || /^[a-z]:$/i.test(trimmed)) return "";
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return "";
  if (index === 0) return separator;
  if (index === 2 && /^[a-z]:/i.test(trimmed)) {
    return `${trimmed.slice(0, 2)}${separator}`;
  }
  return trimmed.slice(0, index);
}

export function focusedExternalTree(
  nodes: FileTreeNode[],
  directoryBase: string,
  focusPath: string,
): FileTreeNode[] {
  if (!focusPath) return nodes;
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
  const base = normalize(directoryBase);
  const focus = normalize(focusPath);
  if (!base || !focus.startsWith(`${base}/`)) return nodes;
  const relative = focus.slice(base.length + 1);
  if (!relative || relative.includes("/")) return nodes;
  const match = nodes.filter((node) => normalize(node.path) === relative);
  return match.length ? match : nodes;
}

function normalizedTreePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^\.$/, "");
}

/** Keep an explicit folder selection ahead of the active editor's directory. */
export function defaultCreateDirectory(
  selectedDirectory: FileRef | null,
  activeFile: FileRef | null,
  workspacePath = "",
  directoryBase = "",
): FileRef {
  if (selectedDirectory && selectedDirectory.scope !== "absolute") {
    return fileRef(selectedDirectory.scope, normalizedTreePath(selectedDirectory.path));
  }
  let source = activeFile;
  if (source?.scope === "absolute") {
    for (const [scope, base] of [["workspace", workspacePath], ["files", directoryBase]] as const) {
      const normalizedBase = base.replace(/\\/g, "/");
      const root = normalizedBase.replace(/\/+$/, "") || (normalizedBase.startsWith("/") ? "/" : "");
      const prefix = root === "/" ? "/" : `${root}/`;
      const path = source.path.replace(/\\/g, "/");
      if (root && path.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
        source = fileRef(scope, path.slice(prefix.length));
        break;
      }
    }
  }
  if (!source || source.scope === "absolute") return fileRef("workspace", "");
  const path = normalizedTreePath(source.path);
  const separator = path.lastIndexOf("/");
  return fileRef(source.scope, separator >= 0 ? path.slice(0, separator) : "");
}

export function findTreeNode(
  nodes: FileTreeNode[],
  path: string,
): FileTreeNode | undefined {
  const target = normalizedTreePath(path).toLocaleLowerCase();
  for (const node of nodes) {
    if (normalizedTreePath(node.path).toLocaleLowerCase() === target)
      return node;
    const child = findTreeNode(node.children ?? [], path);
    if (child) return child;
  }
}

export function treeMoveIssue(
  nodes: FileTreeNode[],
  sourcePath: string,
  destinationDirectory: string,
): "sameFolder" | "descendant" | "nameConflict" | "missing" | null {
  const source = findTreeNode(nodes, sourcePath);
  const destination = normalizedTreePath(destinationDirectory);
  const parent = destination ? findTreeNode(nodes, destination) : undefined;
  if (!source || (destination && !parent?.isDir)) return "missing";
  if (!canMoveWorkspacePath(source.path, source.isDir, destination)) {
    const normalizedSource = normalizedTreePath(
      source.path,
    ).toLocaleLowerCase();
    return source.isDir &&
      (destination.toLocaleLowerCase() === normalizedSource ||
        destination.toLocaleLowerCase().startsWith(`${normalizedSource}/`))
      ? "descendant"
      : "sameFolder";
  }
  const siblings = destination ? (parent?.children ?? []) : nodes;
  return siblings.some(
    (node) => node.name.toLocaleLowerCase() === source.name.toLocaleLowerCase(),
  )
    ? "nameConflict"
    : null;
}

export function workspaceMoveTarget(
  sourcePath: string,
  destinationDirectory: string,
): string {
  const source = normalizedTreePath(sourcePath);
  const destination = normalizedTreePath(destinationDirectory);
  const name = source.split("/").pop() ?? "";
  return destination ? `${destination}/${name}` : name;
}

export function canMoveWorkspacePath(
  sourcePath: string,
  sourceIsDirectory: boolean,
  destinationDirectory: string,
): boolean {
  const source = normalizedTreePath(sourcePath).toLocaleLowerCase();
  const destination =
    normalizedTreePath(destinationDirectory).toLocaleLowerCase();
  const target = workspaceMoveTarget(
    sourcePath,
    destinationDirectory,
  ).toLocaleLowerCase();
  if (!source || !target || source === target) return false;
  return (
    !sourceIsDirectory ||
    (destination !== source && !destination.startsWith(`${source}/`))
  );
}
