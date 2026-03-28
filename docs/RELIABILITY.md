# Reliability & Performance

このドキュメントは、システムの信頼性とパフォーマンス要件を定義します。

## 信頼性目標

### 可用性

- **目標**: 99.5%（月間）
- **許容ダウンタイム**: 約3.6時間/月

### データ取得

- **成功率**: 95%以上
- **レイテンシ**: p95 < 2秒、p99 < 5秒
- **リトライ**: 最大3回（指数バックオフ）

### UI

- **エラー率**: < 1%
- **Time to Interactive**: < 3秒
- **レスポンシブ**: すべてのユーザーアクション < 100ms

## パフォーマンス要件

### フロントエンド

#### ロードパフォーマンス

```
First Contentful Paint (FCP)     < 1.5秒
Largest Contentful Paint (LCP)   < 2.5秒
Time to Interactive (TTI)        < 3秒
Cumulative Layout Shift (CLS)    < 0.1
First Input Delay (FID)          < 100ms
```

#### バンドルサイズ

```
Initial Bundle                   < 500KB (gzipped)
Total JavaScript                 < 1MB (gzipped)
Total Assets (including CSS)     < 2MB
```

#### ランタイムパフォーマンス

- **メモリ使用量**: < 100MB
- **CPUブロッキング**: タスクあたり < 50ms
- **フレームレート**: 60fps維持

### API/データ取得

#### レスポンスタイム

```
Switchbot API Call               < 1秒
データ処理                       < 100ms
キャッシュヒット                 < 10ms
```

#### 並行性

- 同時API呼び出し: 最大3件
- レート制限遵守: Switchbot API制限内

## エラーハンドリング戦略

### エラーの分類

#### 1. 一時的エラー（Transient Errors）

**例**:
- ネットワークタイムアウト
- APIレート制限
- 一時的なサーバーエラー（5xx）

**対応**:
- 自動リトライ（指数バックオフ）
- ユーザーに「再試行中」メッセージ
- 最大3回までリトライ

```typescript
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (i < maxRetries - 1) {
        await delay(Math.pow(2, i) * 1000) // 指数バックオフ
      }
    }
  }

  throw lastError!
}
```

#### 2. 永続的エラー（Permanent Errors）

**例**:
- 認証エラー（401）
- 不正なリクエスト（400）
- リソースが見つからない（404）

**対応**:
- リトライしない
- ユーザーに明確なエラーメッセージ
- 必要に応じて再設定を促す

#### 3. クライアントエラー

**例**:
- バリデーションエラー
- 型の不一致
- 予期しないデータ構造

**対応**:
- エラー境界でキャッチ
- ユーザーフレンドリーなメッセージ
- エラーログを記録（将来）

### エラーUI

```typescript
// エラー表示コンポーネント
interface ErrorMessageProps {
  error: Error
  onRetry?: () => void
}

export function ErrorMessage({ error, onRetry }: ErrorMessageProps) {
  const userMessage = getUserFriendlyMessage(error)

  return (
    <div className="bg-red-50 border border-red-200 rounded p-4">
      <p className="text-red-800">{userMessage}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 btn-secondary">
          再試行
        </button>
      )}
    </div>
  )
}
```

## キャッシング戦略

### ローカルストレージ

```typescript
interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

// 1分間キャッシュ
const CACHE_TTL = 60 * 1000

function getCached<T>(key: string): T | null {
  const entry = localStorage.getItem(key)
  if (!entry) return null

  const cached: CacheEntry<T> = JSON.parse(entry)
  if (Date.now() > cached.expiresAt) {
    localStorage.removeItem(key)
    return null
  }

  return cached.data
}

function setCache<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + CACHE_TTL,
  }
  localStorage.setItem(key, JSON.stringify(entry))
}
```

### キャッシュ無効化

- 手動更新時: 即座に無効化
- エラー時: キャッシュを保持（stale-while-revalidate）
- 期限切れ: 自動削除

## モニタリング（Phase 2）

### メトリクス

#### パフォーマンス

- ページロード時間
- API レスポンスタイム
- エラー率
- キャッシュヒット率

#### ユーザー行動

- アクティブユーザー数
- ページビュー
- 滞在時間
- 更新頻度

### アラート

- エラー率 > 5%
- レスポンスタイム p95 > 5秒
- 連続3回のAPI失敗

## フェイルセーフ

### グレースフルデグラデーション

1. **API利用不可**
   - キャッシュされたデータを表示
   - 「最終更新: X分前」を明示
   - バックグラウンドでリトライ

2. **データ不完全**
   - 利用可能なデータのみ表示
   - 欠損部分を明示
   - 部分的な機能提供

3. **ブラウザ互換性**
   - モダンブラウザを推奨
   - 基本機能は広範囲でサポート
   - ポリフィルは最小限

### オフライン対応（Phase 3）

- Service Worker でキャッシング
- オフライン時の通知
- 再接続時の自動同期

## バックアップとリカバリ

### ローカルデータ

- LocalStorage容量: 最大5MB
- 古いデータの自動削除（7日以上）
- エクスポート機能（Phase 2）

### 設定

- 設定はLocalStorageに保存
- デフォルト値へのフォールバック
- 設定のリセット機能

## パフォーマンステスト

### ツール

- Lighthouse CI
- WebPageTest
- Chrome DevTools Performance

### テストシナリオ

1. **初回ロード**
   - キャッシュなし
   - 目標: TTI < 3秒

2. **リピート訪問**
   - キャッシュあり
   - 目標: TTI < 1秒

3. **データ更新**
   - API呼び出し
   - 目標: レスポンス < 2秒

4. **大量データ**
   - 1週間分のデータ
   - 目標: レンダリング < 500ms

### 定期実行

- ビルドごと: Lighthouse CI
- 週次: 包括的なパフォーマンステスト
- リリース前: 本番環境シミュレーション

## 最適化チェックリスト

### Phase 1（MVP）

- [x] コード分割（React.lazy）
- [x] Tree shaking（Vite）
- [ ] 画像最適化
- [ ] フォント最適化
- [ ] キャッシング戦略実装

### Phase 2

- [ ] Service Worker
- [ ] プリロード/プリフェッチ
- [ ] 遅延ローディング（画像）
- [ ] WebP 画像フォーマット
- [ ] CDN 配信

### Phase 3

- [ ] HTTP/2 Server Push
- [ ] リソースヒント
- [ ] インラインクリティカルCSS
- [ ] バンドル最適化（手動チューニング）

## 変更履歴

- 2026-03-28: 初期作成
