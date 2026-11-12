package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"
)

func mockRAGScore(t *testing.T, score func(int, string) (float64, bool)) *int {
	t.Helper()
	previous := ragHTTPClient
	calls := 0
	ragHTTPClient = &http.Client{Transport: ragRoundTripper(func(r *http.Request) (*http.Response, error) {
		calls++
		var body struct {
			Questions map[string]ragDecisionQuestion `json:"questions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		answers := map[string]any{}
		for key, question := range body.Questions {
			if question.Type != "score" || len(question.Criteria) != 4 {
				t.Fatalf("invalid score contract: %#v", question)
			}
			if value, ok := score(calls, key); ok {
				answers[key] = map[string]any{"type": "score", "score": value}
			}
		}
		data, _ := json.Marshal(map[string]any{"answers": answers})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(data)))}, nil
	})}
	t.Cleanup(func() { ragHTTPClient = previous })
	return &calls
}
func ragCandidates(count int) []RAGSearchResult {
	results := make([]RAGSearchResult, count)
	for i := range results {
		results[i] = RAGSearchResult{FilePath: fmt.Sprintf("%d.md", i), Text: fmt.Sprintf("Evidence %d", i), Score: float64(count - i)}
	}
	return results
}
func TestRerankOFFAndProviderIsolation(t *testing.T) {
	for _, provider := range []string{"", "off", "gemini", "jev"} {
		t.Run(provider, func(t *testing.T) {
			previous := ragHTTPClient
			calls := 0
			ragHTTPClient = &http.Client{Transport: ragRoundTripper(func(r *http.Request) (*http.Response, error) {
				calls++
				expectedURL, expectedAuth, expectedGoogle := decisionEndpoint, "", "gemini-only"
				if provider == "jev" {
					expectedURL, expectedAuth, expectedGoogle = typeSafeDecisionsURL, "Bearer jev-only", ""
				}
				if r.URL.String() != expectedURL || r.Header.Get("Authorization") != expectedAuth || r.Header.Get("x-goog-api-key") != expectedGoogle {
					t.Fatalf("wrong provider/key: %s", r.URL)
				}
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"answers":{"candidate_0":{"type":"score","score":2.8}}}`))}, nil
			})}
			defer func() { ragHTTPClient = previous }()
			result, warnings, err := rerankRAGCandidates("query", ragCandidates(1), RAGSetting{TopK: 1, RerankProvider: provider, GeminiAPIKey: "gemini-only", JevAPIKey: "jev-only", SearchUntilMatch: true})
			if err != nil || len(warnings) != 0 || len(result) != 1 {
				t.Fatalf("unexpected result %v %v", warnings, err)
			}
			enabled := provider == "gemini" || provider == "jev"
			if enabled && (calls != 1 || result[0].RerankScore == nil || *result[0].RerankScore != 2.8) {
				t.Fatal("missing score")
			}
			if !enabled && (calls != 0 || result[0].RerankScore != nil) {
				t.Fatal("OFF called API")
			}
		})
	}
	if _, err := ragRerankClient(RAGSetting{RerankProvider: "gemini", JevAPIKey: "jev-only"}); err == nil {
		t.Fatal("Gemini reused Jev key")
	}
	if _, err := ragRerankClient(RAGSetting{RerankProvider: "jev", JevUseOpenRouter: true, GeminiAPIKey: "gemini-only"}); err == nil {
		t.Fatal("Jev reused Gemini key")
	}
	client, err := ragRerankClient(RAGSetting{RerankProvider: "jev", JevUseOpenRouter: true, JevAPIKey: "router-only"})
	if err != nil || client.decisionEndpoint != openRouterDecisionsURL {
		t.Fatal("incorrect OpenRouter routing")
	}
}
func TestRerankPreservesMediaPositionsAndRetrievalScores(t *testing.T) {
	mockRAGScore(t, func(_ int, key string) (float64, bool) {
		if key == "candidate_1" {
			return 3, true
		}
		return 0, true
	})
	candidates := ragCandidates(3)
	candidates[1].Text = "[Audio: voice.mp3]"
	result, warnings, err := rerankRAGCandidates("query", candidates, RAGSetting{TopK: 3, RerankProvider: "gemini", GeminiAPIKey: "test"})
	if err != nil || len(warnings) != 1 || result[0].FilePath != "2.md" || result[1].FilePath != "1.md" || result[2].FilePath != "0.md" {
		t.Fatalf("wrong ranking %#v %v %v", result, warnings, err)
	}
	if result[1].RerankScore != nil || result[1].RerankSkippedReason == "" || result[0].Score != candidates[2].Score {
		t.Fatal("media/retrieval metadata lost")
	}
}
func TestRerankFailureRestoresOriginalIncludingLaterBatch(t *testing.T) {
	for _, repeat := range []bool{false, true} {
		t.Run(fmt.Sprint(repeat), func(t *testing.T) {
			mockRAGScore(t, func(call int, key string) (float64, bool) {
				if !repeat || call > 1 {
					return 0, false
				}
				return 0, true
			})
			candidates := ragCandidates(80)
			result, warnings, err := rerankRAGCandidates("query", candidates, RAGSetting{TopK: 3, RerankProvider: "gemini", GeminiAPIKey: "test", SearchUntilMatch: repeat})
			if err != nil || len(warnings) != 1 || !reflect.DeepEqual(result, candidates[:3]) {
				t.Fatalf("failure lost original results: %#v %v %v", result, warnings, err)
			}
		})
	}
}
func TestRerankRepeatStopsOnThresholdAndUnscorableMedia(t *testing.T) {
	calls := mockRAGScore(t, func(call int, key string) (float64, bool) {
		if call == 2 && key == "candidate_1" {
			return 2, true
		}
		return 1.9, true
	})
	result, warnings, err := rerankRAGCandidates("query", ragCandidates(100), RAGSetting{TopK: 3, RerankProvider: "gemini", GeminiAPIKey: "test", SearchUntilMatch: true})
	if err != nil || len(warnings) != 0 || len(result) != 1 || result[0].FilePath != "41.md" || *calls != 2 {
		t.Fatalf("wrong stop condition %#v %v %v", result, warnings, err)
	}
	candidates := ragCandidates(2)
	candidates[0].Text = "[Image: scan.png]"
	result, warnings, err = rerankRAGCandidates("query", candidates, RAGSetting{TopK: 2, RerankProvider: "gemini", GeminiAPIKey: "test", SearchUntilMatch: true})
	if err != nil || len(warnings) < 1 || len(result) != 2 || result[0].FilePath != candidates[0].FilePath || !reflect.DeepEqual(result[1], candidates[1]) || *calls != 2 {
		t.Fatal("unscorable media treated as low relevance")
	}
	if result[0].RerankSkippedReason == "" || !result[0].JevUnchecked || result[0].RerankScore != nil {
		t.Fatal("repeat fallback lost unscorable media metadata")
	}
}
func TestHybridRecoversKeywordOutsideVectorPool(t *testing.T) {
	index := &RAGIndex{Dimension: 2, Meta: []RAGChunkMeta{{FilePath: "vector.md", Text: "semantic hit"}, {FilePath: "exact.md", Text: "E02 保存方法"}}}
	result := HybridSearch("E02", []float64{1, 0}, index, []float32{1, 0, 0, 1}, 5, 5, 0.3, 60)
	if len(result) != 2 || result[1].FilePath != "exact.md" || result[1].RetrievalSource != "bm25" {
		t.Fatalf("keyword recovery failed: %#v", result)
	}
	bm := buildBM25(index.Meta, bm25Snapshot{})
	if got := bm.search("保存", 5); len(got) != 1 || got[0].index != 1 {
		t.Fatal("Japanese BM25 failed")
	}
	cached := bm.snapshot
	index.Meta[1].Text = "replacement"
	if got := buildBM25(index.Meta, cached).search("E02", 5); len(got) != 0 {
		t.Fatal("stale BM25 cached results")
	}
}

