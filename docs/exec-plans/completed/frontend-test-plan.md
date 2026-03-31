# Frontend Test Implementation Plan

**日付**: 2026-03-28
**ステータス**: Plan - Awaiting Approval
**前提**: [frontend-test-research.md](./frontend-test-research.md) のリサーチ完了

## 目標

フロントエンドコードベースに包括的なテストスイートを実装し、品質基準を満たす。

### 成功基準

- ✅ **Line Coverage**: 80%以上
- ✅ **Branch Coverage**: 75%以上
- ✅ **Function Coverage**: 85%以上
- ✅ すべてのテストがパス
- ✅ CI/CDパイプラインでテストが自動実行される
- ✅ テストが安定（flaky testなし）

## 前提条件

### ツール

- [x] Node.js 18以上
- [x] npm 9以上
- [x] Vitest設定済み

### 知識

- React Testing Libraryのベストプラクティス
- Vitestのモックシステム
- 非同期テストの書き方

## 実装ステップ

### Phase 1: テスト基盤構築

#### ステップ1.1: 依存関係のインストール

```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitest/coverage-v8
```

**完了条件**: package.jsonに以下が追加される

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

#### ステップ1.2: テストセットアップファイル作成

`src/test/setup.ts`:

```typescript
import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
} as any

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any
```

**完了条件**: setup.tsが作成され、Vitestで読み込まれる

#### ステップ1.3: テスト共通ユーティリティ作成

`src/test/utils/renderWithProviders.tsx`:

```typescript
import { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'

/**
 * Custom render function with providers
 * 将来的にContext Providerが追加された場合はここでラップ
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { ...options })
}

export * from '@testing-library/react'
```

`src/test/utils/mockData.ts`:

```typescript
import type { SensorData, SensorDataResponse } from '@domains/sensor/types'

export const mockSensorData: SensorData = {
  deviceId: 'test-device-123',
  timestamp: 1700000000000,
  temperature: 25.5,
  humidity: 60.0,
  co2: 800,
}

export const mockSensorDataResponse: SensorDataResponse = {
  data: [
    mockSensorData,
    {
      ...mockSensorData,
      timestamp: 1700000060000,
      temperature: 25.6,
    },
    {
      ...mockSensorData,
      timestamp: 1700000120000,
      temperature: 25.7,
    },
  ],
  count: 3,
}
```

**完了条件**: テストユーティリティが作成される

### Phase 2: 高優先度テスト（カバレッジ目標90%）

#### ステップ2.1: Utils層のテスト

**対象ファイル**:
- `src/shared/utils/formatters.ts`
- `src/shared/utils/numbers.ts`

**テスト内容** (`formatters.test.ts`):

```typescript
import { describe, it, expect } from 'vitest'
import { formatDateTime, formatTime, formatDate, formatRelativeTime } from './formatters'

describe('formatters', () => {
  describe('formatDateTime', () => {
    it('should format timestamp as Japanese datetime', () => {
      const timestamp = new Date('2026-03-28T10:30:00').getTime()
      const result = formatDateTime(timestamp)
      expect(result).toMatch(/2026\/03\/28/)
      expect(result).toMatch(/10:30/)
    })
  })

  describe('formatTime', () => {
    it('should format timestamp as time only', () => {
      const timestamp = new Date('2026-03-28T10:30:00').getTime()
      const result = formatTime(timestamp)
      expect(result).toBe('10:30')
    })
  })

  describe('formatDate', () => {
    it('should format timestamp as date only', () => {
      const timestamp = new Date('2026-03-28T10:30:00').getTime()
      const result = formatDate(timestamp)
      expect(result).toBe('2026/03/28')
    })
  })

  describe('formatRelativeTime', () => {
    it('should return "たった今" for recent timestamps', () => {
      const timestamp = Date.now() - 30000 // 30秒前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('たった今')
    })

    it('should return minutes for timestamps within an hour', () => {
      const timestamp = Date.now() - 5 * 60 * 1000 // 5分前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('5分前')
    })

    it('should return hours for timestamps within a day', () => {
      const timestamp = Date.now() - 3 * 60 * 60 * 1000 // 3時間前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('3時間前')
    })

    it('should return days for older timestamps', () => {
      const timestamp = Date.now() - 2 * 24 * 60 * 60 * 1000 // 2日前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('2日前')
    })
  })
})
```

