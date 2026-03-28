# Frontend React UI - Research

## 目的

Switchbot温湿度CO2センサーのデータを可視化するReact SPAを実装する。

## 既存のアーキテクチャ調査

### システム全体のアーキテクチャ

```
User
  ↓
CloudFront (CDN) - 将来実装
  ↓
S3 (React SPA) - 今回実装
  ↓
Lambda (API) + Function URL - 既存
  FastAPI + Lambda Web Adapter
  Docker Container (ECR)
  ↓
DynamoDB - 既存
  ↑
Lambda (Poller) - 既存
  Python + boto3
  EventBridge (1 minute interval)
  ↓
Switchbot API
```

### 既存のバックエンドAPI

**APIエンドポイント**: Lambda Function URL（デプロイ後に取得）

**利用可能なエンドポイント**:

1. `GET /` - ヘルスチェック
   - レスポンス: `{ "status": "ok", "message": "..." }`

2. `GET /health` - ヘルスチェック（エイリアス）
   - レスポンス: `{ "status": "ok", "message": "Healthy" }`

3. `GET /data?hours={1-168}` - センサーデータ取得
   - パラメータ: `hours` (1-168時間、デフォルト24時間)
   - レスポンス:
     ```json
     {
       "data": [
         {
           "deviceId": "string",
           "timestamp": 1234567890000,
           "temperature": 22.5,
           "humidity": 45.0,
           "co2": 600
         }
       ],
       "count": 100
     }
     ```

4. `GET /latest` - 最新データ1件
   - レスポンス:
     ```json
     {
       "deviceId": "string",
       "timestamp": 1234567890000,
       "temperature": 22.5,
       "humidity": 45.0,
       "co2": 600
     }
     ```

5. `GET /docs` - FastAPI自動生成ドキュメント（OpenAPI）

### データモデル（Pydantic）

```python
class SensorData:
    deviceId: str
    timestamp: int  # Unix timestamp (ミリ秒)
    temperature: float  # 摂氏
    humidity: float  # パーセンテージ
    co2: int  # ppm
```

## 技術スタックの確認

### 確定している技術

- **React**: 18.3.1
- **TypeScript**: 5.6.3
- **Vite**: 6.0.1 (ビルドツール)
- **TailwindCSS**: 3.4.15 (スタイリング)
- **Recharts**: 2.13.3 (グラフライブラリ)
- **Zod**: 3.23.8 (バリデーション)
- **Vitest**: 2.1.8 (テストフレームワーク)
- **ESLint + Prettier**: リント・フォーマット

### 状態管理

- **React Hooks**: useState, useEffect, useContext
- **Zustand**: グローバル状態管理（必要に応じて）

→ 初期実装では React Hooks のみで十分。Zustand は複雑化したら追加。

## アーキテクチャ原則の確認

### 階層化ドメインアーキテクチャ

```
┌─────────────────────────────────────────┐
│           UI Layer                      │
│  (React Components, Pages, Routing)     │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│         Service Layer                   │
│  (Business Logic, Data Orchestration)   │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│       Repository Layer                  │
│  (Data Access, External API Calls)      │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│         Config Layer                    │
│  (Configuration, Constants)             │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│          Types Layer                    │
│  (Type Definitions, Interfaces)         │
└─────────────────────────────────────────┘
```

**ルール**: 依存は下方向のみ。逆方向の依存は禁止。

### ディレクトリ構造（計画）

```
src/
├── domains/
│   ├── sensor/              # センサードメイン
│   │   ├── types/          # SensorData型定義
│   │   ├── config/         # API URL、ポーリング間隔など
│   │   ├── repository/     # API呼び出し（SensorRepository）
│   │   ├── service/        # データ正規化、キャッシング
│   │   └── ui/
│   │       ├── components/ # センサーカード、メトリクスなど
│   │       └── pages/      # センサーダッシュボードページ
│   └── dashboard/           # ダッシュボードドメイン
│       ├── types/
│       ├── service/        # グラフデータ準備
│       └── ui/
│           ├── components/ # チャートコンポーネント
│           └── pages/      # メインダッシュボード
├── shared/                  # 共有ユーティリティ
│   ├── types/              # 共有型
│   ├── utils/              # ユーティリティ関数（日時フォーマットなど）
│   ├── components/         # 共有UIコンポーネント（Button, Card, Loadingなど）
│   ├── hooks/              # カスタムHooks（useInterval, useLocalStorageなど）
│   └── providers/          # 横断的関心事プロバイダー
└── app/                     # アプリケーション起動
    ├── main.tsx            # エントリーポイント
    ├── App.tsx             # ルートコンポーネント
    └── styles/
        └── globals.css     # グローバルスタイル
```

