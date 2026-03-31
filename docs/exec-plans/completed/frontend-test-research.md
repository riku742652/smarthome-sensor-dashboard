# Frontend Test Implementation - Research

**日付**: 2026-03-28
**ステータス**: Research Complete
**目的**: フロントエンドのテスト実装に必要な情報を収集

## 現状分析

### テストインフラ

#### ✅ 既存のセットアップ

- **Vitest**: インストール済み（v2.1.8）
- **@vitest/ui**: インストール済み（テストUIツール）
- **vitest.config.ts**: 設定済み
  - jsdom環境
  - v8カバレッジプロバイダ
  - setup.tsを参照（未作成）

#### ❌ 不足しているもの

1. **React Testing Library関連**
   ```json
   "@testing-library/react": "^16.0.1"
   "@testing-library/jest-dom": "^6.6.3"
   "@testing-library/user-event": "^14.5.2"
   ```

2. **テストセットアップファイル**
   - `src/test/setup.ts` - 存在しない（vitest.config.tsで参照）

3. **テストファイル**
   - 現在、テストファイルが1つも存在しない

### コードベース分析

#### ファイル数（テスト対象）

```
src/
├── domains/
│   ├── sensor/
│   │   ├── types/         (2 files) - 低優先度（型定義）
│   │   ├── config/        (1 file)  - 低優先度（定数）
│   │   ├── repository/    (3 files) - 高優先度
│   │   ├── service/       (1 file)  - 高優先度
│   │   └── ui/            (4 files) - 中優先度
│   └── dashboard/
│       ├── types/         (2 files) - 低優先度
│       ├── config/        (1 file)  - 低優先度
│       ├── service/       (1 file)  - 高優先度
│       └── ui/            (4 files) - 中優先度
├── shared/
│   ├── types/            (2 files) - 低優先度
│   ├── utils/            (3 files) - 高優先度
│   ├── hooks/            (4 files) - 高優先度
│   └── components/       (6 files) - 中優先度
└── app/                  (2 files) - 低優先度
```

**合計**: 約36ファイル（型定義・設定除く）

#### 優先度別テスト対象

##### 高優先度（ビジネスロジック、テストカバレッジ目標90%）

1. **Service層** (2 files)
   - `src/domains/sensor/service/SensorService.ts`
   - `src/domains/dashboard/service/ChartDataService.ts`

2. **Repository層** (3 files)
   - `src/domains/sensor/repository/SensorRepository.ts`
   - `src/domains/sensor/repository/MockSensorRepository.ts`
   - `src/domains/sensor/repository/schemas.ts`

3. **Utils** (3 files)
   - `src/shared/utils/formatters.ts`
   - `src/shared/utils/numbers.ts`

4. **Hooks** (4 files)
   - `src/shared/hooks/useFetch.ts`
   - `src/shared/hooks/useInterval.ts`
   - `src/shared/hooks/useLocalStorage.ts`

**高優先度合計**: 12ファイル

##### 中優先度（UI、テストカバレッジ目標75%）

1. **UI Components** (14 files)
   - Sensor domain: 2 files (MetricCard, SensorDashboard)
   - Dashboard domain: 3 files (SensorChart, TimeRangeSelector, DashboardPage)
   - Shared components: 5 files (Card, Button, Loading, ErrorMessage, EmptyState)

**中優先度合計**: 14ファイル

##### 低優先度（型定義・設定・エントリーポイント）

- Types: 型定義のみ（テスト不要）
- Config: 定数のみ（テスト不要）
- App: エントリーポイント（E2Eでカバー）

## 技術選定

### テストフレームワーク

**Vitest + React Testing Library**

理由:
- Viteとの統合が優れている
- 高速（ESM native）
- Jest互換API
- React Testing Libraryがデファクトスタンダード

### テスト種類

#### 1. Unit Tests

**対象**: Service, Repository, Utils, Hooks

**ツール**: Vitest

**アプローチ**:
- モックを使用して依存関係を分離
- 各関数の境界条件をテスト
- エラーハンドリングをテスト

**例**:
```typescript
describe('SensorService', () => {
  it('should fetch and cache sensor data', async () => {
    // テストコード
  })

  it('should return cached data within expiry time', async () => {
    // テストコード
  })
})
```

#### 2. Component Tests

**対象**: UI Components

**ツール**: Vitest + React Testing Library

**アプローチ**:
- ユーザーの視点でテスト（実装詳細をテストしない）
- アクセシビリティを考慮
- インタラクションをテスト

**例**:
```typescript
describe('MetricCard', () => {
  it('renders label and value correctly', () => {
    render(<MetricCard label="温度" value={25.5} unit="°C" color="#ff0000" />)
    expect(screen.getByText('温度')).toBeInTheDocument()
    expect(screen.getByText('25.5')).toBeInTheDocument()
  })
})
```

#### 3. Hook Tests

**対象**: Custom Hooks

**ツール**: Vitest + @testing-library/react-hooks (またはrenderHook from RTL)

**アプローチ**:
- renderHookを使用
- 状態変化をテスト
- 副作用をテスト

**例**:
```typescript
describe('useFetch', () => {
  it('should handle loading state', async () => {
    const { result } = renderHook(() => useFetch(async () => 'data'))
    expect(result.current.status).toBe('loading')
  })
})
```

## カバレッジ目標

### QUALITY_SCORE.mdの要件

- **Line Coverage**: 80%以上
- **Branch Coverage**: 75%以上
- **Function Coverage**: 85%以上

### レイヤー別目標

