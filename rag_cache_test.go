package main

import (
	"os"
	"path/filepath"
	"testing"
)

func ragCacheTestApp(t *testing.T) (*App, *RAGIndex, []float32) {
	t.Helper()
	app := NewApp()
	app.workspaceConfigDir = t.TempDir()
	if err := app.initializeWorkspaces(); err != nil {
		t.Fatal(err)
	}
	index := &RAGIndex{Dimension: 2, EmbeddingModel: "test", Meta: []RAGChunkMeta{
		{FilePath: "note.md", Text: "alpha markdown"},
		{FilePath: "paper.pdf", Text: "alpha document"},
		{FilePath: "README", Text: "alpha readme"},
	}}
	vectors := []float32{1, 0, 0, 1, 1, 0}
	if err := app.saveRAG("Default", index, vectors); err != nil {
		t.Fatal(err)
	}
	return app, index, vectors
}

func TestRAGSearchCacheReusesCorpusAndScopesExtensions(t *testing.T) {
	app, _, _ := ragCacheTestApp(t)
	cached, err := app.loadRAGForSearch("Default")
	if err != nil {
		t.Fatal(err)
	}
	cached.filterExtensions([]string{"md"})
	for _, persist := range []bool{true, false} {
		results := cached.keywordSearch("alpha", 5, persist)
		if len(results) != 1 || cached.filtered.Meta[results[0].index].FilePath != "note.md" {
			t.Fatal("wrong extension scope")
		}
	}
	lexical := cached.lexical
	// A warm query must not reread the sidecar or rebuild postings, even when
	// sidecar persistence is disabled (external/composite index settings).
	if err := os.WriteFile(filepath.Join(cached.directory, bm25FileName), []byte("broken cache"), 0o600); err != nil {
		t.Fatal(err)
	}
	reused, err := app.loadRAGForSearch("Default")
	if err != nil || reused != cached {
		t.Fatalf("unchanged corpus was reloaded: %v", err)
	}
	reused.filterExtensions([]string{".MD", "md"})
	reused.keywordSearch("markdown", 5, false)
	if reused.lexical != lexical {
		t.Fatal("warm query rebuilt the lexical index")
	}
	reused.filterExtensions([]string{"pdf"})
	results := reused.keywordSearch("alpha", 5, true)
	if reused.lexical == lexical || len(results) != 1 || reused.filtered.Meta[results[0].index].FilePath != "paper.pdf" {
		t.Fatal("extension change reused the wrong lexical scope")
	}
	reused.filterExtensions([]string{""})
	if len(reused.keywordSearch("alpha", 5, false)) != 1 {
		t.Fatal("extensionless scope failed")
	}
	reused.filterExtensions(nil)
	if len(reused.keywordSearch("alpha", 5, false)) != 3 {
		t.Fatal("unfiltered scope reused extensionless results")
	}
}

func TestRAGSearchCacheInvalidatesOnSourceChanges(t *testing.T) {
	app, index, vectors := ragCacheTestApp(t)
	cached, err := app.loadRAGForSearch("Default")
	if err != nil {
		t.Fatal(err)
	}
	cached.filterExtensions(nil)
	cached.keywordSearch("alpha", 5, true)
	// saveRAG uses atomic replacement. Even an equal-size replacement whose
	// timestamp was preserved must invalidate the in-memory corpus.
	index.Meta[0].Text = "omega markdown"
	if err := app.saveRAG("Default", index, vectors); err != nil {
		t.Fatal(err)
	}
	indexPath := filepath.Join(cached.directory, "index.json")
	if err := os.Chtimes(indexPath, cached.indexFile.ModTime(), cached.indexFile.ModTime()); err != nil {
		t.Fatal(err)
	}
	updated, err := app.loadRAGForSearch("Default")
	if err != nil || updated == cached {
		t.Fatalf("updated index was not reloaded: %v", err)
	}
	updated.filterExtensions(nil)
	if len(updated.keywordSearch("alpha", 5, true)) != 2 || len(updated.keywordSearch("omega", 5, true)) != 1 {
		t.Fatal("stale lexical results survived a sync")
	}
	vectorPath := filepath.Join(updated.directory, "vectors.bin")
	data, err := os.ReadFile(vectorPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeAtomic(vectorPath, data); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(vectorPath, updated.vectorFile.ModTime(), updated.vectorFile.ModTime()); err != nil {
		t.Fatal(err)
	}
	replaced, err := app.loadRAGForSearch("Default")
	if err != nil || replaced == updated {
		t.Fatalf("replaced vector file was not reloaded: %v", err)
	}
	if err := app.DeleteRAGIndex("Default"); err != nil {
		t.Fatal(err)
	}
	if gone, err := app.loadRAGForSearch("Default"); err != nil || gone != nil {
		t.Fatalf("deleted corpus survived in cache: %v", err)
	}
}

func TestRAGSearchCacheSeparatesWorkspacesAndRenames(t *testing.T) {
	app, index, vectors := ragCacheTestApp(t)
	cached, err := app.loadRAGForSearch("Default")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.RenameRAGIndex("Default", "Renamed"); err != nil {
		t.Fatal(err)
	}
	renamed, err := app.loadRAGForSearch("Renamed")
	if err != nil || renamed == cached || renamed.directory == cached.directory {
		t.Fatalf("rename reused the old cache: %v", err)
	}
	if _, err := app.SetWorkspaceDirectory(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	index.Meta = []RAGChunkMeta{{FilePath: "other.md", Text: "other workspace"}}
	if err := app.saveRAG("Renamed", index, vectors[:2]); err != nil {
		t.Fatal(err)
	}
	other, err := app.loadRAGForSearch("Renamed")
	if err != nil || other == renamed {
		t.Fatalf("workspace reused the old cache: %v", err)
	}
	other.filterExtensions(nil)
	if len(other.keywordSearch("alpha", 5, true)) != 0 || len(other.keywordSearch("other", 5, true)) != 1 {
		t.Fatal("lexical results leaked between workspaces")
	}
}
