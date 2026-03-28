# Quality Score & Standards

このドキュメントは、コードベースの品質基準と評価方法を定義します。

## 品質の柱

### 1. コード品質

#### 静的解析

- **TypeScript strict mode**: 有効
- **ESLint**: ゼロエラー、ゼロワーニング
- **Prettier**: すべてのファイルをフォーマット済み

#### メトリクス

- **Cyclomatic Complexity**: 関数あたり10以下
- **ファイルサイズ**: 300行以内
- **関数サイズ**: 50行以内
- **インポート深度**: 5階層まで

### 2. テストカバレッジ

#### 目標

- **Line Coverage**: 80%以上
- **Branch Coverage**: 75%以上
- **Function Coverage**: 85%以上

#### テストの種類

- **Unit Tests**: すべてのビジネスロジック
- **Integration Tests**: API呼び出し、データフロー
- **E2E Tests**: クリティカルパス（Phase 2）

### 3. パフォーマンス

#### バンドルサイズ

- 初期バンドル: < 500KB
- コード分割: ルートごと
- Tree shaking: 有効

#### ランタイムパフォーマンス

- **Time to Interactive**: < 3秒
- **First Contentful Paint**: < 1.5秒
- **Cumulative Layout Shift**: < 0.1

#### API パフォーマンス

- レスポンス時間: < 2秒
- 成功率: > 95%
- リトライ: 最大3回

### 4. 型安全性

#### 要件

- `any` 型の使用禁止（例外は文書化）
- すべての関数に明示的な戻り値の型
- すべてのPropsに型定義
- 外部データは境界でZodバリデーション

#### スコア

```typescript
// ✅ Perfect: 10/10
function calculateAverage(values: number[]): number {
  return values.reduce((sum, val) => sum + val, 0) / values.length
}

// ⚠️ Acceptable: 7/10
function processData(data: any): SensorData {
  // anyの使用は文書化が必要
}

// ❌ Unacceptable: 0/10
function doSomething(data: any): any {
  // 型情報が完全に失われている
}
```

### 5. 保守性

#### ドキュメント

- すべての public API に JSDoc コメント
- 複雑なロジックにインラインコメント
- README に開発環境のセットアップ手順

#### 命名規則

- 意味のある変数名
- 動詞 + 名詞: `fetchSensorData`, `calculateAverage`
- Boolean: `is`, `has`, `should` プレフィックス

#### コードの一貫性

- 同じパターンを繰り返す
- 共通ロジックは shared/utils に抽出
- DRY原則（ただし過度な抽象化は避ける）

## 品質ゲート

### CI/CD パイプライン

すべてのPRは以下をパスする必要があります：

1. **Lint**: `npm run lint` - ゼロエラー
2. **Type Check**: `npm run type-check` - ゼロエラー
3. **Tests**: `npm run test` - すべてパス、カバレッジ80%以上
4. **Build**: `npm run build` - 成功

### マージ前チェックリスト

- [ ] すべてのテストが通る
- [ ] リントエラーなし
- [ ] 型エラーなし
- [ ] 新規コードにテストを追加
- [ ] ドキュメントを更新（必要に応じて）
- [ ] 技術的負債を tech-debt-tracker.md に記録

## レイヤー別品質基準

### Types Layer

- **完全性**: すべてのドメインオブジェクトに型定義
- **精密性**: `string` より `'success' | 'error'` を優先
- **ドキュメント**: 各型にコメント

### Repository Layer

- **エラーハンドリング**: すべてのAPI呼び出しで try-catch
- **バリデーション**: Zodでレスポンスを検証
- **リトライ**: 一時的な失敗に対応
- **テスト**: モック使用、カバレッジ90%以上

### Service Layer

- **ビジネスロジック**: 純粋関数を優先
- **依存性**: repositoryのみに依存
- **テスト**: 100%カバレッジ目標

### UI Layer

- **アクセシビリティ**: WCAG AA準拠
- **レスポンシブ**: モバイル、タブレット、デスクトップ
- **テスト**: 主要なユーザーフローをカバー

## 品質スコア算出

### 自動評価

```bash
npm run quality-check
```

以下の項目をチェック：

1. **Lint Score**: エラー数に基づく
2. **Type Score**: any の使用率
3. **Test Score**: カバレッジ割合
4. **Performance Score**: バンドルサイズ
5. **Documentation Score**: JSDoc カバレッジ

### 総合スコア

```
Quality Score = (Lint + Type + Test + Perf + Docs) / 5

A: 90-100
B: 80-89
C: 70-79
D: 60-69
F: <60
```

目標: **常にA評価（90以上）を維持**

## 定期的な品質監査

### 週次

- [ ] Quality Scoreを確認
- [ ] 新しいリントルールの検討
- [ ] テストカバレッジの改善箇所を特定

### 月次

- [ ] 依存関係の更新
- [ ] パフォーマンステスト実施
- [ ] ドキュメントの鮮度確認
- [ ] 技術的負債の返済

## カスタムリンタールール

### 実装予定

1. **境界バリデーション**: 外部データに Zod が使われているか
2. **依存方向**: レイヤー間の依存が正しいか
3. **ファイルサイズ**: 300行を超えていないか
4. **命名規則**: コンベンションに従っているか
5. **any型**: 使用されている場合、コメントがあるか

詳細: `tools/linter/` （Phase 2で実装）

## エージェントへの期待

エージェントが生成するコードは以下を満たすべき：

- すべての品質ゲートをパス
- 既存パターンとの一貫性
- 適切なテストカバレッジ
- 境界でのデータ検証

品質基準を満たさない場合、エージェントは自動的に修正を試みるべきです。

## 変更履歴

- 2026-03-28: 初期作成
