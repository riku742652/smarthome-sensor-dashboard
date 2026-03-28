# Frontend React UI - Implementation Plan

## 目標と成功基準

### 目標

Switchbot温湿度CO2センサーのデータを可視化するReact SPAを実装し、ユーザーがセンサーデータを直感的に理解できるダッシュボードを提供する。

### 成功基準

1. **機能要件**
   - ✅ 最新のセンサーデータ（温度、湿度、CO2）をカード形式で表示
   - ✅ 時系列グラフで3つのメトリクスを可視化
   - ✅ 時間範囲の選択（1h, 6h, 12h, 24h, 7d）
   - ✅ 自動更新（1分間隔）と手動リフレッシュ
   - ✅ ローディング状態とエラー状態の適切な表示

2. **品質要件**
   - ✅ TypeScript strict mode、型エラーゼロ
   - ✅ ESLint/Prettierエラーゼロ
   - ✅ テストカバレッジ80%以上
   - ✅ バンドルサイズ < 500KB
   - ✅ Time to Interactive < 3秒

3. **セキュリティ要件**
   - ✅ API URLは環境変数で管理
   - ✅ APIレスポンスはZodで検証
   - ✅ XSS対策（Reactのデフォルト保護）

4. **アクセシビリティ要件**
   - ✅ セマンティックHTML使用
   - ✅ キーボードナビゲーション対応
   - ✅ カラーコントラスト WCAG AA準拠

## アーキテクチャ上の変更

### 新規作成するディレクトリ

```
src/
├── domains/
│   ├── sensor/
│   │   ├── types/
│   │   ├── config/
│   │   ├── repository/
│   │   ├── service/
│   │   └── ui/
│   │       ├── components/
│   │       └── pages/
│   └── dashboard/
│       ├── types/
│       ├── service/
│       └── ui/
│           ├── components/
│           └── pages/
├── shared/
│   ├── types/
│   ├── utils/
│   ├── components/
│   ├── hooks/
│   └── providers/
└── app/
    ├── styles/
    └── assets/
```

### 新規作成する設定ファイル

- `vite.config.ts`
- `tsconfig.json`
- `tsconfig.node.json`
- `tailwind.config.js`
- `postcss.config.js`
- `eslint.config.js`
- `.prettierrc`
- `vitest.config.ts`
- `.env.example`
- `index.html`

### 依存関係の追加

既存のpackage.jsonに含まれているため、追加不要。

## 実装ステップ

### Phase 1: プロジェクトセットアップと設定ファイル

#### 目的
プロジェクトの基盤となる設定ファイルとディレクトリ構造を作成する。

#### 作業内容

**1.1 Vite設定**

`vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@domains': path.resolve(__dirname, './src/domains'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@app': path.resolve(__dirname, './src/app'),
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
  },
})
```

**1.2 TypeScript設定**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@domains/*": ["./src/domains/*"],
      "@shared/*": ["./src/shared/*"],
      "@app/*": ["./src/app/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

**1.3 TailwindCSS設定**

`tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        temperature: {
          DEFAULT: '#ef4444',
          light: '#fca5a5',
          dark: '#b91c1c',
        },
        humidity: {
          DEFAULT: '#3b82f6',
          light: '#93c5fd',
          dark: '#1e40af',
        },
        co2: {
          DEFAULT: '#10b981',
          light: '#6ee7b7',
          dark: '#047857',
        },
      },
    },
  },
  plugins: [],
}
```

`postcss.config.js`:
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

**1.4 ESLint設定（Flat Config）**

`eslint.config.js`:
```javascript
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
    },
  },
]
```

**1.5 Prettier設定**

`.prettierrc`:
```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 80,
  "arrowParens": "always"
}
```

**1.6 Vitest設定**

`vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.test.{ts,tsx}',
        '**/*.config.{js,ts}',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@domains': path.resolve(__dirname, './src/domains'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@app': path.resolve(__dirname, './src/app'),
    },
  },
})
```

**1.7 環境変数テンプレート**

`.env.example`:
```bash
# API Configuration
VITE_API_BASE_URL=https://your-lambda-function-url.lambda-url.ap-northeast-1.on.aws

# Development Mode
VITE_USE_MOCK_DATA=false

# Polling Interval (milliseconds)
VITE_POLLING_INTERVAL=60000
```

**1.8 HTMLエントリーポイント**

`index.html`:
```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Switchbot温湿度CO2センサーダッシュボード" />
    <meta http-equiv="X-Content-Type-Options" content="nosniff" />
    <meta http-equiv="X-Frame-Options" content="DENY" />
    <title>Smarthome Sensor Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/main.tsx"></script>
  </body>
</html>
```

**1.9 ディレクトリ構造の作成**

必要なディレクトリをすべて作成。

#### 完了条件

- ✅ すべての設定ファイルが作成されている
- ✅ `npm run dev` でViteが起動する
- ✅ `npm run lint` でエラーが出ない
- ✅ `npm run type-check` でエラーが出ない

---

### Phase 2: Types層の実装

#### 目的
型定義を作成し、型安全性を確保する。

#### 作業内容

**2.1 SensorData型**

`src/domains/sensor/types/SensorData.ts`:
```typescript
/**
 * センサーデータの型定義
 */
export interface SensorData {
  /** デバイスID */
  deviceId: string
  /** タイムスタンプ（Unixミリ秒） */
  timestamp: number
  /** 温度（摂氏） */
  temperature: number
  /** 湿度（パーセンテージ） */
  humidity: number
  /** CO2濃度（ppm） */
  co2: number
}

