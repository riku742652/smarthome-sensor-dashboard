# Harness Doc Updater Memory

このファイルには、ドキュメント更新に関する学習内容を記録します。
効果的なドキュメント構造やパターンを蓄積します。

## Effective Documentation Structures

### AGENTS.md
- 短く、ナビゲーション用
- 詳細は他のドキュメントへのポインタ
- プロジェクト構造の概要

### ARCHITECTURE.md
- 高レベルのアーキテクチャ概要
- "なぜ"に焦点、"どのように"は詳細ドキュメントで
- 現在の状態を反映

### Design Docs
- コンテキストと問題
- 決定内容
- 検討した代替案
- 結果とトレードオフ

## Common Update Patterns

### 新機能追加後
1. ARCHITECTURE.md に新しい層/コンポーネントを追加
2. docs/references/ に技術リファレンスを追加（必要に応じて）
3. AGENTS.md のナビゲーションを更新（構造変更の場合）
4. 実行計画をcompletedに移動
5. retrospective.md を作成

### アーキテクチャ変更後
1. ARCHITECTURE.md を更新
2. 設計ドキュメントを作成/更新
3. 影響を受けるリファレンスを更新

### 技術的負債発見時
1. tech-debt-tracker.md に追加
2. 優先度と影響を明確に記述
3. 推奨アクションを提案

## Document Templates

### Retrospective Template
```markdown
# Retrospective: [Task Name]

**Date Completed**: [Date]
**Duration**: [Duration]

## Summary
[1-2 sentence summary]

## What Went Well
- [Point 1]
- [Point 2]

## What Was Challenging
- [Challenge 1]
  - **Impact**: [Impact]
  - **Resolution**: [Resolution]

## Learnings
### Technical Learnings
- [Learning 1]

### Process Learnings
- [Learning 1]

## Metrics
- Test Coverage: [%]
- Files Changed: [Count]

## Future Improvements
- [Improvement 1]
```

### Tech Debt Entry Template
```markdown
## [Date] - [Brief Description]

**Location**: `path/to/file:line`

**Issue**:
[Description]

**Impact**:
- Performance: High/Medium/Low
- Maintainability: High/Medium/Low
- Security: High/Medium/Low

**Recommended Action**:
[What should be done]

**Priority**: High/Medium/Low
**Status**: Open
```

## Documentation Best Practices

### 更新予定
ドキュメント作成のベストプラクティスをここに記録してください。

例：
- 具体的な例を含める
- コードスニペットを使用する
- 現在の状態を正確に反映する
- 古い情報を削除する
