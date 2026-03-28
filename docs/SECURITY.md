# Security Guidelines

このドキュメントは、セキュリティ要件とベストプラクティスを定義します。

## セキュリティ原則

### 1. 最小権限の原則

- 必要最小限のAPIスコープのみ要求
- 認証情報は環境変数のみ
- クライアントサイドに機密情報を保存しない

### 2. 多層防御

- 入力検証（クライアント＋サーバー）
- 出力エスケープ
- エラーメッセージでの情報漏洩防止

### 3. セキュアバイデフォルト

- HTTPS必須
- 安全なデフォルト設定
- セキュリティヘッダー

## 認証情報の管理

### 環境変数

**必須**: すべてのAPIキーとシークレットは環境変数で管理

```bash
# .env
VITE_SWITCHBOT_API_TOKEN=your_token_here
VITE_SWITCHBOT_SECRET=your_secret_here
```

```typescript
// ✅ Good
const apiToken = import.meta.env.VITE_SWITCHBOT_API_TOKEN

// ❌ Bad: ハードコード禁止
const apiToken = "1234567890abcdef"
```

### .env ファイルの管理

```gitignore
# .gitignore
.env
.env.local
.env.*.local
```

```bash
# .env.example（リポジトリにコミット）
VITE_SWITCHBOT_API_TOKEN=your_token_here
VITE_SWITCHBOT_SECRET=your_secret_here
```

### 開発環境

1. `.env.example` をコピー
2. `.env` にリネーム
3. 実際の値を設定
4. **絶対にコミットしない**

### 本番環境（Phase 2）

- ホスティングサービスの環境変数設定を使用
- ビルド時に環境変数を注入
- シークレット管理サービス（将来）

## 入力検証

### すべての外部データを検証

```typescript
import { z } from 'zod'

// APIレスポンススキーマ
const SensorDataSchema = z.object({
  temperature: z.number().min(-50).max(100),
  humidity: z.number().min(0).max(100),
  co2: z.number().min(0).max(10000),
  timestamp: z.string().datetime(),
})

// バリデーション
function validateSensorData(data: unknown): SensorData {
  try {
    return SensorDataSchema.parse(data)
  } catch (error) {
    throw new ValidationError('Invalid sensor data format')
  }
}
```

### ユーザー入力

```typescript
// ユーザー入力も検証
const UserSettingsSchema = z.object({
  refreshInterval: z.number().min(60).max(3600), // 1分〜1時間
  temperatureUnit: z.enum(['celsius', 'fahrenheit']),
  theme: z.enum(['light', 'dark']),
})
```

## XSS対策

### React のデフォルト保護

React は自動的にエスケープしますが、以下に注意：

```typescript
// ✅ Safe: 自動エスケープ
<div>{userInput}</div>

// ⚠️ Dangerous: 使用しない
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// ✅ Safe: サニタイズ後のみ使用
import DOMPurify from 'dompurify'
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
```

### URL

```typescript
// ✅ Safe: URL検証
function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

// 外部リンク
<a
  href={isValidUrl(url) ? url : '#'}
  target="_blank"
  rel="noopener noreferrer"
>
  Link
</a>
```

## CSRF対策

### 現在のフェーズ（クライアントサイドのみ）

- 読み取り専用API使用
- 状態変更なし
- CSRF リスク低

### Phase 2（サーバーサイド追加時）

- CSRF トークン
- SameSite Cookie属性
- Referer/Origin ヘッダー検証

## 依存関係の管理

### 脆弱性スキャン

```bash
# 定期的に実行
npm audit
npm audit fix
```

### 自動更新

```json
// package.json
{
  "scripts": {
    "audit": "npm audit",
    "audit:fix": "npm audit fix"
  }
}
```

### Dependabot（GitHub）

- 自動PRで依存関係を更新
- セキュリティアラート
- 定期的なバージョンアップ

## エラーメッセージ

### 情報漏洩を防ぐ

```typescript
// ❌ Bad: 内部情報を露出
catch (error) {
  alert(`Database error: ${error.message}`)
  console.log('Stack:', error.stack)
}

// ✅ Good: ユーザーフレンドリーなメッセージ
catch (error) {
  // 開発環境でのみログ
  if (import.meta.env.DEV) {
    console.error('Error details:', error)
  }

  // ユーザーには一般的なメッセージ
  alert('データの取得中にエラーが発生しました。')

  // エラー記録サービスに送信（将来）
  logError(error)
}
```