**完了条件**: Utils層のテストが完了し、カバレッジ95%以上

#### ステップ2.2: Service層のテスト

**対象ファイル**:
- `src/domains/sensor/service/SensorService.ts`
- `src/domains/dashboard/service/ChartDataService.ts`

**テスト内容** (`SensorService.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SensorService } from './SensorService'
import type { SensorRepository } from '../repository'
import { mockSensorData, mockSensorDataResponse } from '@/test/utils/mockData'

// Repository をモック
vi.mock('../repository', () => ({
  getSensorRepository: vi.fn(() => mockRepository),
}))

const mockRepository: SensorRepository = {
  fetchSensorData: vi.fn(),
  fetchLatestData: vi.fn(),
  healthCheck: vi.fn(),
}

describe('SensorService', () => {
  let service: SensorService

  beforeEach(() => {
    service = new SensorService()
    vi.clearAllMocks()
  })

  afterEach(() => {
    service.clearCache()
  })

  describe('getSensorData', () => {
    it('should fetch data from repository', async () => {
      vi.mocked(mockRepository.fetchSensorData).mockResolvedValue(mockSensorDataResponse)

      const result = await service.getSensorData(24)

      expect(mockRepository.fetchSensorData).toHaveBeenCalledWith(24)
      expect(result).toEqual(mockSensorDataResponse)
    })

    it('should cache data for 30 seconds', async () => {
      vi.mocked(mockRepository.fetchSensorData).mockResolvedValue(mockSensorDataResponse)

      // 初回フェッチ
      await service.getSensorData(24)
      // 2回目（キャッシュから返される）
      await service.getSensorData(24)

      // repository は1回だけ呼ばれる
      expect(mockRepository.fetchSensorData).toHaveBeenCalledTimes(1)
    })

    it('should refetch after cache expires', async () => {
      vi.useFakeTimers()
      vi.mocked(mockRepository.fetchSensorData).mockResolvedValue(mockSensorDataResponse)

      await service.getSensorData(24)

      // 30秒以上経過
      vi.advanceTimersByTime(31000)

      await service.getSensorData(24)

      // repository は2回呼ばれる
      expect(mockRepository.fetchSensorData).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })
  })

  describe('getLatestData', () => {
    it('should fetch latest data from repository', async () => {
      vi.mocked(mockRepository.fetchLatestData).mockResolvedValue(mockSensorData)

      const result = await service.getLatestData()

      expect(mockRepository.fetchLatestData).toHaveBeenCalled()
      expect(result).toEqual(mockSensorData)
    })
  })

  describe('clearCache', () => {
    it('should clear cached data', async () => {
      vi.mocked(mockRepository.fetchSensorData).mockResolvedValue(mockSensorDataResponse)

      await service.getSensorData(24)
      service.clearCache()
      await service.getSensorData(24)

      // キャッシュクリア後は再度fetchされる
      expect(mockRepository.fetchSensorData).toHaveBeenCalledTimes(2)
    })
  })
})
```

**完了条件**: Service層のテストが完了し、カバレッジ90%以上

#### ステップ2.3: Repository層のテスト

**対象ファイル**:
- `src/domains/sensor/repository/SensorRepository.ts`
- `src/domains/sensor/repository/schemas.ts`

**テスト内容** (`SensorRepository.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SensorRepository } from './SensorRepository'
import { mockSensorDataResponse } from '@/test/utils/mockData'

describe('SensorRepository', () => {
  let repository: SensorRepository
  let mockFetch: any

  beforeEach(() => {
    // Import meta env をモック
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
    vi.stubEnv('VITE_USE_MOCK_DATA', 'false')

    // fetchをモック
    mockFetch = vi.fn()
    global.fetch = mockFetch

    repository = new SensorRepository()
  })

  describe('fetchSensorData', () => {
    it('should fetch data from API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockSensorDataResponse,
      })

      const result = await repository.fetchSensorData(24)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/data?hours=24'
      )
      expect(result).toEqual(mockSensorDataResponse)
    })

    it('should throw error when API returns error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
      })

      await expect(repository.fetchSensorData(24)).rejects.toThrow()
    })

    it('should validate response with Zod schema', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ invalid: 'data' }),
      })

      await expect(repository.fetchSensorData(24)).rejects.toThrow()
    })
  })

  describe('healthCheck', () => {
    it('should return true when API is healthy', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      })

      const result = await repository.healthCheck()

      expect(result).toBe(true)
    })

    it('should return false when API is unhealthy', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const result = await repository.healthCheck()

      expect(result).toBe(false)
    })
  })
})
```

**完了条件**: Repository層のテストが完了し、カバレッジ90%以上

#### ステップ2.4: Hooks層のテスト

**対象ファイル**:
- `src/shared/hooks/useFetch.ts`
- `src/shared/hooks/useInterval.ts`
- `src/shared/hooks/useLocalStorage.ts`

**テスト内容** (`useFetch.test.ts`):

```typescript
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFetch } from './useFetch'

describe('useFetch', () => {
  it('should start with idle status', () => {
    const fetchFn = vi.fn()
    const { result } = renderHook(() => useFetch(fetchFn, []))

    expect(result.current.status).toBe('idle')
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('should fetch data successfully', async () => {
    const mockData = { value: 'test' }
    const fetchFn = vi.fn().mockResolvedValue(mockData)

    const { result } = renderHook(() => useFetch(fetchFn))

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })

    expect(result.current.data).toEqual(mockData)
    expect(result.current.error).toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('should handle fetch errors', async () => {
    const error = new Error('Fetch failed')
    const fetchFn = vi.fn().mockRejectedValue(error)

    const { result } = renderHook(() => useFetch(fetchFn))

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toEqual(error)
  })

  it('should refetch when refetch is called', async () => {
    const mockData = { value: 'test' }
    const fetchFn = vi.fn().mockResolvedValue(mockData)

    const { result } = renderHook(() => useFetch(fetchFn))

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })

    result.current.refetch()

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(2)
    })
  })
})
```

**完了条件**: Hooks層のテストが完了し、カバレッジ85%以上

### Phase 3: 中優先度テスト（カバレッジ目標75%）

#### ステップ3.1: Shared Components のテスト

**対象ファイル**:
- `src/shared/components/Card.tsx`
- `src/shared/components/Button.tsx`
- `src/shared/components/Loading.tsx`
- `src/shared/components/ErrorMessage.tsx`
- `src/shared/components/EmptyState.tsx`

**テスト内容** (`Card.test.tsx`):

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils/renderWithProviders'
import { Card } from './Card'

describe('Card', () => {
  it('renders children correctly', () => {
    render(<Card>Test Content</Card>)
    expect(screen.getByText('Test Content')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<Card className="custom-class">Content</Card>)
    expect(container.firstChild).toHaveClass('custom-class')
  })
})
```

**完了条件**: 全Shared Componentsのテストが完了

#### ステップ3.2: Domain Components のテスト

**対象ファイル**:
- `src/domains/sensor/ui/components/MetricCard.tsx`
- `src/domains/dashboard/ui/components/TimeRangeSelector.tsx`
- `src/domains/dashboard/ui/components/SensorChart.tsx`（Rechartsモック）

**テスト内容** (`MetricCard.test.tsx`):

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils/renderWithProviders'
import { MetricCard } from './MetricCard'

describe('MetricCard', () => {
  it('renders label and value correctly', () => {
    render(
      <MetricCard
        label="温度"
        value={25.5}
        unit="°C"
        color="#ff0000"
      />
    )

    expect(screen.getByText('温度')).toBeInTheDocument()
    expect(screen.getByText('25.5')).toBeInTheDocument()
    expect(screen.getByText('°C')).toBeInTheDocument()
  })

  it('formats value to 1 decimal place', () => {
    render(
      <MetricCard
        label="湿度"
        value={60.123}
        unit="%"
        color="#0000ff"
      />
    )

    expect(screen.getByText('60.1')).toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    const icon = <span data-testid="test-icon">Icon</span>

    render(
      <MetricCard
        label="CO2"
        value={800}
        unit="ppm"
        color="#00ff00"
        icon={icon}
      />
    )

    expect(screen.getByTestId('test-icon')).toBeInTheDocument()
  })
})
```

**Rechartsモック** (`src/test/mocks/recharts.ts`):

```typescript
import { vi } from 'vitest'

vi.mock('recharts', () => ({
  LineChart: ({ children, ...props }: any) => (
    <div data-testid="line-chart" {...props}>
      {children}
    </div>
  ),
  Line: ({ dataKey }: any) => <div data-testid={`line-${dataKey}`} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}))
```

**完了条件**: 全Domain Componentsのテストが完了

### Phase 4: カバレッジ改善とCI/CD統合

#### ステップ4.1: カバレッジレポート確認

```bash
npm run test:coverage
```

カバレッジレポートを確認し、目標に達していない箇所を特定。

**完了条件**: カバレッジレポートが生成される

#### ステップ4.2: 不足箇所の特定と追加テスト

カバレッジが低い箇所（< 80%）を特定し、追加テストを作成。

**対象**: カバレッジレポートで特定された箇所

**完了条件**: 全体カバレッジが目標を達成

#### ステップ4.3: CI/CD統合（GitHub Actions）

`.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type check
        run: npm run type-check

      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage/coverage-final.json
          flags: frontend
          name: frontend-coverage

      - name: Check coverage threshold
        run: |
          npm run test:coverage -- --reporter=json --reporter=text
          # カバレッジが80%未満の場合は失敗
```

**完了条件**: GitHub Actionsでテストとカバレッジチェックが自動実行される

## 成功基準の検証

### 自動検証（CI/CD）

- [ ] `npm run lint` がパス
- [ ] `npm run type-check` がパス
- [ ] `npm run test` がパス（すべてのテスト）
- [ ] カバレッジが目標達成（80% line, 75% branch, 85% function）

### 手動検証

- [ ] テストが安定（10回連続実行して全てパス）
- [ ] テストが高速（全テスト < 30秒）
- [ ] カバレッジレポートが正確

## タイムライン

| Phase | タスク | 推定時間 |
|-------|--------|----------|
| Phase 1 | テスト基盤構築 | 2-3時間 |
| Phase 2 | 高優先度テスト（12ファイル） | 6-8時間 |
| Phase 3 | 中優先度テスト（14ファイル） | 5-7時間 |
| Phase 4 | カバレッジ改善・CI/CD | 2-3時間 |

**合計**: 15-21時間（2-3日）

## リスクと緩和策

### リスク1: Recharts モックの複雑さ

**影響**: 高
**確率**: 中

**緩和策**:
- 最小限のモックで済むようにテスト設計
- データが正しく渡されているかのみ確認
- ビジュアルテストは別途実施（Storybook）

### リスク2: 非同期テストの不安定さ

**影響**: 中
**確率**: 中

**緩和策**:
- `waitFor` を適切に使用
- タイムアウトを長めに設定（10秒）
- CI/CDで複数回実行して安定性確認

### リスク3: カバレッジ目標未達

**影響**: 中
**確率**: 低

**緩和策**:
- 優先度の高いコードから順にテスト
- カバレッジレポートを定期的に確認
- 段階的にカバレッジを改善

## 未解決の質問

### 質問1: E2Eテストの範囲は？

**現状**: E2EテストはPhase 2で実装予定（product-specsより）

**対応**: 今回はUnit/Integrationテストのみ実施

### 質問2: Storybook導入は？

**現状**: Storybookは未導入

**対応**: Phase 3以降で検討（今回は対象外）

### 質問3: テストデータの管理方法は？

**現状**: `src/test/utils/mockData.ts` で管理

**対応**: 必要に応じてファクトリ関数を追加

## 次のステップ

1. **レビュー**: この計画をレビューし、フィードバックをもらう
2. **承認**: 計画が承認されたら実装開始
3. **実装**: Phase 1から順番に実装
4. **検証**: 各Phaseで成功基準を確認
5. **ドキュメント**: 完了後にcompletedフォルダに移動

---

**前**: [frontend-test-research.md](./frontend-test-research.md)
**次**: 実装開始（承認後）
