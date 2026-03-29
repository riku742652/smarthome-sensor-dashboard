# Harness Engineering Subagents Guide

このプロジェクトは、**コンテキストウィンドウを効率的に使用する**ために、ハーネスエンジニアリングワークフローに特化した4つのサブエージェントを使用します。

## なぜサブエージェントを使うのか

ハーネスエンジニアリングの3段階ワークフロー（リサーチ→計画→実装）では、各フェーズで大量の情報を扱います。すべてをメイン会話で行うと、コンテキストウィンドウがすぐに埋まってしまいます。

**サブエージェントの利点**:
- 各フェーズの詳細な作業を隔離されたコンテキストで実行
- メイン会話には要約のみが返される
- コンテキストウィンドウを節約し、長時間作業が可能に
- 各サブエージェントは専門化されており、効率的

## 4つのサブエージェント

### 1. harness-researcher（リサーチ専門）

**役割**: 新しいタスクを開始する前に、徹底的なリサーチを実施

**使用タイミング**:
- 新機能を追加する前
- バグの根本原因を調査する前
- リファクタリングを計画する前

**モデル**: Haiku（高速、コスト効率的）

**できること**:
- コードベースの深い読み込み
- 既存パターンの特定
- 関連ファイルとアーキテクチャの分析
- リサーチドキュメントの作成（`docs/exec-plans/active/[task-name]-research.md`）

**できないこと**:
- コード変更（読み取り専用）
- 計画の作成
- 実装

**使用例**:
```
Use harness-researcher to research adding a new CO2 sensor type to the dashboard
```

**出力**:
- リサーチドキュメントの場所
- 主要な発見事項の要約（3-5個）
- 重要なファイル/パターンのリスト
- 次のステップ（計画作成）の提案

---

### 2. harness-planner（計画作成専門）

**役割**: リサーチ結果を元に、レビュー可能な詳細実装計画を作成

**使用タイミング**:
- リサーチが完了した後
- 人間がレビューする前に計画を作成
- フィードバックを受けて計画を修正

**モデル**: Sonnet（高品質な計画生成）

**できること**:
- 詳細な実装計画の作成（`docs/exec-plans/active/[task-name]-plan.md`）
- 小さなステップへの分解
- テスト戦略の立案
- リスクと制約の特定
- 人間のフィードバックに基づく計画の修正

**できないこと**:
- コード実装
- 大規模なコード変更

**使用例**:
```
Use harness-planner to create an implementation plan based on the research document
```

**計画レビューサイクル**:
1. プランナーが計画を作成
2. 人間が計画ファイルにインラインコメントを追加:
   - `<!-- FEEDBACK: ... -->`
   - `<!-- QUESTION: ... -->`
   - `<!-- APPROVED: ... -->`
3. プランナーがフィードバックを元に計画を更新
4. 全てが承認されるまで繰り返し

**出力**:
- 計画ドキュメントの場所
- 実装ステップ数
- 主要なアーキテクチャ変更
- 特定されたリスク
- 次のアクション（人間レビュー待ち）

---

### 3. harness-executor（実装専門）

**役割**: 承認された計画に従って、忠実にコードを実装

**使用タイミング**:
- 計画が完全に承認された後
- すべてのFEEDBACKとQUESTIONが解決された後

**モデル**: Sonnet（高品質なコード生成）

**できること**:
- 計画の各ステップを順番に実装
- 型チェック、リント、テストの実行
- エラーの自動修正
- 計画ドキュメント内での進捗マーク（✅）
- 最終検証（tests, lint, type-check, build）

**できないこと**:
- 計画にない機能の追加
- 計画の範囲外のリファクタリング
- アーキテクチャ決定（計画で指定されていない場合）

**使用例**:
```
Use harness-executor to implement the approved plan at docs/exec-plans/active/realtime-sensors-plan.md
```

**実装中の動作**:
- 各ステップ完了後に検証を実行
- 問題を検出したら自動修正
- 計画で進捗をマーク
- ブロッキング問題があれば停止して報告

**出力**:
- 完了したステップ
- 検証結果（tests, lint, type-check）
- 作成/変更されたファイル
- 追加されたテストカバレッジ
- 次のステップ（PR作成、ドキュメント更新）

---

### 4. harness-doc-updater（ドキュメント更新専門）

**役割**: 実装後にドキュメントを同期し、計画を完了済みに移動

**使用タイミング**:
- 実装が完了した後
- アーキテクチャが変更された時
- 新しいパターンが確立された時

