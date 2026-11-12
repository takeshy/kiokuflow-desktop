package main

import (
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// searchTokens follows the common library's cjk-bigram-v1 fallback. Go has no
// Intl.Segmenter, so CJK runs use overlapping bigrams. Latin identifiers are
// retained both whole (PRJ-123, snake_case) and as their separate components.
func searchTokens(text string) []string {
	var tokens []string
	var run []rune
	cjkRun := false
	flush := func() {
		if cjkRun {
			if len(run) == 1 {
				tokens = append(tokens, string(run))
			}
			for i := 1; i < len(run); i++ {
				tokens = append(tokens, string(run[i-1:i+1]))
			}
		} else if len(run) > 0 {
			word := string(run)
			tokens = append(tokens, word)
			if strings.ContainsAny(word, "-_") {
				tokens = append(tokens, strings.FieldsFunc(word, func(r rune) bool { return r == '-' || r == '_' })...)
			}
		}
		run = nil
	}
	runes := []rune(strings.ToLower(norm.NFKC.String(text)))
	isCJK := func(r rune) bool {
		return r == 'ー' || unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul)
	}
	for i, r := range runes {
		if (r == '-' || r == '_') && !cjkRun && len(run) > 0 && i+1 < len(runes) && !isCJK(runes[i+1]) && (unicode.IsLetter(runes[i+1]) || unicode.IsNumber(runes[i+1])) {
			run = append(run, r)
			continue
		}
		if !unicode.IsLetter(r) && !unicode.IsNumber(r) {
			flush()
			continue
		}
		cjk := isCJK(r)
		if len(run) > 0 && cjk != cjkRun {
			flush()
		}
		cjkRun = cjk
		run = append(run, r)
	}
	flush()
	return tokens
}

// keywordRanks computes BM25 from existing metadata; no re-indexing is needed.
func keywordRanks(query string, index *RAGIndex, topK int) []scoredChunk {
	if index == nil || len(index.Meta) == 0 {
		return nil
	}
	return buildBM25(index.Meta, bm25Snapshot{}).search(query, topK)
}

// HybridSearch fuses vector and BM25 rankings using equal-weight RRF.
// minScore gates only the vector branch, so exact keyword hits can be recovered.
func HybridSearch(query string, queryVec []float64, index *RAGIndex, vectors []float32, topK, candidateK int, minScore, rrfK float64) []RAGSearchResult {
	vector := vectorRanks(queryVec, index, vectors, candidateK, minScore)
	keyword := keywordRanks(query, index, candidateK)
	return chunkResults(index, fuseRanks(vector, keyword, topK, rrfK))
}

func fuseRanks(vector, keyword []scoredChunk, topK int, rrfK float64) []scoredChunk {
	if rrfK == 0 {
		rrfK = 60
	}
	positions := make(map[int]int)
	scores := make([]scoredChunk, 0, len(vector)+len(keyword))
	for branch, ranks := range [][]scoredChunk{vector, keyword} {
		for rank, item := range ranks {
			pos, exists := positions[item.index]
			if !exists {
				pos = len(scores)
				positions[item.index] = pos
				source := "vector"
				if branch == 1 {
					source = "bm25"
				}
				scores = append(scores, scoredChunk{index: item.index, source: source})
			} else if branch == 1 {
				scores[pos].source = "both"
			}
			scores[pos].score += 1 / (rrfK + float64(rank+1))
		}
	}
	// Stable ties prefer the vector list, matching the common RRF implementation.
	sort.SliceStable(scores, func(i, j int) bool { return scores[i].score > scores[j].score })
	if topK > 0 && len(scores) > topK {
		scores = scores[:topK]
	}
	return scores
}

type scoredChunk struct {
	index  int
	score  float64
	source string
}

func vectorRanks(queryVec []float64, index *RAGIndex, vectors []float32, topK int, minScore float64) []scoredChunk {
	if index == nil || len(index.Meta) == 0 || len(vectors) == 0 {
		return nil
	}

	dim := index.Dimension

	if dim <= 0 || len(queryVec) != dim || len(vectors)/dim < len(index.Meta) {
		return nil
	}
	scores := make([]scoredChunk, 0, len(index.Meta))
	for i := range index.Meta {
		chunkVec := vectors[i*dim : (i+1)*dim]
		score := cosineRAGSimilarity(queryVec, chunkVec)
		if score > minScore {
			scores = append(scores, scoredChunk{index: i, score: score})
		}
	}

	return sortChunks(scores, topK)
}

func chunkResults(index *RAGIndex, scores []scoredChunk) []RAGSearchResult {
	results := make([]RAGSearchResult, len(scores))
	for i, s := range scores {
		results[i] = RAGSearchResult{
			Text:            index.Meta[s.index].Text,
			FilePath:        index.Meta[s.index].FilePath,
			ChunkIndex:      index.Meta[s.index].ChunkIndex,
			Score:           s.score,
			ContentType:     index.Meta[s.index].ContentType,
			PageLabel:       index.Meta[s.index].PageLabel,
			RetrievalSource: s.source,
		}
	}

	return results
}

func sortChunks(scores []scoredChunk, topK int) []scoredChunk {
	sort.Slice(scores, func(a, b int) bool {
		if scores[a].score == scores[b].score {
			return scores[a].index < scores[b].index
		}
		return scores[a].score > scores[b].score
	})
	if topK > 0 && len(scores) > topK {
		return scores[:topK]
	}
	return scores
}