/**
 * APIレスポンスの型定義
 */
export interface SensorDataResponse {
  data: SensorData[]
  count: number
}

/**
 * API エラーの型定義
 */
export interface ApiError {
  message: string
  statusCode?: number
}
```

**2.2 Index barrel export**

`src/domains/sensor/types/index.ts`:
```typescript
export type { SensorData, SensorDataResponse, ApiError } from './SensorData'
```

**2.3 DashboardTypes**

`src/domains/dashboard/types/ChartData.ts`:
```typescript
import { SensorData } from '@domains/sensor/types'

/**
 * グラフ表示用のデータポイント
 */
export interface ChartDataPoint {
  timestamp: number
  date: Date
  temperature: number
  humidity: number
  co2: number
}

/**
 * 時間範囲オプション
 */
export type TimeRange = '1h' | '6h' | '12h' | '24h' | '7d'

/**
 * 時間範囲と時間（時間単位）のマッピング
 */
export const TIME_RANGE_HOURS: Record<TimeRange, number> = {
  '1h': 1,
  '6h': 6,
  '12h': 12,
  '24h': 24,
  '7d': 168,
}

/**
 * 時間範囲のラベル
 */
export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  '1h': '1時間',
  '6h': '6時間',
  '12h': '12時間',
  '24h': '24時間',
  '7d': '7日間',
}
```

`src/domains/dashboard/types/index.ts`:
```typescript
export type { ChartDataPoint, TimeRange } from './ChartData'
export { TIME_RANGE_HOURS, TIME_RANGE_LABELS } from './ChartData'
```

**2.4 共有型**

`src/shared/types/common.ts`:
```typescript
/**
 * 非同期操作の状態
 */
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error'

/**
 * 非同期データの状態を表す型
 */
export interface AsyncState<T, E = Error> {
  data: T | null
  status: AsyncStatus
  error: E | null
}
```

`src/shared/types/index.ts`:
```typescript
export type { AsyncStatus, AsyncState } from './common'
```

#### 完了条件

- ✅ すべての型定義ファイルが作成されている
- ✅ `npm run type-check` でエラーが出ない
- ✅ 型定義にJSDocコメントが付与されている

---

### Phase 3: Config層の実装

#### 目的
設定と定数を一箇所で管理する。

#### 作業内容

**3.1 API設定**

`src/domains/sensor/config/api.ts`:
```typescript
/**
 * API設定
 */
export const API_CONFIG = {
  /** APIベースURL */
  baseUrl: import.meta.env.VITE_API_BASE_URL || '',
  /** モックデータを使用するか */
  useMockData: import.meta.env.VITE_USE_MOCK_DATA === 'true',
  /** ポーリング間隔（ミリ秒） */
  pollingInterval: Number(import.meta.env.VITE_POLLING_INTERVAL) || 60000,
  /** リトライ回数 */
  maxRetries: 3,
  /** リトライ間隔（ミリ秒） */
  retryDelay: 1000,
} as const

/**
 * APIエンドポイント
 */
export const API_ENDPOINTS = {
  health: '/health',
  data: '/data',
  latest: '/latest',
} as const
```

`src/domains/sensor/config/index.ts`:
```typescript
export { API_CONFIG, API_ENDPOINTS } from './api'
```

**3.2 ダッシュボード設定**

`src/domains/dashboard/config/chart.ts`:
```typescript
/**
 * グラフ設定
 */
export const CHART_CONFIG = {
  /** グラフの高さ（px） */
  height: 300,
  /** アニメーション有効化 */
  animationEnabled: false,
  /** グリッドの表示 */
  showGrid: true,
  /** ツールチップの表示 */
  showTooltip: true,
} as const

/**
 * メトリクス設定
 */
export const METRICS_CONFIG = {
  temperature: {
    label: '温度',
    unit: '°C',
    color: '#ef4444',
    min: -50,
    max: 100,
  },
  humidity: {
    label: '湿度',
    unit: '%',
    color: '#3b82f6',
    min: 0,
    max: 100,
  },
  co2: {
    label: 'CO2',
    unit: 'ppm',
    color: '#10b981',
    min: 0,
    max: 5000,
  },
} as const
```

`src/domains/dashboard/config/index.ts`:
```typescript
export { CHART_CONFIG, METRICS_CONFIG } from './chart'
```

#### 完了条件

- ✅ 設定ファイルが作成されている
- ✅ すべての設定に型が付与されている
- ✅ 環境変数の読み込みが正しく動作する

---

### Phase 4: Repository層の実装（API呼び出し）

#### 目的
外部APIとの通信を担当するRepositoryを実装する。

#### 作業内容

**4.1 Zodスキーマ**

`src/domains/sensor/repository/schemas.ts`:
```typescript
import { z } from 'zod'

/**
 * SensorDataのZodスキーマ
 */
export const SensorDataSchema = z.object({
  deviceId: z.string(),
  timestamp: z.number().int().positive(),
  temperature: z.number().min(-50).max(100),
  humidity: z.number().min(0).max(100),
  co2: z.number().int().min(0).max(10000),
})

/**
 * SensorDataResponseのZodスキーマ
 */
export const SensorDataResponseSchema = z.object({
  data: z.array(SensorDataSchema),
  count: z.number().int().nonnegative(),
})
```

**4.2 SensorRepository**

`src/domains/sensor/repository/SensorRepository.ts`:
```typescript
import { API_CONFIG, API_ENDPOINTS } from '../config'
import type {
  SensorData,
  SensorDataResponse,
  ApiError,
} from '../types'
import { SensorDataSchema, SensorDataResponseSchema } from './schemas'

