# Harness Executor Memory

このファイルには、実装に関する学習内容を記録します。
プロジェクト固有のパターンや落とし穴を蓄積し、実装品質を向上させます。

## Implementation Patterns

### Domain Structure
このプロジェクトのドメイン構造：
```
src/domains/[domain-name]/
├── types/           - 型定義
├── repository/      - データアクセス層
├── services/        - ビジネスロジック
├── components/      - UIコンポーネント（フロントエンド）
└── __tests__/       - テスト
```

### Type Safety Pattern
```typescript
// すべての境界でバリデーション
import { z } from 'zod';

const schema = z.object({
  // ...schema definition
});

type DataType = z.infer<typeof schema>;

function processData(raw: unknown): DataType {
  return schema.parse(raw); // 実行時バリデーション
}
```

### Error Handling Pattern
```typescript
// Result型を使用したエラーハンドリング
import { Result, ok, err } from 'neverthrow';

async function operation(): Promise<Result<Data, Error>> {
  try {
    const result = await externalCall();
    return ok(result);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
```

## Common Pitfalls

### 更新予定
実装中に遭遇した落とし穴とその解決策をここに記録してください。

例：
- 型定義の漏れ
- バリデーションの欠如
- エラーハンドリングの不足
- テストのカバレッジ不足

## Helpful Code Snippets

### 更新予定
頻繁に使用するコードスニペットをここに記録してください。

例：
- API呼び出しのボイラープレート
- テストのセットアップコード
- 一般的な型定義パターン

## Quality Checklist

実装完了前に確認：
- [ ] 型チェック通過
- [ ] リント通過
- [ ] テスト通過（カバレッジ>90%）
- [ ] ビルド成功
- [ ] バリデーション追加（すべての境界）
- [ ] エラーハンドリング追加
- [ ] 計画の全ステップ完了
