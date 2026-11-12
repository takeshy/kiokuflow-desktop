package main

import (
	"context"
	"fmt"
	"strings"
)

// No selection is OFF. Merely storing a provider key never activates scoring.
func ragRerankClient(setting RAGSetting) (*ragDecisionClient, error) {
	provider := setting.RerankProvider
	if provider == "" || provider == "off" {
		return nil, nil
	}
	var key string
	endpoint := decisionEndpoint
	switch provider {
	case "gemini":
		key = strings.TrimSpace(setting.GeminiAPIKey)
	case "jev":
		key = strings.TrimSpace(setting.JevAPIKey)
		endpoint = typeSafeDecisionsURL
		if setting.JevUseOpenRouter {
			endpoint = openRouterDecisionsURL
		}
	default:
		return nil, fmt.Errorf("unknown reranking provider %q", provider)
	}
	if key == "" {
		return nil, fmt.Errorf("%s reranking key is not configured or unlocked", provider)
	}
	client := newRagDecisionClient(key)
	client.provider = provider
	client.useOpenRouter = setting.JevUseOpenRouter
	client.decisionEndpoint = endpoint
	return client, nil
}

func ragScoringSkipReason(result RAGSearchResult) string {
	text := strings.TrimSpace(result.Text)
	kind := strings.ToLower(result.ContentType)
	if kind == "image" || kind == "audio" || kind == "video" || strings.HasPrefix(strings.ToLower(text), "[image:") || strings.HasPrefix(strings.ToLower(text), "[audio:") || strings.HasPrefix(strings.ToLower(text), "[video:") {
		return "Media content unavailable for scoring; original position kept"
	}
	if strings.HasPrefix(strings.ToLower(text), "[pdf:") {
		if newline := strings.IndexByte(text, '\n'); newline >= 0 {
			text = strings.TrimSpace(text[newline+1:])
		} else {
			text = ""
		}
	}
	if text == "" {
		return "No indexed text available for scoring; original position kept"
	}
	return ""
}

func rerankRAGCandidates(query string, candidates []RAGSearchResult, setting RAGSetting) ([]RAGSearchResult, []string, error) {
	setting = normalizeRAGSetting(setting)
	cut := func(results []RAGSearchResult) []RAGSearchResult { return results[:min(len(results), setting.TopK)] }
	if setting.RerankProvider == "" || setting.RerankProvider == "off" || len(candidates) == 0 {
		return cut(candidates), nil, nil
	}
	limit := max(40, setting.TopK)
	if setting.SearchUntilMatch {
		limit = 1000
	}
	candidates = candidates[:min(len(candidates), limit)]
	original := append([]RAGSearchResult(nil), candidates...)
	// Every fallback restores retrieval order, but must retain why media could
	// not be scored, including media outside the batch where scoring failed.
	for i := range original {
		if reason := ragScoringSkipReason(original[i]); reason != "" {
			original[i].RerankSkippedReason = reason
			original[i].JevUnchecked = true
		}
	}
	client, err := ragRerankClient(setting)
	if err != nil {
		return cut(original), []string{err.Error() + "; returning original search results."}, nil
	}
	var warnings []string
	for offset := 0; offset < len(candidates); offset += max(40, setting.TopK) {
		batch := append([]RAGSearchResult(nil), original[offset:min(offset+max(40, setting.TopK), len(original))]...)
		var eligible []RAGSearchResult
		var positions []int
		for i := range batch {
			if batch[i].RerankSkippedReason == "" {
				positions = append(positions, i)
				eligible = append(eligible, batch[i])
			}
		}
		if len(positions) < len(batch) {
			warnings = append(warnings, fmt.Sprintf("%d candidate(s) could not be scored; their original search positions are preserved.", len(batch)-len(positions)))
			if setting.SearchUntilMatch {
				warnings = append(warnings, "Stopped search-until-found: unscored media is not evidence of low relevance.")
				return cut(original), warnings, nil
			}
		}
		if len(eligible) > 0 {
			ranked, err := client.Rerank(context.Background(), query, eligible)
			if err != nil {
				warnings = append(warnings, setting.RerankProvider+" reranking failed; returning original search results: "+err.Error())
				return cut(original), warnings, nil
			}
			for i, position := range positions {
				batch[position] = ranked[i]
			}
		}
		if !setting.SearchUntilMatch {
			return cut(batch), warnings, nil
		}
		var answers []RAGSearchResult
		for _, result := range batch {
			if result.RerankScore != nil && *result.RerankScore >= 2 {
				answers = append(answers, result)
			}
		}
		if len(answers) > 0 {
			return cut(answers), warnings, nil
		}
	}
	if len(candidates) >= 1000 {
		warnings = append(warnings, "Reached the 1000-candidate search limit without a relevance score of at least 2/3.")
	}
	return []RAGSearchResult{}, warnings, nil
}

func (a *App) VerifyRAGReranker(provider, apiKey string, useOpenRouter bool) error {
	client, err := ragRerankClient(RAGSetting{RerankProvider: provider, GeminiAPIKey: apiKey, JevAPIKey: apiKey, JevUseOpenRouter: useOpenRouter})
	if err != nil {
		return err
	}
	if client == nil {
		return fmt.Errorf("select Gemini or Jev to verify reranking")
	}
	_, err = client.Rerank(context.Background(), "How do I change my password?", []RAGSearchResult{{Text: "Open Settings, select Security and Change password, then save the new password."}})
	return err
}
