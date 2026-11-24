package main

import "fmt"

// ReadLiveWorkspaceTool exposes only the read operations used by Live voice chat.
func (a *App) ReadLiveWorkspaceTool(workspace, name, arguments string) (any, error) {
	switch name {
	case "read_file", "list_files", "search_files":
	default:
		return nil, fmt.Errorf("unsupported Live Workspace tool %q", name)
	}
	if workspace == "" || a.GetWorkspacePath() != workspace {
		return nil, fmt.Errorf("the active Workspace has changed")
	}
	result, _, err := a.executeFileTool(name, arguments, pdfExtractText)
	if a.GetWorkspacePath() != workspace {
		return nil, fmt.Errorf("the active Workspace has changed")
	}
	return result, err
}