## ドキュメント規約の確認

### コンポーネント設計（FRONTEND.md）

#### ファイル命名

- PascalCase: `SensorCard.tsx`
- コロケーション: `SensorCard.test.tsx`

#### コンポーネント構造

```typescript
// 1. Imports
import { useState } from 'react'
import { SensorData } from '../types/SensorData'

// 2. Types
interface SensorCardProps {
  data: SensorData
  onRefresh?: () => void
}

// 3. Component
export function SensorCard({ data, onRefresh }: SensorCardProps) {
  // 3.1 Hooks
  const [isExpanded, setIsExpanded] = useState(false)

  // 3.2 Event handlers
  const handleToggle = () => {
    setIsExpanded(!isExpanded)
  }

  // 3.3 Render
  return (
    <div className="...">
      {/* JSX */}
    </div>
  )
}
```

#### Presentational vs Container

- **Presentational**: ロジック無し、props経由でデータ受け取り、再利用可能
- **Container**: データ取得とロジック、Presentationalを組み合わせ

### TailwindCSS規約

**クラス順序**:
1. Layout: `flex`, `grid`, `block`
2. Positioning: `absolute`, `relative`
3. Sizing: `w-full`, `h-screen`
4. Spacing: `p-4`, `m-2`, `gap-4`
5. Typography: `text-lg`, `font-bold`
6. Visual: `bg-white`, `border`, `rounded-lg`
7. Interactive: `hover:`, `focus:`

## 品質基準（QUALITY_SCORE.md）

### メトリクス

- **Cyclomatic Complexity**: 関数あたり10以下
- **ファイルサイズ**: 300行以内
- **関数サイズ**: 50行以内
- **テストカバレッジ**: Line 80%以上、Branch 75%以上、Function 85%以上

### 型安全性

- `any` 型の使用禁止（例外は文書化）
- すべての関数に明示的な戻り値の型
- すべてのPropsに型定義
- 外部データは境界でZodバリデーション

### CI/CD品質ゲート

1. **Lint**: `npm run lint` - ゼロエラー
2. **Type Check**: `npm run type-check` - ゼロエラー
3. **Tests**: `npm run test` - すべてパス、カバレッジ80%以上
4. **Build**: `npm run build` - 成功

## セキュリティ要件（SECURITY.md）

### 環境変数

```bash
# .env
VITE_API_BASE_URL=https://your-lambda-function-url.lambda-url.ap-northeast-1.on.aws
```

**重要**: APIキーやトークンは不要。Lambda Function URLは公開エンドポイントで、CORS設定済み。

### 入力検証（Zod）

すべての外部データ（API レスポンス）をZodで検証:

```typescript
import { z } from 'zod'

const SensorDataSchema = z.object({
  deviceId: z.string(),
  timestamp: z.number().int().positive(),
  temperature: z.number().min(-50).max(100),
  humidity: z.number().min(0).max(100),
  co2: z.number().int().min(0).max(10000),
})

type SensorData = z.infer<typeof SensorDataSchema>
```

### XSS対策

- Reactの自動エスケープを活用
- `dangerouslySetInnerHTML` 禁止
- 外部リンクに `rel="noopener noreferrer"`

### LocalStorage

**保存して良いもの**:
- ✅ ユーザー設定（テーマ、言語、グラフ表示期間）
- ✅ キャッシュされたセンサーデータ（期限付き）
- ✅ UI状態

**保存してはいけないもの**:
- ❌ APIキー/トークン
- ❌ 個人識別情報（PII）

## パフォーマンス要件

### バンドルサイズ

- 初期バンドル: < 500KB
- コード分割: ルートごと（将来的に）
- Tree shaking: 有効

### ランタイムパフォーマンス

- **Time to Interactive**: < 3秒
- **First Contentful Paint**: < 1.5秒
- **Cumulative Layout Shift**: < 0.1

### API パフォーマンス

- レスポンス時間: < 2秒
- リトライ: 最大3回（一時的な失敗に対応）
- ポーリング間隔: 60秒（過度なAPI呼び出しを避ける）

## UI/UX要件の推定

### 必要な機能

1. **ダッシュボード（メイン画面）**
   - 最新値の表示（温度、湿度、CO2）
   - 時系列グラフ（3つのメトリクスを表示）
   - 時間範囲の選択（1h, 6h, 12h, 24h, 7d）
   - 自動更新（1分間隔）
   - 手動リフレッシュボタン