## LocalStorage セキュリティ

### 保存してはいけないもの

- ❌ APIキー/トークン
- ❌ パスワード
- ❌ 個人識別情報（PII）

### 保存して良いもの

- ✅ ユーザー設定（テーマ、言語）
- ✅ キャッシュされたセンサーデータ（期限付き）
- ✅ UI状態

### データの暗号化（Phase 2）

```typescript
// 機密データを保存する場合（将来）
import { encrypt, decrypt } from './crypto'

function saveSecure(key: string, data: any) {
  const encrypted = encrypt(JSON.stringify(data))
  localStorage.setItem(key, encrypted)
}

function loadSecure(key: string): any {
  const encrypted = localStorage.getItem(key)
  if (!encrypted) return null

  const decrypted = decrypt(encrypted)
  return JSON.parse(decrypted)
}
```

## HTTPSの強制

### 開発環境

```javascript
// vite.config.ts
export default {
  server: {
    https: true, // Phase 2で有効化
  }
}
```

### 本番環境

- ホスティングサービスでHTTPS有効化
- HTTP -> HTTPS リダイレクト
- HSTSヘッダー

## セキュリティヘッダー

### Phase 2で実装

```html
<!-- index.html -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';">
<meta http-equiv="X-Content-Type-Options" content="nosniff">
<meta http-equiv="X-Frame-Options" content="DENY">
<meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">
```

## API通信

### リクエスト

```typescript
async function callSwitchbotAPI(endpoint: string) {
  const token = import.meta.env.VITE_SWITCHBOT_API_TOKEN

  // ✅ Authorization ヘッダーで送信
  const response = await fetch(
    `https://api.switch-bot.com/v1.1/${endpoint}`,
    {
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
      },
    }
  )

  // ステータスコード確認
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText)
  }

  return response.json()
}
```

### レート制限遵守

```typescript
class RateLimiter {
  private lastCall = 0
  private minInterval = 1000 // 1秒

  async throttle<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now()
    const timeSinceLastCall = now - this.lastCall

    if (timeSinceLastCall < this.minInterval) {
      await delay(this.minInterval - timeSinceLastCall)
    }

    this.lastCall = Date.now()
    return fn()
  }
}
```

## セキュアコーディングチェックリスト

### すべてのPRで確認

- [ ] APIキーがハードコードされていない
- [ ] ユーザー入力を検証している
- [ ] 外部データをZodで検証している
- [ ] エラーメッセージに機密情報がない
- [ ] 外部リンクに `rel="noopener noreferrer"`
- [ ] HTTPS使用
- [ ] 依存関係に既知の脆弱性がない

## 脅威モデル

### Phase 1の脅威

1. **APIキー漏洩**
   - リスク: 高
   - 対策: 環境変数、.gitignore

2. **XSS**
   - リスク: 低（Reactの自動保護）
   - 対策: dangerouslySetInnerHTML禁止

3. **データ改ざん**
   - リスク: 低（読み取り専用）
   - 対策: バリデーション

4. **DoS**
   - リスク: 中（レート制限違反）
   - 対策: クライアントサイドのレート制限

### Phase 2以降の脅威

- 認証/認可
- セッション管理
- CSRF
- SQLインジェクション（データベース追加時）

## インシデント対応

### 問題発見時

1. **即座に停止** - アプリを無効化
2. **影響範囲の特定** - 何が漏洩したか
3. **修正** - 脆弱性を修正
4. **検証** - 修正を確認
5. **再デプロイ** - 安全な状態に戻す
6. **事後分析** - 再発防止

### 連絡先

- GitHub Issues: セキュリティラベル
- Email: （設定予定）

## 定期的なセキュリティレビュー

### 月次

- [ ] `npm audit` 実行
- [ ] 依存関係の更新
- [ ] .env.example の更新確認

### 四半期

- [ ] 脅威モデルの見直し
- [ ] セキュリティチェックリストの更新
- [ ] ペネトレーションテスト（Phase 2+）

## 変更履歴

- 2026-03-28: 初期作成
