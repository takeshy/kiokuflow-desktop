import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  ChevronRight,
  Folder,
  FolderInput,
  Loader2,
  X,
} from "lucide-react";
import { useI18n } from "../i18n/context";
import { findTreeNode, treeMoveIssue } from "../lib/fileTreePaths";
import type { FileTreeNode } from "../lib/wailsBackend";

export function MoveToFolderDialog({
  item,
  nodes,
  rootName,
  onMove,
  onClose,
}: {
  item: FileTreeNode;
  nodes: FileTreeNode[];
  rootName: string;
  onMove: (destination: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [directory, setDirectory] = useState(() =>
    item.path.includes("/")
      ? item.path.slice(0, item.path.lastIndexOf("/"))
      : "",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parts = directory ? directory.split("/") : [];
  const folders = (
    directory ? (findTreeNode(nodes, directory)?.children ?? []) : nodes
  ).filter((node) => node.isDir);
  const destination = selected ?? directory;
  const issue = treeMoveIssue(nodes, item.path, destination);
  const navigate = (path: string) => {
    setDirectory(path);
    setSelected(null);
    setError("");
  };
  const goUp = () => navigate(parts.slice(0, -1).join("/"));

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="tree-move-dialog"
      aria-labelledby="tree-move-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (!busy && directory && event.altKey && event.key === "ArrowUp") {
          event.preventDefault();
          goUp();
        }
      }}
    >
      <div className="tree-move-content" aria-busy={busy}>
        <header>
          <FolderInput size={16} />
          <strong id="tree-move-title">
            {t("files.moveFolderTitle").replace("{name}", item.name)}
          </strong>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </header>
        <fieldset disabled={busy}>
          <div className="tree-move-navigation">
            <button
              type="button"
              disabled={!directory}
              onClick={goUp}
              aria-label={t("files.parentFolder")}
              title={t("files.parentFolder")}
            >
              <ArrowUp size={16} />
            </button>
            <nav aria-label={t("files.moveDestination")}>
              <button type="button" onClick={() => navigate("")}>
                {rootName}
              </button>
              {parts.map((part, index) => {
                const path = parts.slice(0, index + 1).join("/");
                return (
                  <span key={path}>
                    <ChevronRight size={14} />
                    <button type="button" onClick={() => navigate(path)}>
                      {part}
                    </button>
                  </span>
                );
              })}
            </nav>
          </div>
          <p className="tree-move-hint">{t("files.moveFolderHint")}</p>
          <ul aria-label={t("files.moveDestination")}>
            {folders.map((folder) => {
              const blocked =
                treeMoveIssue(nodes, item.path, folder.path) === "descendant";
              return (
                <li
                  key={folder.path}
                  className={selected === folder.path ? "selected" : ""}
                >
                  <button
                    type="button"
                    disabled={blocked}
                    aria-pressed={selected === folder.path}
                    onClick={() => {
                      setSelected(folder.path);
                      setError("");
                    }}
                    onDoubleClick={() => navigate(folder.path)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "ArrowRight") {
                        event.preventDefault();
                        navigate(folder.path);
                      }
                    }}
                  >
                    <Folder size={16} />
                    <span>{folder.name}</span>
                  </button>
                  <button
                    type="button"
                    disabled={blocked}
                    aria-label={t("files.openFolder").replace(
                      "{name}",
                      folder.name,
                    )}
                    onClick={() => navigate(folder.path)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </li>
              );
            })}
            {!folders.length && (
              <li className="tree-move-empty">{t("files.noSubfolders")}</li>
            )}
          </ul>
        </fieldset>
        <footer>
          <p className="tree-move-destination">
            <span>{t("files.moveDestination")}</span>
            <strong title={destination || rootName}>
              {destination || rootName}
            </strong>
          </p>
          <p role="status" className="tree-move-status">
            {error || (issue ? t(`files.moveIssue.${issue}`) : "")}
          </p>
          <div className="tree-move-actions">
            <button type="button" autoFocus disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || issue !== null}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await onMove(destination);
                  onClose();
                } catch (moveError) {
                  setError(
                    moveError instanceof Error
                      ? moveError.message
                      : String(moveError),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 size={14} className="spin" />}
              {t("files.moveAction")}
            </button>
          </div>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