/**
 * センサーデータリポジトリ
 * 外部API（Lambda Function URL）との通信を担当
 */
export class SensorRepository {
  private baseUrl: string

  constructor(baseUrl: string = API_CONFIG.baseUrl) {
    this.baseUrl = baseUrl
  }

  /**
   * ヘルスチェック
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}${API_ENDPOINTS.health}`)
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * センサーデータを取得
   * @param hours 取得する時間範囲（時間）
   */
  async fetchSensorData(hours: number): Promise<SensorDataResponse> {
    try {
      const url = `${this.baseUrl}${API_ENDPOINTS.data}?hours=${hours}`
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const json = await response.json()

      // Zodでバリデーション
      const validated = SensorDataResponseSchema.parse(json)

      return validated
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * 最新のセンサーデータを取得
   */
  async fetchLatestData(): Promise<SensorData> {
    try {
      const url = `${this.baseUrl}${API_ENDPOINTS.latest}`
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const json = await response.json()

      // Zodでバリデーション
      const validated = SensorDataSchema.parse(json)

      return validated
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * エラーハンドリング
   */
  private handleError(error: unknown): ApiError {
    if (error instanceof Error) {
      return {
        message: error.message,
      }
    }
    return {
      message: 'Unknown error occurred',
    }
  }
}

/**
 * シングルトンインスタンス
 */
export const sensorRepository = new SensorRepository()
```

**4.3 MockRepository（開発用）**

`src/domains/sensor/repository/MockSensorRepository.ts`:
```typescript
import type {
  SensorData,
  SensorDataResponse,
} from '../types'

/**
 * モックデータを返すリポジトリ（開発用）
 */
export class MockSensorRepository {
  /**
   * ヘルスチェック
   */
  async healthCheck(): Promise<boolean> {
    return true
  }

  /**
   * モックセンサーデータを生成
   */
  async fetchSensorData(hours: number): Promise<SensorDataResponse> {
    const now = Date.now()
    const interval = 60000 // 1分間隔
    const count = hours * 60

    const data: SensorData[] = []

    for (let i = 0; i < count; i++) {
      const timestamp = now - i * interval
      data.push({
        deviceId: 'mock-device',
        timestamp,
        temperature: 20 + Math.sin(i / 10) * 5 + Math.random() * 2,
        humidity: 50 + Math.cos(i / 15) * 20 + Math.random() * 5,
        co2: 600 + Math.sin(i / 20) * 200 + Math.random() * 50,
      })
    }

    return {
      data: data.reverse(),
      count: data.length,
    }
  }

  /**
   * 最新のモックデータを取得
   */
  async fetchLatestData(): Promise<SensorData> {
    return {
      deviceId: 'mock-device',
      timestamp: Date.now(),
      temperature: 22.5,
      humidity: 55,
      co2: 650,
    }
  }
}

/**
 * シングルトンインスタンス
 */
export const mockSensorRepository = new MockSensorRepository()
```

**4.4 Repository Factory**

`src/domains/sensor/repository/index.ts`:
```typescript
import { API_CONFIG } from '../config'
import { sensorRepository } from './SensorRepository'
import { mockSensorRepository } from './MockSensorRepository'

/**
 * リポジトリのファクトリ関数
 * 開発モードではモックを返す
 */
export function getSensorRepository() {
  return API_CONFIG.useMockData ? mockSensorRepository : sensorRepository
}

export { SensorRepository } from './SensorRepository'
export { MockSensorRepository } from './MockSensorRepository'
```

#### 完了条件

- ✅ Repository層が実装されている
- ✅ Zodバリデーションが機能している
- ✅ モックリポジトリで開発可能
- ✅ エラーハンドリングが適切に実装されている

---

### Phase 5: Service層の実装（ビジネスロジック）

#### 目的
データの加工、キャッシング、ビジネスロジックを実装する。

#### 作業内容

**5.1 SensorService**

`src/domains/sensor/service/SensorService.ts`:
```typescript
import { getSensorRepository } from '../repository'
import type { SensorData, SensorDataResponse } from '../types'

/**
 * センサーサービス
 * データの取得、キャッシング、正規化を担当
 */
export class SensorService {
  private repository = getSensorRepository()
  private cache: Map<string, { data: SensorDataResponse; timestamp: number }> =
    new Map()
  private cacheExpiry = 30000 // 30秒

  /**
   * センサーデータを取得（キャッシュ付き）
   */
  async getSensorData(hours: number): Promise<SensorDataResponse> {
    const cacheKey = `data-${hours}`
    const cached = this.cache.get(cacheKey)

    // キャッシュが有効な場合は返す
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data
    }

    // APIから取得
    const data = await this.repository.fetchSensorData(hours)

    // キャッシュに保存
    this.cache.set(cacheKey, { data, timestamp: Date.now() })

    return data
  }

  /**
   * 最新データを取得
   */
  async getLatestData(): Promise<SensorData> {
    return this.repository.fetchLatestData()
  }

  /**
   * ヘルスチェック
   */
  async checkHealth(): Promise<boolean> {
    return this.repository.healthCheck()
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.cache.clear()
  }
}

/**
 * シングルトンインスタンス
 */
export const sensorService = new SensorService()
```

`src/domains/sensor/service/index.ts`:
```typescript
export { SensorService, sensorService } from './SensorService'
```

**5.2 DashboardService**

`src/domains/dashboard/service/ChartDataService.ts`:
```typescript
import type { SensorData } from '@domains/sensor/types'
import type { ChartDataPoint } from '../types'

/**
 * グラフデータサービス
 * センサーデータをグラフ表示用に変換
 */
export class ChartDataService {
  /**
   * センサーデータをグラフデータに変換
   */
  transformToChartData(sensorData: SensorData[]): ChartDataPoint[] {
    return sensorData.map((data) => ({
      timestamp: data.timestamp,
      date: new Date(data.timestamp),
      temperature: data.temperature,
      humidity: data.humidity,
      co2: data.co2,
    }))
  }

  /**
   * データポイントを間引く（パフォーマンス最適化）
   * @param data 元データ
   * @param maxPoints 最大データポイント数
   */
  downsample(data: ChartDataPoint[], maxPoints: number): ChartDataPoint[] {
    if (data.length <= maxPoints) {
      return data
    }

    const step = Math.ceil(data.length / maxPoints)
    return data.filter((_, index) => index % step === 0)
  }

  /**
   * 統計情報を計算
   */
  calculateStats(data: SensorData[]): {
    temperature: { avg: number; min: number; max: number }
    humidity: { avg: number; min: number; max: number }
    co2: { avg: number; min: number; max: number }
  } {
    if (data.length === 0) {
      return {
        temperature: { avg: 0, min: 0, max: 0 },
        humidity: { avg: 0, min: 0, max: 0 },
        co2: { avg: 0, min: 0, max: 0 },
      }
    }

    const temperatures = data.map((d) => d.temperature)
    const humidities = data.map((d) => d.humidity)
    const co2s = data.map((d) => d.co2)

    return {
      temperature: {
        avg: this.average(temperatures),
        min: Math.min(...temperatures),
        max: Math.max(...temperatures),
      },
      humidity: {
        avg: this.average(humidities),
        min: Math.min(...humidities),
        max: Math.max(...humidities),
      },
      co2: {
        avg: this.average(co2s),
        min: Math.min(...co2s),
        max: Math.max(...co2s),
      },
    }
  }

  private average(numbers: number[]): number {
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length
  }
}

/**
 * シングルトンインスタンス
 */
export const chartDataService = new ChartDataService()
```

`src/domains/dashboard/service/index.ts`:
```typescript
export { ChartDataService, chartDataService } from './ChartDataService'
```

#### 完了条件

- ✅ Service層が実装されている
- ✅ キャッシング機能が動作する
- ✅ データ変換ロジックが正しく動作する

---

### Phase 6: 共有コンポーネントの実装

#### 目的
再利用可能なUIコンポーネントを実装する。

#### 作業内容

**6.1 Button**

`src/shared/components/Button.tsx`:
```typescript
import { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  const baseStyles = 'rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2'

  const variantStyles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500',
    ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 focus:ring-gray-500',
  }

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  }

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className} ${
        disabled || isLoading ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? 'Loading...' : children}
    </button>
  )
}
```

**6.2 Card**

`src/shared/components/Card.tsx`:
```typescript
import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  title?: string
  subtitle?: string
  className?: string
}