2. **グラフ機能**
   - 複数メトリクスの表示（温度、湿度、CO2）
   - ツールチップ（ホバーで詳細表示）
   - レスポンシブデザイン（モバイル対応）

3. **エラーハンドリング**
   - API接続エラーの表示
   - データ読み込み中のローディング表示
   - データが無い場合の空状態表示

4. **設定（Phase 2）**
   - ダークモード切り替え
   - 温度単位切り替え（摂氏/華氏）
   - グラフ表示のカスタマイズ

### デザインガイドライン

- **カラーパレット**:
  - 温度: オレンジ/赤系（#ef4444）
  - 湿度: ブルー系（#3b82f6）
  - CO2: グリーン系（#10b981）

- **レイアウト**:
  - デスクトップ: 3カラムで最新値、グラフは下部に配置
  - モバイル: 1カラム、スクロール可能

- **アクセシビリティ**:
  - WCAG AA準拠
  - キーボードナビゲーション
  - スクリーンリーダー対応

## 既存の設定ファイル確認

### package.json

すでに以下がインストール済み:
- React 18.3.1
- TypeScript 5.6.3
- Vite 6.0.1
- TailwindCSS 3.4.15
- Recharts 2.13.3
- Zod 3.23.8
- Vitest 2.1.8
- ESLint + Prettier

**スクリプト**:
- `npm run dev` - 開発サーバー起動
- `npm run build` - ビルド
- `npm run lint` - リント実行
- `npm run type-check` - 型チェック
- `npm run test` - テスト実行
- `npm run test:coverage` - カバレッジ付きテスト

### 不足している設定ファイル

以下のファイルが必要:
- `vite.config.ts` - Viteの設定
- `tsconfig.json` - TypeScriptの設定
- `tailwind.config.js` - TailwindCSSの設定
- `postcss.config.js` - PostCSSの設定
- `eslint.config.js` - ESLintの設定（Flat Config形式）
- `.prettierrc` - Prettierの設定
- `vitest.config.ts` - Vitestの設定

## 外部依存関係

### APIエンドポイント

- Lambda Function URLはデプロイ後に取得
- 環境変数 `VITE_API_BASE_URL` に設定

### CORS

- Lambda API側でCORS設定済み（`allow_origins=["*"]`）
- クライアントサイドでの特別な対応は不要

### データ更新頻度

- Lambda Pollerは1分間隔でSwitchbot APIをポーリング
- フロントエンドも1分間隔で `/data` エンドポイントをポーリング推奨
- リアルタイム性は不要（WebSocket不要）

## 技術的課題と対策

### 1. APIエンドポイントが未デプロイ

**課題**: Lambda APIがまだデプロイされていない

**対策**:
- モックデータを使用してローカル開発可能にする
- 環境変数でAPIエンドポイントを切り替え
- `VITE_USE_MOCK_DATA=true` の場合はモックデータを使用

### 2. 時系列データの処理

**課題**: DynamoDBから返されるデータは時系列順だが、フロントエンドでの加工が必要

**対策**:
- Service層でデータ整形（timestamp→Date変換、ソート）
- メモ化（useMemo）でパフォーマンス最適化

### 3. グラフの応答性

**課題**: 大量のデータポイントでグラフが重くなる可能性

**対策**:
- データポイントを間引く（1週間分なら10分間隔に集約）
- Rechartsの`isAnimationActive={false}`で不要なアニメーションを無効化
- 仮想化（必要に応じて）

### 4. エラーリカバリー

**課題**: ネットワークエラーや一時的なAPI障害

**対策**:
- 指数バックオフによるリトライ
- エラー状態の適切な表示
- ローカルキャッシュからのフォールバック

## 参考資料

### 内部ドキュメント

- `ARCHITECTURE.md` - アーキテクチャ原則
- `docs/FRONTEND.md` - フロントエンド規約
- `docs/QUALITY_SCORE.md` - 品質基準
- `docs/SECURITY.md` - セキュリティ要件
- `lambda/api/main.py` - API実装
- `lambda/api/models/sensor.py` - データモデル

### 外部ドキュメント

- [React Documentation](https://react.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Vite Documentation](https://vitejs.dev/)
- [TailwindCSS Documentation](https://tailwindcss.com/docs)
- [Recharts Documentation](https://recharts.org/)
- [Zod Documentation](https://zod.dev/)

## 次のステップ

1. 実装計画の作成（`frontend-react-ui-plan.md`）
2. ユーザーによる計画のレビューと承認
3. 実装フェーズ開始

## 変更履歴

- 2026-03-28: 初期リサーチ完了
