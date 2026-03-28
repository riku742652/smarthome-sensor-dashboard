# Frontend Development Guidelines

このドキュメントは、フロントエンド開発の規約とベストプラクティスを定義します。

## 技術スタック

### コア

- **React** 18+
- **TypeScript** 5+
- **Vite** - ビルドツール

### スタイリング

- **TailwindCSS** - ユーティリティファースト
- カスタムCSSは最小限に

### 状態管理

- **React Hooks** - useState, useEffect, useContext
- **Zustand** - グローバル状態（必要に応じて）

### データ可視化

- **Recharts** - シンプルで柔軟

### バリデーション

- **Zod** - ランタイム型検証

## ディレクトリ構造

```
src/
├── domains/
│   ├── sensor/
│   │   └── ui/
│   │       ├── components/
│   │       │   ├── SensorCard.tsx
│   │       │   └── SensorCard.test.tsx
│   │       └── pages/
│   │           └── SensorDashboard.tsx
│   └── dashboard/
│       └── ui/
│           ├── components/
│           └── pages/
├── shared/
│   ├── components/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   └── Loading.tsx
│   ├── hooks/
│   │   ├── useInterval.ts
│   │   └── useLocalStorage.ts
│   └── utils/
│       └── formatters.ts
└── app/
    ├── main.tsx
    ├── App.tsx
    └── styles/
        └── globals.css
```

## コンポーネント設計

### ファイル命名

- PascalCase: `SensorCard.tsx`
- コロケーション: `SensorCard.test.tsx`, `SensorCard.stories.tsx`

### コンポーネント構造

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

### コンポーネントの分類

#### 1. Presentational Components（表示用）

- ロジックを持たない
- props経由でデータを受け取る
- 再利用可能

```typescript
interface CardProps {
  title: string
  children: React.ReactNode
}

export function Card({ title, children }: CardProps) {
  return (
    <div className="border rounded-lg p-4">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </div>
  )
}
```

#### 2. Container Components（ロジック用）

- データ取得とロジックを持つ
- Presentational Componentsを組み合わせる

```typescript
export function SensorDashboard() {
  const { data, loading, error } = useSensorData()

  if (loading) return <Loading />
  if (error) return <Error message={error.message} />

  return (
    <Card title="センサーダッシュボード">
      <SensorCard data={data} />
    </Card>
  )
}
```

## Hooks の使用

### カスタムHooksの命名

- `use` プレフィックス必須
- 動詞 + 名詞: `useSensorData`, `useInterval`

### カスタムHooksの例

```typescript
export function useSensorData() {
  const [data, setData] = useState<SensorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    fetchSensorData()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  return { data, loading, error }
}
```

## スタイリング

### TailwindCSS規約

```typescript
// ✅ Good: 関連するクラスをグループ化
<div className="flex flex-col gap-4 p-4 bg-white rounded-lg shadow-md">

// ❌ Bad: 無秩序
<div className="p-4 flex rounded-lg gap-4 shadow-md flex-col bg-white">
```

### クラス順序（推奨）

1. Layout: `flex`, `grid`, `block`
2. Positioning: `absolute`, `relative`
3. Sizing: `w-full`, `h-screen`
4. Spacing: `p-4`, `m-2`, `gap-4`
5. Typography: `text-lg`, `font-bold`
6. Visual: `bg-white`, `border`, `rounded-lg`
7. Interactive: `hover:`, `focus:`

### カスタムスタイルが必要な場合

```typescript
// Tailwind configで定義
// tailwind.config.js
export default {
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#...',
          secondary: '#...',
        }
      }
    }
  }
}
```

## 型定義

### Props型

```typescript
// ✅ Good: interface を使用
interface ButtonProps {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
  disabled?: boolean
}

// ✅ Good: 子要素を受け取る場合
interface CardProps {
  children: React.ReactNode
  title?: string
}
```

### 型のエクスポート

```typescript
// types/SensorData.ts
export interface SensorData {
  temperature: number
  humidity: number
  co2: number
  timestamp: Date
}

// components/SensorCard.tsx
import { SensorData } from '../../types/SensorData'
```

## データフェッチング

### パターン

```typescript
export function useFetchData<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(url)
      const json = await response.json()
      const validated = validateSchema(json) // Zodで検証
      setData(validated)
    } catch (err) {
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { data, loading, error, refetch }
}
```

## エラーハンドリング

### エラー境界

```typescript
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback />
    }
    return this.props.children
  }
}
```

## パフォーマンス最適化

### メモ化

```typescript
// 高コストな計算
const chartData = useMemo(() => {
  return processData(rawData)
}, [rawData])

// コールバック
const handleClick = useCallback(() => {
  doSomething()
}, [dependency])
```

### 遅延ローディング

```typescript
const ChartComponent = lazy(() => import('./ChartComponent'))

function Dashboard() {
  return (
    <Suspense fallback={<Loading />}>
      <ChartComponent />
    </Suspense>
  )
}
```

## アクセシビリティ

- セマンティックHTML使用
- `aria-label`, `aria-describedby` を適切に使用
- キーボードナビゲーション対応
- カラーコントラスト WCAG AA 準拠

## テスト

### コンポーネントテスト

```typescript
import { render, screen } from '@testing-library/react'
import { SensorCard } from './SensorCard'

test('displays sensor data', () => {
  const data = {
    temperature: 22.5,
    humidity: 45,
    co2: 600,
    timestamp: new Date(),
  }

  render(<SensorCard data={data} />)

  expect(screen.getByText('22.5°C')).toBeInTheDocument()
  expect(screen.getByText('45%')).toBeInTheDocument()
})
```

## ベストプラクティス

### DO ✅

- 小さく単一責任のコンポーネント
- TypeScript strict mode
- 境界でデータ検証（Zod）
- テストを書く
- 意味のある変数名

### DON'T ❌

- `any` 型を使わない
- ネストを深くしない（3階層まで）
- 巨大なコンポーネント（300行超）
- インラインスタイル
- 未処理のPromise

## 変更履歴

- 2026-03-28: 初期作成
