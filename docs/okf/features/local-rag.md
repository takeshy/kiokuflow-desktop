---
type: Product Feature
title: Local RAG
description: 指定したローカル文書をchunk化・embeddingして索引を作り、Chatから意味検索する機能。
tags: [rag, retrieval, embeddings, search]
timestamp: 2026-07-20T00:00:00+09:00
---

Local RAGは、ローカルファイル群を意味検索できるようにするretrieval機能です。`Settings > Local retrieval`でRAG settingを作り、対象path、embedding provider、modelなどを設定してSyncします。索引とvectorはローカルに保存されます。

# 操作

* Sync: 対象ファイルを読み、text chunkとembeddingを更新する。
* Status: 文書数、chunk数、更新状態を確認する。
* Search: queryに近いchunkをscore付きで取得する。
* Indexed files: 索引済みfileとchunk数を確認し、元fileを開く。
* Filter: file pathとchunk本文をtermで絞り込む。同じ行のtermはOR、複数行はAND、引用符内はphraseとして扱う。
* Select / Chat / Copy: 必要なchunkだけを選び、Chatへ渡すかclipboardへコピーする。
* Adjacent chunks: textの検索結果へ前後3chunkずつ追加して文脈を広げる。
* AI suggestions / refine: 設定済みmodelでfilter語を展開したり、選択する抜粋を整えたりする。
* Delete index: 作成済み索引を削除する。
* Startup sync: `rag-sync`ノードを置いたWorkflowにAutomationの`App started`イベントを割り当てると、Workspaceの準備後に差分同期する。

embedding生成には設定したproviderのcredentialが必要で、GeminiやVertex AIなど外部embedding APIを使う場合、対象テキストがそのサービスへ送信されます。RAGは原文そのものを変更しません。少数ファイルを確実に渡す用途は `@file`、curatedな定義や手順には[OKF](/features/okf-knowledge.md)が適しています。

Gemini、OpenAI、OpenAI互換APIの接続をAI設定に登録すると、Chat用モデルのチェックに関係なくRAGのembedding providerとして選べます。Vertex AIもChat用モデルの選択に依存しません。**Embedding model** は、選択したAPI providerの候補を表示するプルダウンです。更新ボタンで一覧を再取得でき、一覧にないIDは **Other model…** から指定できます。保存済みのモデルIDは一覧にない場合も保持します。AI設定のチェックリストにはChat用モデルだけを表示し、embedding modelはすべてRAG側の候補として扱います。OpenAI互換APIはembedding対応の接続先を使ってください。保存したAPIキーがロック中の場合は、`Settings > Encryption`からUnlockしてからSyncや検索を実行します。

# 既定値と処理の単位

既定はchunk sizeが500文字、overlapが100文字、検索時のtop-kは5件、score threshold 0.3、embedding providerは既定でGeminiです。embeddingは32chunkずつまとめて要求され、backendの1回の処理単位は変更file最大50件です。RAG Search画面の **Sync Index** は持ち越しがなくなるまでこの処理を自動反復します。ファイル内容はhashで比較され、変更がなければ再embeddingをskipします。embedding providerやmodel、chunk設定を変更すると全体が再構築されます。

# 索引対象の範囲

索引対象はWorkspace配下のMarkdown、plain text、PDFです（`.git`、`.llm-hub`、`node_modules`とsymlinkは対象外）。PDFは通常のembedding modelでは抽出可能なtextを索引します。GeminiまたはVertex AIで `gemini-embedding-2` 系modelを使う場合はPDFをpage単位のmultimodal embeddingとして扱い、PNG/JPEG画像、MP3/WAV音声、MP4/MPEG動画も索引できます。binary形式の結果は展開すると対応するmedia previewを表示します。

検索時はTop K、score threshold、拡張子を一時的に指定できます。text結果のEdit画面で行う前後chunkの追加やAI Refine、Saveは、現在の検索結果としてChatへ渡す抜粋を編集する操作です。元fileと保存済みRAG indexは書き換えません。

# 関連機能

[Chatのコンテキストとファイル操作](/features/chat-context-file-tools.md)、[OKF知識ソース](/features/okf-knowledge.md)、[Discord bot](/features/discord-bot.md)（`!rag on`/`!rag off`）。

# Hybrid検索とリランキング

Hybrid検索は標準ONで、BM25によるキーワード検索とベクトル検索をRRFで統合します。
ベクトル検索の候補外にある `E02` などの識別子や日本語も既存の索引本文から検索します。
Hybrid searchをOFFにするとベクトル検索を使います。検索設定の変更だけでは再embeddingは不要です。

リランキングはRAGごとに **OFF / Jev / Gemini Decisions API** の1つを選びます。
未選択・旧設定はOFFで、キーの登録だけではONになりません。RAG Search画面ではその検索だけ
一時的に変更できます。GeminiはAI設定のnative Gemini接続の解除済みキーを使い、
`gemini-decision-1` で採点します。JevはJev欄の直接キー、または明示的に選んだOpenRouterキーを使います。
選択したサービスだけにクエリと候補の索引本文を送信し、追加のAPI利用料がかかります。

直接Jevのキーは[TypeSafe公式コンソール](https://console.typesafe.ai/)で発行します。
送信先は `https://api.typesafe.ai/v1/systemone`（`jev-latest`）、OpenRouterは
`https://openrouter.ai/api/alpha/decisions`（`~typesafe/jev-latest`）、Geminiは
`https://generativelanguage.googleapis.com/v1beta/decisions` です。プロバイダー間でキーを自動転用しません。
**Verify selected provider** で選択中の接続を確認できます。

点数は0〜3で、検索スコアとは別に表示します。Top K（1〜20、初期値5）は最終結果の件数です。
通常は最大40候補を採点して並べ替えます。**Search until a match** は40候補ずつ最大1,000候補を調べ、
2/3点以上が見つかった最初のバッチの一致結果を返します。embeddingと検索は1回だけ実行します。
各バッチの採点は再試行込みで20秒までです。上限まで一致がなければ警告を表示します。

採点失敗や選択したキーの未設定・未解除時は、警告付きで元の検索結果を返します。
採点するのは索引にある本文（PDFの抽出済みテキストを含む）です。画像・音声・動画や本文のないPDFは
未判定として元の順位を保護し、binary本体を採点APIへ送信しません。
継続検索では未判定を低得点とみなさず、警告付きで停止して元の検索結果を返します。
