package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Keep only the most recently searched index and extension scope. The absolute
// directory separates workspaces; source file identity, size and modification
// time invalidate both retrieval data and BM25 after sync or external writes.
// Access is serialized by ragMu, including SyncRAG.
type ragSearchCache struct {
	directory       string
	indexFile       os.FileInfo
	vectorFile      os.FileInfo
	index           *RAGIndex
	vectors         []float32
	extensionsKey   string
	filtered        *RAGIndex
	filteredVectors []float32
	lexical         *bm25Index
}

func sameRAGFile(cached, current os.FileInfo) bool {
	return cached != nil && os.SameFile(cached, current) && cached.Size() == current.Size() && cached.ModTime().Equal(current.ModTime())
}

func (a *App) loadRAGForSearch(name string) (*ragSearchCache, error) {
	directory, err := a.ragDirectory(name, false)
	if err != nil {
		return nil, err
	}
	indexFile, err := os.Stat(filepath.Join(directory, "index.json"))
	if err != nil {
		a.ragSearchCache = nil
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	vectorFile, err := os.Stat(filepath.Join(directory, "vectors.bin"))
	if err != nil {
		a.ragSearchCache = nil
		return nil, err
	}
	if cached := a.ragSearchCache; cached != nil && cached.directory == directory && sameRAGFile(cached.indexFile, indexFile) && sameRAGFile(cached.vectorFile, vectorFile) {
		return cached, nil
	}
	a.ragSearchCache = nil
	index, vectors, err := a.loadRAG(name)
	if err != nil || index == nil {
		return nil, err
	}
	cached := &ragSearchCache{directory: directory, indexFile: indexFile, vectorFile: vectorFile, index: index, vectors: vectors}
	a.ragSearchCache = cached
	return cached, nil
}

func (c *ragSearchCache) filterExtensions(extensions []string) {
	allowed := make(map[string]bool)
	for _, extension := range extensions {
		allowed[strings.ToLower(strings.TrimPrefix(extension, "."))] = true
	}
	keys := make([]string, 0, len(allowed))
	for extension := range allowed {
		keys = append(keys, extension)
	}
	sort.Strings(keys)
	key := strings.Join(keys, "\x00")
	// Distinguish no filter from a filter selecting extensionless files.
	if len(keys) > 0 {
		key = "filtered\x00" + key
	}
	if c.filtered != nil && c.extensionsKey == key {
		return
	}
	c.extensionsKey = key
	c.filtered = &RAGIndex{Dimension: c.index.Dimension}
	c.filteredVectors = nil
	c.lexical = nil
	for i, meta := range c.index.Meta {
		if len(allowed) > 0 && !allowed[strings.ToLower(strings.TrimPrefix(filepath.Ext(meta.FilePath), "."))] {
			continue
		}
		start := i * c.index.Dimension
		end := start + c.index.Dimension
		if end > len(c.vectors) {
			break
		}
		c.filtered.Meta = append(c.filtered.Meta, meta)
		c.filteredVectors = append(c.filteredVectors, c.vectors[start:end]...)
	}
}

func (c *ragSearchCache) keywordSearch(query string, topK int, persist bool) []scoredChunk {
	if c.lexical == nil {
		cacheDir := ""
		if persist {
			cacheDir = c.directory
		}
		c.lexical = loadBM25(c.filtered.Meta, cacheDir)
	}
	return c.lexical.search(query, topK)
}
