---
type: Product Feature
title: AI providerとLocal CLI
description: OpenAI互換、Gemini、Vertex AI、Anthropic、Codex・Antigravity CLIをChat providerとして設定する機能。
tags: [ai, providers, cli, oauth]
timestamp: 2026-07-15T00:00:00+09:00
---

`Settings > AI features`でprovider、endpoint、model、credentialを設定します。API
providerはOpenAI compatible、Google Gemini、Vertex
AI、Anthropicに対応します。providerごとのprofileは保持されるため、切り替えて使えます。

ChatではOpenAI GPT-6 AstraとGPT-6.1ファミリーを選択できます。公式OpenAI
API、およびGemini 3系/Vertex AIではモデル選択欄の横からReasoning
effortを指定します。`default`はprovider既定、OpenAIの`none`は推論なしです。完全に推論を無効化できないGeminiでは`none / minimum`を選ぶと、そのモデルが対応する最低レベルを使用します。旧Thinking
on/off設定は使用しません。

# 認証

- OpenAI compatible: endpoint、model、API key。互換サーバーも指定可能。
- Gemini / Anthropic: endpoint、model、API key。
- Vertex AI: Google OAuth desktop client、Google Cloud
  project、locationを設定して接続。

# Local CLI

`Settings > CLI providers`でCLIの種類（CodexまたはAntigravity）と実行pathを指定し、Verifyします。検証に成功したCLIだけがconfigured
providerとして利用できます。Codexではチャット入力欄の下からモデルとreasoning
effort（minimal / low / medium / high /
xhigh）を選択できます。DatabaseメニューのVault設定を有効にすると、WorkspaceファイルツールもCodexへ公開されます。CodexはJSON-RPC経由の`app-server`サブプロセスとして動作するため、Verifyでは`<path> --version`に加えて`app-server`サブコマンドの存在も確認されます。Windowsでは実行ファイルを直接指定しなくても、npmで導入した`@openai/codex`のCLIスクリプトをNode経由で解決できます。

どのproviderも外部サービスまたはローカルprocessの利用条件、料金、data
handlingが適用されます。モデル名はprovider側で利用可能なものを指定してください。

# Vertex AIの認証フロー

Vertex AIはPKCE付きのGoogle
OAuth認可コードフローで接続します。ローカルにloopback
HTTPサーバーを一時的に起動し、ブラウザで`accounts.google.com`へ遷移してcloud-platform
scopeを許可すると、refresh tokenがローカルに保存され、以後access
tokenは自動更新されます。ブラウザからのredirectを受けるため、loopbackポートをブロックする社内proxyやfirewallの環境では認証が失敗することがあります。

# 確認点

- CLIが認識されない:
  実行pathが本体を指しているか（ショートカットではないか）、Verifyが成功しているかを確認する。
- Vertex AIで認証が進まない:
  ブラウザのredirectがloopbackへ戻れているか、ネットワーク制限がないか確認する。
- CLI mode中にAIがファイル操作を提案しない: CLI modeではAPI provider用file
  toolsが使えないため、CLI自体の権限設定に従っている。

# 関連機能

[AI Chat](/features/ai-chat.md)、[Discord bot](/features/discord-bot.md)（同じprovider設定を共有）、[MCP](/features/mcp-apps.md)（同様のPKCE/loopback方式のOAuth）。

# モデルの検証とproviderの選択

OpenRouterとOpenCode GoはAPI providerの選択欄にプリセットがあります。
API keyと接続先を設定して **Verify & fetch models** を押し、取得した一覧から
利用するモデルを選択します。OpenAIの一覧では音声・画像・embeddingなどの専用モデルと
廃止済みモデルを除きます。OpenRouter／OpenCode Goは公開カタログの取得に加えて
キーの認証も確認します。接続先やキーを変更した場合は再検証が必要です。
Local LLMでは手動でのモデルID指定も利用できます。

Chatのモデル欄には設定画面で選択中のprovider profileのモデルだけが表示されます。
別providerへの切り替えは設定画面で行います。WorkflowやDashboardでは検証済みの
別profileも明示的に選べます。チェックを外したモデルは自動で再有効化しません。
既存のAPI profileも、この更新後は一度検証してください。