export function Card({ children, title, subtitle, className = '' }: CardProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md p-6 ${className}`}>
      {title && (
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-600 mt-1">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  )
}
```

**6.3 Loading**

`src/shared/components/Loading.tsx`:
```typescript
interface LoadingProps {
  message?: string
  size?: 'sm' | 'md' | 'lg'
}

export function Loading({ message = 'Loading...', size = 'md' }: LoadingProps) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  }

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <div
        className={`${sizeClasses[size]} border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin`}
      />
      {message && <p className="mt-4 text-gray-600">{message}</p>}
    </div>
  )
}
```

**6.4 ErrorMessage**

`src/shared/components/ErrorMessage.tsx`:
```typescript
interface ErrorMessageProps {
  message: string
  onRetry?: () => void
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-red-50 rounded-lg">
      <div className="text-red-600 text-center">
        <svg
          className="w-12 h-12 mx-auto mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-lg font-semibold mb-2">エラーが発生しました</p>
        <p className="text-sm text-red-700">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          再試行
        </button>
      )}
    </div>
  )
}
```

**6.5 EmptyState**

`src/shared/components/EmptyState.tsx`:
```typescript
interface EmptyStateProps {
  message?: string
  description?: string
}

export function EmptyState({
  message = 'データがありません',
  description,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-gray-500">
      <svg
        className="w-16 h-16 mb-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <p className="text-lg font-semibold">{message}</p>
      {description && <p className="text-sm mt-2">{description}</p>}
    </div>
  )
}
```

**6.6 Index barrel export**

`src/shared/components/index.ts`:
```typescript
export { Button } from './Button'
export { Card } from './Card'
export { Loading } from './Loading'
export { ErrorMessage } from './ErrorMessage'
export { EmptyState } from './EmptyState'
```

#### 完了条件

- ✅ 共有コンポーネントが実装されている
- ✅ TailwindCSSでスタイリングされている
- ✅ Props型が定義されている
- ✅ アクセシビリティ対応（セマンティックHTML）

---

### Phase 7: 共有Hooksの実装

#### 目的
再利用可能なカスタムHooksを実装する。

#### 作業内容

**7.1 useInterval**

`src/shared/hooks/useInterval.ts`:
```typescript
import { useEffect, useRef } from 'react'

/**
 * setIntervalをReactで使いやすくするHook
 */
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback)

  // コールバックを最新に保つ
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  // インターバルをセットアップ
  useEffect(() => {
    if (delay === null) {
      return
    }

    const id = setInterval(() => savedCallback.current(), delay)

    return () => clearInterval(id)
  }, [delay])
}
```

**7.2 useLocalStorage**

`src/shared/hooks/useLocalStorage.ts`:
```typescript
import { useState, useEffect } from 'react'

/**
 * LocalStorageと同期するState Hook
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T) => void] {
  // 初期値を取得
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (error) {
      console.error(`Error loading localStorage key "${key}":`, error)
      return initialValue
    }
  })

  // 値を更新
  const setValue = (value: T) => {
    try {
      setStoredValue(value)
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error)
    }
  }

  return [storedValue, setValue]
}
```

**7.3 useFetch**

`src/shared/hooks/useFetch.ts`:
```typescript
import { useState, useEffect, useCallback } from 'react'
import type { AsyncState } from '@shared/types'

/**
 * データフェッチング用のHook
 */
export function useFetch<T>(
  fetchFn: () => Promise<T>,
  dependencies: unknown[] = []
): AsyncState<T> & { refetch: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    status: 'idle',
    error: null,
  })

  const refetch = useCallback(async () => {
    setState({ data: null, status: 'loading', error: null })

    try {
      const data = await fetchFn()
      setState({ data, status: 'success', error: null })
    } catch (error) {
      setState({
        data: null,
        status: 'error',
        error: error as Error,
      })
    }
  }, [fetchFn])

  useEffect(() => {
    refetch()
  }, dependencies)

  return { ...state, refetch }
}
```

**7.4 Index barrel export**

`src/shared/hooks/index.ts`:
```typescript
export { useInterval } from './useInterval'
export { useLocalStorage } from './useLocalStorage'
export { useFetch } from './useFetch'
```

#### 完了条件

- ✅ 共有Hooksが実装されている
- ✅ 型安全性が確保されている
- ✅ 適切なクリーンアップが実装されている

---

### Phase 8: ユーティリティ関数の実装

#### 目的
日時フォーマットなどのユーティリティ関数を実装する。

#### 作業内容

**8.1 日時フォーマット**

`src/shared/utils/formatters.ts`:
```typescript
/**
 * タイムスタンプを読みやすい形式にフォーマット
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/**
 * 時刻のみをフォーマット
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/**
 * 日付のみをフォーマット
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * 相対時間をフォーマット（例: "3分前"）
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}日前`
  if (hours > 0) return `${hours}時間前`
  if (minutes > 0) return `${minutes}分前`
  return 'たった今'
}
```

**8.2 数値フォーマット**

`src/shared/utils/numbers.ts`:
```typescript
/**
 * 小数点以下を指定桁数で丸める
 */
