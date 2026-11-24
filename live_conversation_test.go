package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLiveWorkspaceToolsAreReadOnlyAndScoped(t *testing.T) {
	workspace := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.md")
	for path, content := range map[string]string{
		filepath.Join(workspace, "note.md"): "visible content",
		outside:                             "outside secret",
	} {
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	app := NewApp()
	app.workspaceState = testWorkspaceState(t, workspace)
	result, err := app.ReadLiveWorkspaceTool(workspace, "read_file", `{"path":"note.md"}`)
	if err != nil || result.(*LocalFileResult).Content != "visible content" {
		t.Fatalf("unexpected read result: %v, %v", result, err)
	}
	for _, test := range []struct {
		workspace string
		tool      string
		args      string
	}{
		{workspace, "create_note", `{"name":"injected","content":"unexpected"}`},
		{workspace, "read_file", `{"path":"files://outside.md"}`},
		{filepath.Dir(outside), "list_files", "{}"},
	} {
		if _, err := app.ReadLiveWorkspaceTool(test.workspace, test.tool, test.args); err == nil {
			t.Fatalf("allowed an invalid Live tool call: %#v", test)
		}
	}
	if runtime.GOOS == "windows" {
		return
	}
	if err := os.Symlink(outside, filepath.Join(workspace, "linked.md")); err != nil {
		t.Fatal(err)
	}
	result, err = app.ReadLiveWorkspaceTool(workspace, "search_files", `{"query":"outside secret"}`)
	if err != nil || len(result.([]FileSearchResult)) != 0 {
		t.Fatalf("search followed a symlink outside Workspace: %v, %v", result, err)
	}
}
