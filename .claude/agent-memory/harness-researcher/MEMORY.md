# Harness Researcher Memory

このファイルには、プロジェクトに関する学習内容を記録します。
セッションを跨いで知識を蓄積し、効率的なリサーチを可能にします。

## Important File Locations

### Project Structure
- `AGENTS.md` - プロジェクトナビゲーション
- `ARCHITECTURE.md` - システムアーキテクチャ
- `HARNESS_WORKFLOW.md` - ワークフロー詳細
- `docs/SUBAGENTS.md` - サブエージェント使用ガイド

### Source Code
- `src/` - アプリケーションソース
- `tests/` - テストコード

### Documentation
- `docs/design-docs/` - 設計決定
- `docs/exec-plans/active/` - 進行中の計画
- `docs/exec-plans/completed/` - 完了した計画
- `docs/product-specs/` - 製品仕様
- `docs/references/` - 技術リファレンス

## Common Patterns

### Domain-Driven Structure
このプロジェクトはドメイン駆動設計を採用しています：
- `src/domains/[domain-name]/` - 各ドメイン
- Repository層、Service層、Component層の分離

### Type Safety and Validation
- すべての境界でZodを使用したバリデーション
- 型定義は各ドメインで管理
- `any`型は避ける

### Testing Strategy
- 単体テスト: `__tests__/` ディレクトリ
- 統合テスト: `tests/integration/`
- >90%のカバレッジ目標

## Key Architectural Insights

### 更新予定
リサーチ中に発見した重要なアーキテクチャ洞察をここに記録してください。

## Frequently Referenced Code

### 更新予定
頻繁に参照されるコードの場所をここに記録してください。