export function roundTo(value: number, decimals: number): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals)
}

/**
 * 温度をフォーマット
 */
export function formatTemperature(value: number): string {
  return `${roundTo(value, 1)}°C`
}

/**
 * 湿度をフォーマット
 */
export function formatHumidity(value: number): string {
  return `${roundTo(value, 0)}%`
}

/**
 * CO2をフォーマット
 */
export function formatCO2(value: number): string {
  return `${Math.round(value)} ppm`
}
```

**8.3 Index barrel export**

`src/shared/utils/index.ts`:
```typescript
export * from './formatters'
export * from './numbers'
```

#### 完了条件

- ✅ ユーティリティ関数が実装されている
- ✅ 国際化対応（Intl API使用）
- ✅ 型安全性が確保されている

---

### Phase 9: センサーUIコンポーネントの実装

#### 目的
センサードメインのUIコンポーネントを実装する。

#### 作業内容

**9.1 MetricCard（メトリクス表示カード）**

`src/domains/sensor/ui/components/MetricCard.tsx`:
```typescript
import { Card } from '@shared/components'

interface MetricCardProps {
  label: string
  value: number
  unit: string
  color: string
  icon?: React.ReactNode
}

export function MetricCard({
  label,
  value,
  unit,
  color,
  icon,
}: MetricCardProps) {
  return (
    <Card className="flex flex-col items-center justify-center">
      {icon && <div className="mb-2">{icon}</div>}
      <p className="text-sm text-gray-600 mb-1">{label}</p>
      <p className="text-3xl font-bold" style={{ color }}>
        {value.toFixed(1)}
        <span className="text-lg ml-1">{unit}</span>
      </p>
    </Card>
  )
}
```

**9.2 SensorDashboard（センサーダッシュボードページ）**

`src/domains/sensor/ui/pages/SensorDashboard.tsx`:
```typescript
import { useState, useEffect } from 'react'
import { sensorService } from '@domains/sensor/service'
import type { SensorData } from '@domains/sensor/types'
import { Loading, ErrorMessage, EmptyState } from '@shared/components'
import { MetricCard } from '../components/MetricCard'
import { formatRelativeTime } from '@shared/utils'
import { METRICS_CONFIG } from '@domains/dashboard/config'
import { useInterval } from '@shared/hooks'
import { API_CONFIG } from '@domains/sensor/config'