**モデル**: Haiku（軽量なドキュメント更新）

**できること**:
- `AGENTS.md`、`ARCHITECTURE.md`などの更新
- 実行計画を`completed/`に移動
- レトロスペクティブドキュメントの作成
- 技術的負債トラッカーの更新
- 新しいリファレンスドキュメントの作成

**できないこと**:
- コード実装
- 計画の作成

**使用例**:
```
Use harness-doc-updater to update documentation after implementing realtime-sensors feature
```

**出力**:
- 更新されたドキュメントのリスト
- 移動された計画
- 追加/解決された技術的負債
- 次のアクション

## 完全なワークフロー例

実際の開発フローは以下のようになります：

```
1. 新しいタスクを開始
   Human: I want to add real-time WebSocket updates to the sensor dashboard

2. リサーチフェーズ
   Human: Use harness-researcher to research this feature

   [harness-researcher が動作]
   → docs/exec-plans/active/realtime-sensors-research.md を作成
   → 既存コード、パターン、制約を特定
   → 要約を返す

3. 計画フェーズ
   Human: Use harness-planner to create an implementation plan

   [harness-planner が動作]
   → docs/exec-plans/active/realtime-sensors-plan.md を作成
   → 詳細なステップ、テスト戦略、リスクを記述

   Human: [計画ファイルにインラインコメントを追加]
   <!-- FEEDBACK: Use Socket.IO instead of raw WebSocket -->
   <!-- QUESTION: How should we handle reconnection? -->

   Human: Update the plan based on my feedback

   [harness-planner が計画を更新]
   → フィードバックに対応
   → QUESTIONに答える

   [承認されるまで繰り返し]

4. 実装フェーズ
   Human: Use harness-executor to implement the approved plan

   [harness-executor が動作]
   → Step 1: Types定義 ✅
   → Step 2: WebSocketサービス ✅
   → Step 3: Reactフック ✅
   → ... 全ステップ完了
   → テスト、リント、型チェック: 全て通過 ✅

5. ドキュメント更新フェーズ
   Human: Use harness-doc-updater to update documentation

   [harness-doc-updater が動作]
   → ARCHITECTURE.md にWebSocket層を追加
   → docs/references/websocket-patterns.md を作成
   → 計画をcompletedに移動
   → retrospective.md を作成

6. PR作成
   Human: Create a pull request

   [メイン会話で実行]
   → ブランチ作成
   → コミット
   → PR作成
```

## 使用上のヒント

### コンテキスト節約のために
- 各フェーズで適切なサブエージェントを使う
- メイン会話では要約のみを受け取る
- 詳細はドキュメントに永続化

### 効率的な作業のために
- リサーチ → 計画 → 実装の順番を守る
- 計画を必ずレビュー・承認してから実装
- 各サブエージェントに明確な指示を与える

### 品質を保つために
- 計画段階で十分に詳細を詰める
- 実装中は計画から逸脱しない
- 最終検証を必ず通す

## サブエージェントのメモリ

各サブエージェントは `.claude/agent-memory/[agent-name]/` にプロジェクトスコープのメモリを持ちます：

- **harness-researcher**: コードベースパターン、重要ファイル位置
- **harness-planner**: 成功した計画パターン、一般的なフィードバックテーマ
- **harness-executor**: 実装パターン、よくある落とし穴
- **harness-doc-updater**: 効果的なドキュメント構造、テンプレート

これにより、セッションを跨いで学習が蓄積され、時間とともに効率が向上します。

## トラブルシューティング

### サブエージェントが見つからない場合
```bash
# セッションを再起動
# サブエージェントは起動時に読み込まれます
```

### 間違ったサブエージェントを呼んだ場合
メイン会話で適切なサブエージェントを指定し直してください。サブエージェントは独立しているため、やり直しても問題ありません。

### サブエージェントが停止した場合
- エラーメッセージを確認
- 必要に応じて人間の判断を提供
- サブエージェントは再開可能です

## まとめ

4つの専門サブエージェントにより：
- ✅ コンテキストウィンドウを効率的に使用
- ✅ 各フェーズの作業を明確に分離
- ✅ 高品質な成果物を生成
- ✅ 人間のレビューポイントを明確化
- ✅ 長時間の開発セッションが可能

ハーネスエンジニアリングワークフローとサブエージェントを組み合わせることで、効率的かつ高品質な開発が実現できます。