func TestRerankFallbackRetainsMediaMetadata(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		key    string
		repeat bool
	}{
		{name: "repeat stops on media", key: "test", repeat: true},
		{name: "scoring failure", key: "test"},
		{name: "locked key"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			mockRAGScore(t, func(int, string) (float64, bool) { return 0, false })
			candidates := ragCandidates(3)
			candidates[1].Text = "[Image: scan.png]"
			results, warnings, err := rerankRAGCandidates("query", candidates, RAGSetting{TopK: 3, RerankProvider: "gemini", GeminiAPIKey: scenario.key, SearchUntilMatch: scenario.repeat})
			if err != nil || len(warnings) == 0 || len(results) != len(candidates) {
				t.Fatalf("unexpected fallback: %v %v", warnings, err)
			}
			for i, result := range results {
				if result.FilePath != candidates[i].FilePath || result.Score != candidates[i].Score || result.RerankScore != nil {
					t.Fatal("fallback changed retrieval order or scores")
				}
			}
			if results[1].RerankSkippedReason == "" || !results[1].JevUnchecked {
				t.Fatal("fallback lost unscorable media metadata")
			}
			if candidates[1].RerankSkippedReason != "" || candidates[1].JevUnchecked {
				t.Fatal("reranking mutated its input")
			}
		})
	}
}
func TestGeminiRerankAPIIntegration(t *testing.T) {
	key := os.Getenv("KIOKUFLOW_TEST_GEMINI_KEY")
	if key == "" {
		t.Skip("set KIOKUFLOW_TEST_GEMINI_KEY for an API integration check")
	}
	client := newRagDecisionClient(key)
	result, err := client.Rerank(context.Background(), "What is the capital of Japan?", []RAGSearchResult{{FilePath: "unrelated.md", Text: "Bananas are yellow fruit."}, {FilePath: "answer.md", Text: "Tokyo is the capital of Japan."}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 2 || result[0].FilePath != "answer.md" || result[0].RerankScore == nil || *result[0].RerankScore < 2 {
		t.Fatalf("unexpected API ranking: %#v", result)
	}
	t.Logf("Gemini returned relevance scores: %.3f, %.3f", *result[0].RerankScore, *result[1].RerankScore)
}

func TestSearchRAGHybridAndRepeatUseOneQueryEmbedding(t *testing.T) {
	previous := ragHTTPClient
	defer func() { ragHTTPClient = previous }()
	embeddings, decisions := 0, 0
	ragHTTPClient = &http.Client{Transport: ragRoundTripper(func(r *http.Request) (*http.Response, error) {
		body := `{"data":[{"embedding":[1,0]}]}`
		if r.URL.Path == "/v1/embeddings" {
			embeddings++
		} else {
			if r.URL.String() != decisionEndpoint {
				t.Fatalf("unexpected destination: %s", r.URL)
			}
			decisions++
			var request struct {
				Questions map[string]ragDecisionQuestion `json:"questions"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatal(err)
			}
			answers := map[string]any{}
			for key := range request.Questions {
				score := 0
				if decisions == 2 && key == "candidate_0" {
					score = 3
				}
				answers[key] = map[string]any{"type": "score", "score": score}
			}
			encoded, _ := json.Marshal(map[string]any{"answers": answers})
			body = string(encoded)
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	app := NewApp()
	app.workspaceConfigDir = t.TempDir()
	if err := app.initializeWorkspaces(); err != nil {
		t.Fatal(err)
	}
	if _, err := app.SetDirectoryBase(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	index := &RAGIndex{Dimension: 2, EmbeddingModel: "test"}
	var vectors []float32
	for i := 0; i < 60; i++ {
		index.Meta = append(index.Meta, RAGChunkMeta{FilePath: fmt.Sprintf("%d.md", i), Text: fmt.Sprintf("ordinary %d", i)})
		vectors = append(vectors, 1, 0)
	}
	index.Meta[59].Text = "E02 exact identifier"
	if err := app.saveRAG("Default", index, vectors); err != nil {
		t.Fatal(err)
	}
	setting := RAGSetting{EmbeddingProvider: "openai", EmbeddingBaseURL: "http://embedding.test", EmbeddingAPIKey: "embedding-only", TopK: 5, ScoreThreshold: 0.3}
	result, err := app.SearchRAG(RAGSearchRequest{Name: "Default", Query: "E02", Setting: setting})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, hit := range result {
		if hit.FilePath == "59.md" {
			found = true
		}
	}
	if !found || embeddings != 1 || decisions != 0 {
		t.Fatalf("hybrid missed keyword or called decisions: %#v %d %d", result, embeddings, decisions)
	}
	disabled := false
	setting.HybridSearch = &disabled
	result, err = app.SearchRAG(RAGSearchRequest{Name: "Default", Query: "E02", Setting: setting})
	if err != nil {
		t.Fatal(err)
	}
	for _, hit := range result {
		if hit.FilePath == "59.md" {
			t.Fatal("vector-only did not respect its candidate pool")
		}
	}
	setting.RerankProvider = "gemini"
	setting.GeminiAPIKey = "gemini-only"
	setting.SearchUntilMatch = true
	result, err = app.SearchRAG(RAGSearchRequest{Name: "Default", Query: "query", Setting: setting})
	if err != nil || len(result) != 1 || decisions != 2 || embeddings != 3 {
		t.Fatalf("repeat regenerated query or did not stop: %#v %v embeddings=%d decisions=%d", result, err, embeddings, decisions)
	}
}

func TestJevRerankAPIIntegration(t *testing.T) {
	key := os.Getenv("KIOKUFLOW_TEST_JEV_KEY")
	if key == "" {
		t.Skip("set KIOKUFLOW_TEST_JEV_KEY for a Jev API integration check")
	}
	for _, repeat := range []bool{false, true} {
		result, warnings, err := rerankRAGCandidates("What is the capital of Japan?", []RAGSearchResult{{FilePath: "unrelated.md", Text: "Bananas are yellow fruit."}, {FilePath: "answer.md", Text: "Tokyo is the capital of Japan."}}, RAGSetting{TopK: 2, RerankProvider: "jev", JevAPIKey: key, SearchUntilMatch: repeat})
		if err != nil || len(warnings) != 0 {
			t.Fatalf("Jev scoring failed: %v %v", err, warnings)
		}
		if len(result) == 0 || result[0].FilePath != "answer.md" || result[0].RerankScore == nil || *result[0].RerankScore < 2 {
			t.Fatalf("unexpected Jev ranking: %#v", result)
		}
		t.Logf("repeat=%v Jev relevance %.3f, returned %d results", repeat, *result[0].RerankScore, len(result))
	}
}