export function SensorDashboard() {
  const [latestData, setLatestData] = useState<SensorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = async () => {
    try {
      setLoading(true)
      const data = await sensorService.getLatestData()
      setLatestData(data)
      setError(null)
    } catch (err) {
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // 自動更新（1分間隔）
  useInterval(fetchData, API_CONFIG.pollingInterval)

  if (loading && !latestData) {
    return <Loading message="データを読み込んでいます..." />
  }

  if (error && !latestData) {
    return (
      <ErrorMessage
        message={error.message}
        onRetry={fetchData}
      />
    )
  }

  if (!latestData) {
    return <EmptyState message="センサーデータがありません" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          センサーダッシュボード
        </h1>
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-600">
            最終更新: {formatRelativeTime(latestData.timestamp)}
          </p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            disabled={loading}
          >
            {loading ? '更新中...' : '手動更新'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard
          label={METRICS_CONFIG.temperature.label}
          value={latestData.temperature}
          unit={METRICS_CONFIG.temperature.unit}
          color={METRICS_CONFIG.temperature.color}
        />
        <MetricCard
          label={METRICS_CONFIG.humidity.label}
          value={latestData.humidity}
          unit={METRICS_CONFIG.humidity.unit}
          color={METRICS_CONFIG.humidity.color}
        />
        <MetricCard
          label={METRICS_CONFIG.co2.label}
          value={latestData.co2}
          unit={METRICS_CONFIG.co2.unit}
          color={METRICS_CONFIG.co2.color}
        />
      </div>

      {error && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <p className="text-sm text-yellow-700">
            自動更新でエラーが発生しました: {error.message}
          </p>
        </div>
      )}
    </div>
  )
}
```

**9.3 Index barrel export**

`src/domains/sensor/ui/components/index.ts`:
```typescript
export { MetricCard } from './MetricCard'
```

`src/domains/sensor/ui/pages/index.ts`:
```typescript
export { SensorDashboard } from './SensorDashboard'
```

#### 完了条件

- ✅ センサーUIコンポーネントが実装されている
- ✅ 自動更新が動作する
- ✅ 手動リフレッシュが動作する
- ✅ エラー状態とローディング状態が適切に表示される

---

### Phase 10: グラフコンポーネントの実装

#### 目的
Rechartsを使用してセンサーデータを可視化する。

#### 作業内容

**10.1 TimeRangeSelector（時間範囲選択）**

`src/domains/dashboard/ui/components/TimeRangeSelector.tsx`:
```typescript
import type { TimeRange } from '@domains/dashboard/types'
import { TIME_RANGE_LABELS } from '@domains/dashboard/types'

interface TimeRangeSelectorProps {
  selectedRange: TimeRange
  onChange: (range: TimeRange) => void
}

export function TimeRangeSelector({
  selectedRange,
  onChange,
}: TimeRangeSelectorProps) {
  const ranges: TimeRange[] = ['1h', '6h', '12h', '24h', '7d']

  return (
    <div className="flex gap-2">
      {ranges.map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            selectedRange === range
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          {TIME_RANGE_LABELS[range]}
        </button>
      ))}
    </div>
  )
}
```

**10.2 SensorChart（センサーグラフ）**

`src/domains/dashboard/ui/components/SensorChart.tsx`:
```typescript
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { ChartDataPoint } from '@domains/dashboard/types'
import { METRICS_CONFIG, CHART_CONFIG } from '@domains/dashboard/config'
import { formatTime } from '@shared/utils'

interface SensorChartProps {
  data: ChartDataPoint[]
}