| レイヤー | Line Coverage | Branch Coverage | Function Coverage |
|---------|---------------|-----------------|-------------------|
| Service | 90%+ | 85%+ | 95%+ |
| Repository | 90%+ | 85%+ | 95%+ |
| Utils | 95%+ | 90%+ | 100% |
| Hooks | 85%+ | 80%+ | 90%+ |
| UI Components | 70%+ | 65%+ | 75%+ |

**理由**:
- ビジネスロジック（Service, Repository, Utils）は高カバレッジ
- UIは主要フローのみカバー（細かいスタイリングは除外）

## テストパターン

### 1. Service層のテスト

**課題**:
- `SensorService`はリポジトリに依存
- キャッシング機能がある

**アプローチ**:
- リポジトリをモック
- 時間依存のテスト（キャッシュ有効期限）にはvi.useFakeTimersを使用

### 2. Repository層のテスト

**課題**:
- 外部API（Switchbot API）への依存
- 環境変数への依存

**アプローチ**:
- fetchをモック（vi.mock）
- 環境変数をテストごとにセット
- Zodスキーマバリデーションのテスト

### 3. Hooks層のテスト

**課題**:
- Reactのライフサイクルに依存
- 非同期処理

**アプローチ**:
- `renderHook` from @testing-library/react
- `waitFor`で非同期処理を待つ
- act()でstate更新を囲む

### 4. Component層のテスト

**課題**:
- 外部コンポーネント（Recharts）への依存
- Propsの組み合わせが多い

**アプローチ**:
- Rechartsコンポーネントはモック（レンダリングのみ確認）
- 主要なPropsの組み合わせをテスト
- ユーザーインタラクション（クリック、入力）をテスト

## モック戦略

### 1. 外部ライブラリ

```typescript
// Recharts のモック
vi.mock('recharts', () => ({
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  // ...
}))
```

### 2. 環境変数

```typescript
beforeEach(() => {
  import.meta.env.VITE_API_BASE_URL = 'http://localhost:3000'
  import.meta.env.VITE_USE_MOCK_DATA = 'false'
})
```

### 3. fetch API

```typescript
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: async () => ({ data: [], count: 0 }),
  })
) as any
```

## ファイル構成

### テストファイルの配置

**方針**: ソースファイルと同じディレクトリに配置（コロケーション）

```
src/
├── domains/
│   └── sensor/
│       └── service/
│           ├── SensorService.ts
│           ├── SensorService.test.ts  ← 追加
│           └── index.ts
```

**理由**:
- テストとソースの関連が明確
- ファイル移動時にテストも一緒に移動
- インポートパスが短い

### テスト共通ユーティリティ

```
src/
└── test/
    ├── setup.ts              ← Vitest setup
    ├── utils/
    │   ├── renderWithProviders.tsx  ← Context付きrender
    │   ├── mockData.ts              ← テストデータ
    │   └── testHelpers.ts           ← 共通ヘルパー
    └── mocks/
        ├── handlers.ts              ← MSW handlers（将来）
        └── server.ts                ← MSW server（将来）
```

## 依存関係

### 追加が必要なパッケージ

```json
{
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/user-event": "^14.5.2",
    "@vitest/coverage-v8": "^2.1.8"
  }
}
```

### 既存パッケージ（利用可能）

- vitest: v2.1.8
- @vitest/ui: v2.1.8
- @vitejs/plugin-react: v4.3.4

## 既知の課題

### 1. Recharts のテスト

**問題**: RechartsはSVGをレンダリングするため、jsDOMで正確にテストできない

**対策**:
- Rechartsコンポーネント全体をモック
- データが正しく渡されているかのみ確認
- ビジュアルテストは手動または別ツール（Storybook + Chromatic）

### 2. 時間依存のテスト

**問題**: キャッシュ、インターバルなど時間に依存する機能

**対策**:
- `vi.useFakeTimers()` を使用
- `vi.advanceTimersByTime()` で時間を進める

### 3. 環境変数

**問題**: Viteの環境変数（import.meta.env）はビルド時に置換される

**対策**:
- vitest.config.tsで環境変数を設定
- テスト内で`import.meta.env`をモック

## 実装の段階的アプローチ

### Phase 1: 基盤構築

1. パッケージインストール
2. setup.ts 作成
3. テスト共通ユーティリティ作成

### Phase 2: 高優先度テスト

1. Utils のテスト（最も簡単）
2. Service のテスト
3. Repository のテスト
4. Hooks のテスト

### Phase 3: 中優先度テスト

1. Shared components のテスト
2. Domain components のテスト

### Phase 4: カバレッジ改善

1. カバレッジレポート確認
2. 不足箇所の特定
3. 追加テスト作成

## リスク

### 高リスク

- **時間**: 36ファイルのテスト作成は時間がかかる
  - 緩和策: 優先度を付けて段階的に実装

- **Recharts**: モックが複雑になる可能性
  - 緩和策: 最小限のモックで済むようにテスト設計

### 中リスク

- **非同期テスト**: タイミング問題で不安定になる可能性
  - 緩和策: waitForを適切に使用、タイムアウトを長めに設定

### 低リスク

- **環境変数**: テスト環境でのモックが難しい
  - 緩和策: vitest.config.tsで明示的に設定

## 参照

### 公式ドキュメント

- [Vitest Docs](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [Testing Library - Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

### 学習リソース

- Kent C. Dodds - Testing JavaScript
- React Testing Library Examples

## 次のステップ

1. このリサーチをレビュー
2. 実行計画（`frontend-test-plan.md`）を作成
3. 計画承認後、実装開始

---

**調査者**: Claude Code
**完了日**: 2026-03-28