export function SensorChart({ data }: SensorChartProps) {
  // カスタムツールチップ
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) {
      return null
    }

    const data = payload[0].payload

    return (
      <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3">
        <p className="text-sm font-semibold text-gray-900 mb-2">
          {formatTime(data.timestamp)}
        </p>
        <div className="space-y-1">
          <p className="text-sm" style={{ color: METRICS_CONFIG.temperature.color }}>
            {METRICS_CONFIG.temperature.label}: {data.temperature.toFixed(1)}{METRICS_CONFIG.temperature.unit}
          </p>
          <p className="text-sm" style={{ color: METRICS_CONFIG.humidity.color }}>
            {METRICS_CONFIG.humidity.label}: {data.humidity.toFixed(1)}{METRICS_CONFIG.humidity.unit}
          </p>
          <p className="text-sm" style={{ color: METRICS_CONFIG.co2.color }}>
            {METRICS_CONFIG.co2.label}: {Math.round(data.co2)}{METRICS_CONFIG.co2.unit}
          </p>
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={CHART_CONFIG.height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="timestamp"
          tickFormatter={formatTime}
          stroke="#6b7280"
        />
        <YAxis yAxisId="left" stroke="#6b7280" />
        <YAxis yAxisId="right" orientation="right" stroke="#6b7280" />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="temperature"
          stroke={METRICS_CONFIG.temperature.color}
          name={METRICS_CONFIG.temperature.label}
          dot={false}
          strokeWidth={2}
          isAnimationActive={CHART_CONFIG.animationEnabled}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="humidity"
          stroke={METRICS_CONFIG.humidity.color}
          name={METRICS_CONFIG.humidity.label}
          dot={false}
          strokeWidth={2}
          isAnimationActive={CHART_CONFIG.animationEnabled}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="co2"
          stroke={METRICS_CONFIG.co2.color}
          name={METRICS_CONFIG.co2.label}
          dot={false}
          strokeWidth={2}
          isAnimationActive={CHART_CONFIG.animationEnabled}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

**10.3 DashboardPage（メインダッシュボードページ）**

`src/domains/dashboard/ui/pages/DashboardPage.tsx`:
```typescript
import { useState, useEffect, useMemo } from 'react'
import { sensorService } from '@domains/sensor/service'
import { chartDataService } from '@domains/dashboard/service'
import type { TimeRange } from '@domains/dashboard/types'
import { TIME_RANGE_HOURS } from '@domains/dashboard/types'
import { Loading, ErrorMessage, EmptyState, Card } from '@shared/components'
import { TimeRangeSelector } from '../components/TimeRangeSelector'
import { SensorChart } from '../components/SensorChart'
import { useInterval, useLocalStorage } from '@shared/hooks'
import { API_CONFIG } from '@domains/sensor/config'

export function DashboardPage() {
  const [timeRange, setTimeRange] = useLocalStorage<TimeRange>('timeRange', '24h')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = async () => {
    try {
      setLoading(true)
      const hours = TIME_RANGE_HOURS[timeRange]
      const response = await sensorService.getSensorData(hours)
      const chartData = chartDataService.transformToChartData(response.data)

      // データポイントが多い場合は間引く
      const downsampledData = chartDataService.downsample(chartData, 200)

      setData(downsampledData)
      setError(null)
    } catch (err) {
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [timeRange])

  // 自動更新（1分間隔）
  useInterval(fetchData, API_CONFIG.pollingInterval)

  // 統計情報を計算
  const stats = useMemo(() => {
    if (data.length === 0) return null
    return chartDataService.calculateStats(data)
  }, [data])

  if (loading && data.length === 0) {
    return <Loading message="グラフデータを読み込んでいます..." />
  }

  if (error && data.length === 0) {
    return <ErrorMessage message={error.message} onRetry={fetchData} />
  }

  if (data.length === 0) {
    return <EmptyState message="グラフ表示するデータがありません" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">時系列グラフ</h2>
        <TimeRangeSelector
          selectedRange={timeRange}
          onChange={setTimeRange}
        />
      </div>

      <Card>
        <SensorChart data={data} />
      </Card>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="温度統計">
            <div className="space-y-2 text-sm">
              <p>平均: {stats.temperature.avg.toFixed(1)}°C</p>
              <p>最小: {stats.temperature.min.toFixed(1)}°C</p>
              <p>最大: {stats.temperature.max.toFixed(1)}°C</p>
            </div>
          </Card>
          <Card title="湿度統計">
            <div className="space-y-2 text-sm">
              <p>平均: {stats.humidity.avg.toFixed(1)}%</p>
              <p>最小: {stats.humidity.min.toFixed(1)}%</p>
              <p>最大: {stats.humidity.max.toFixed(1)}%</p>
            </div>
          </Card>
          <Card title="CO2統計">
            <div className="space-y-2 text-sm">
              <p>平均: {Math.round(stats.co2.avg)} ppm</p>
              <p>最小: {Math.round(stats.co2.min)} ppm</p>
              <p>最大: {Math.round(stats.co2.max)} ppm</p>
            </div>
          </Card>
        </div>
      )}

      {error && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <p className="text-sm text-yellow-700">
            自動更新でエラーが発生しました: {error.message}
          </p>
        </div>
      )}
    </div>
  )
}
```

**10.4 Index barrel export**

`src/domains/dashboard/ui/components/index.ts`:
```typescript
export { TimeRangeSelector } from './TimeRangeSelector'
export { SensorChart } from './SensorChart'
```

`src/domains/dashboard/ui/pages/index.ts`:
```typescript
export { DashboardPage } from './DashboardPage'
```

#### 完了条件

- ✅ グラフが正しく表示される
- ✅ 時間範囲の切り替えが動作する
- ✅ ツールチップが表示される
- ✅ 統計情報が正しく計算される

---

### Phase 11: アプリケーション統合

#### 目的
すべてのコンポーネントを統合し、アプリケーションを完成させる。

#### 作業内容

**11.1 グローバルスタイル**

`src/app/styles/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-gray-50 text-gray-900;
  }
}
```

**11.2 App.tsx**

`src/app/App.tsx`:
```typescript
import { SensorDashboard } from '@domains/sensor/ui/pages'
import { DashboardPage } from '@domains/dashboard/ui/pages'

export function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">
            Smarthome Sensor Dashboard
          </h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <SensorDashboard />
        <DashboardPage />
      </main>

      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-sm text-gray-600">
          <p>Smarthome Sensor Dashboard © 2026</p>
        </div>
      </footer>
    </div>
  )
}
```

**11.3 main.tsx（エントリーポイント）**

`src/app/main.tsx`:
```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

**11.4 Vitestセットアップ**

`src/test/setup.ts`:
```typescript
import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// クリーンアップ
afterEach(() => {
  cleanup()
})
```

#### 完了条件

- ✅ アプリケーションが正しく起動する
- ✅ すべてのコンポーネントが表示される
- ✅ スタイリングが適用されている
- ✅ `npm run dev` で開発サーバーが起動する

---

### Phase 12: テストの追加

#### 目的
品質基準を満たすために、テストを追加する。

#### 作業内容

**12.1 ユーティリティ関数のテスト**

`src/shared/utils/formatters.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { formatDateTime, formatTime, formatDate, formatRelativeTime } from './formatters'

describe('formatters', () => {
  describe('formatDateTime', () => {
    it('should format timestamp correctly', () => {
      const timestamp = new Date('2026-03-28T10:30:00').getTime()
      const result = formatDateTime(timestamp)
      expect(result).toContain('2026')
      expect(result).toContain('03')
      expect(result).toContain('28')
    })
  })

  describe('formatRelativeTime', () => {
    it('should return "たった今" for recent timestamps', () => {
      const now = Date.now()
      expect(formatRelativeTime(now)).toBe('たった今')
    })

    it('should return "3分前" for 3 minutes ago', () => {
      const threeMinutesAgo = Date.now() - 3 * 60 * 1000
      expect(formatRelativeTime(threeMinutesAgo)).toBe('3分前')
    })
  })
})
```

**12.2 Service層のテスト**

`src/domains/sensor/service/SensorService.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { SensorService } from './SensorService'

describe('SensorService', () => {
  let service: SensorService

  beforeEach(() => {
    service = new SensorService()
    service.clearCache()
  })

  it('should cache data', async () => {
    const data1 = await service.getSensorData(24)
    const data2 = await service.getSensorData(24)

    // 同じインスタンスが返される（キャッシュされている）
    expect(data1).toBe(data2)
  })

  it('should clear cache', async () => {
    await service.getSensorData(24)
    service.clearCache()

    // キャッシュがクリアされていることを確認
    // （実際にはモックを使ってAPIが再度呼ばれることを確認する）
  })
})
```

**12.3 コンポーネントのテスト**

`src/shared/components/Button.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  it('should render with children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('should call onClick when clicked', () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click me</Button>)

    fireEvent.click(screen.getByText('Click me'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('should be disabled when disabled prop is true', () => {
    render(<Button disabled>Click me</Button>)
    expect(screen.getByText('Click me')).toBeDisabled()
  })

  it('should show loading text when isLoading is true', () => {
    render(<Button isLoading>Click me</Button>)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })
})
```

**12.4 テストカバレッジの確認**

```bash
npm run test:coverage
```

#### 完了条件

- ✅ 主要な関数とコンポーネントにテストがある
- ✅ テストカバレッジが80%以上
- ✅ すべてのテストが通る

---

### Phase 13: README更新とドキュメント整備

#### 目的
開発環境のセットアップ手順を文書化する。

#### 作業内容

**13.1 README.md更新**

プロジェクトルートの `README.md` にフロントエンド開発の手順を追加:

```markdown
## フロントエンド開発

### セットアップ

1. 依存関係のインストール:
\`\`\`bash
npm install
\`\`\`

2. 環境変数の設定:
\`\`\`bash
cp .env.example .env
# .envファイルを編集してAPI URLを設定
\`\`\`

3. 開発サーバーの起動:
\`\`\`bash
npm run dev
\`\`\`

### 開発モード（モックデータ使用）

APIがまだデプロイされていない場合は、モックデータで開発できます:

\`\`\`bash
# .env
VITE_USE_MOCK_DATA=true
\`\`\`

### ビルド

\`\`\`bash
npm run build
\`\`\`

### テスト

\`\`\`bash
npm run test
npm run test:coverage
\`\`\`

### リントとフォーマット

\`\`\`bash
npm run lint
npm run lint:fix
npm run format
\`\`\`

### 品質チェック

\`\`\`bash
npm run quality-check
\`\`\`
```

#### 完了条件

- ✅ README.mdが更新されている
- ✅ セットアップ手順が明確
- ✅ トラブルシューティング情報が含まれている

---

## テスト戦略

### ユニットテスト

- **対象**: ユーティリティ関数、Service層、Repository層
- **ツール**: Vitest
- **カバレッジ目標**: 85%以上

### コンポーネントテスト

- **対象**: 共有コンポーネント、ドメインUIコンポーネント
- **ツール**: Vitest + React Testing Library
- **カバレッジ目標**: 80%以上

### 統合テスト

- **対象**: ページレベルのコンポーネント（SensorDashboard, DashboardPage）
- **ツール**: Vitest + React Testing Library
- **重点**: データフェッチング、状態管理、エラーハンドリング

### E2Eテスト（Phase 2）

- **対象**: クリティカルユーザーフロー
- **ツール**: Playwright または Cypress
- **Phase 2で実装**

## 既知のリスクと制約

### 1. APIエンドポイントが未デプロイ

**リスク**: フロントエンド開発中にAPIが利用できない

**対策**:
- モックリポジトリで開発
- 環境変数で切り替え可能
- APIデプロイ後にすぐ切り替え

### 2. データポイント数が多い場合のパフォーマンス

**リスク**: 7日分のデータ（10,080ポイント）でグラフが重くなる

**対策**:
- データポイントの間引き（downsampling）実装済み
- アニメーション無効化
- 必要に応じて仮想化を追加

### 3. ブラウザ互換性

**リスク**: 古いブラウザでの動作保証

**対策**:
- モダンブラウザ（Chrome, Firefox, Safari, Edge最新版）のみサポート
- Viteのデフォルトトランスパイル設定を使用

### 4. LocalStorageの容量制限

**リスク**: LocalStorageが5MBを超える

**対策**:
- キャッシュは30秒で期限切れ
- 大量のデータは保存しない
- 必要に応じてIndexedDBに移行（Phase 2）

## 代替案の検討

### グラフライブラリ

**選択**: Recharts

**検討した代替案**:
- **Chart.js**: より軽量だが、Reactとの統合がやや面倒
- **Victory**: 高機能だが、バンドルサイズが大きい
- **Visx**: 低レベルで柔軟性が高いが、学習コストが高い

**理由**: Rechartsはシンプルで宣言的なAPI、Reactとの良好な統合、適度なバンドルサイズのバランスが良い。

### 状態管理

**選択**: React Hooks（useState, useContext）

**検討した代替案**:
- **Zustand**: グローバル状態管理が必要になったら追加
- **Redux**: オーバースペック
- **Jotai/Recoil**: 今回の規模では不要

**理由**: 初期段階では組み込みのHooksで十分。複雑化したら段階的にZustandを追加。

## 実装順序の理由

1. **設定ファイル優先**: プロジェクトの基盤を先に構築
2. **ボトムアップ**: Types → Config → Repository → Service → UI の順で依存方向に従う
3. **共有コンポーネント優先**: UIコンポーネントで再利用可能な部品を先に作成
4. **統合は最後**: すべての部品が揃ってから統合

この順序により、各フェーズが前のフェーズに依存し、段階的に機能を追加できます。

## 変更履歴

- 2026-03-28: 初期実装計画作成
