# Frontend JSON Parse Error - Research

**Status**: Completed (2026-04-05)

## 1. タスク理解

- 調査対象エラー: Unexpected token '<', "<!doctype "... is not valid JSON
- 発生文脈: フロントエンド画面で API レスポンスを response.json() したタイミング
- 成功条件:
  - フロントが fetch している URL と response.json() 呼び出し箇所を特定
  - VITE_API_BASE_URL / VITE_USE_MOCK_DATA の参照経路を特定
  - デプロイワークフローで API URL がビルド時に注入されるか確認
  - HTML が返る典型パスを特定
  - 影響範囲と再発条件を明文化

## 2. 現状分析

### 2.1 どの URL を fetch し、どこで response.json() を呼んでいるか

- src/domains/sensor/repository/SensorRepository.ts
  - fetchSensorData(hours):
    - URL組み立て: const url = `${this.baseUrl}${API_ENDPOINTS.data}?hours=${hours}` （L38）
    - fetch: fetch(url) （L39）
    - JSONパース: await response.json() （L45）
  - fetchLatestData():
    - URL組み立て: const url = `${this.baseUrl}${API_ENDPOINTS.latest}` （L61）
    - fetch: fetch(url) （L62）
    - JSONパース: await response.json() （L68）
  - healthCheck():
    - fetch(`${this.baseUrl}${API_ENDPOINTS.health}`) （L25）
    - こちらは response.json() を呼ばない（response.ok 判定のみ）

- エンドポイント定義（src/domains/sensor/config/api.ts）
  - health: '/health' （L21）
  - data: '/data' （L22）
  - latest: '/latest' （L23）

- UI からの呼び出し経路
  - src/domains/sensor/ui/pages/SensorDashboard.tsx
    - 初回表示 useEffect で sensorService.getLatestData() 実行（L29-L31, L19）
    - 定期更新 useInterval(fetchData, API_CONFIG.pollingInterval)（L34）
  - src/domains/dashboard/ui/pages/DashboardPage.tsx
    - 初回/期間変更時 sensorService.getSensorData(hours) 実行（L37-L40, L22）
    - 定期更新 useInterval(fetchData, API_CONFIG.pollingInterval)（L43）

### 2.2 VITE_API_BASE_URL と VITE_USE_MOCK_DATA の参照経路

- 型定義: src/vite-env.d.ts
  - VITE_API_BASE_URL（L4）
  - VITE_USE_MOCK_DATA（L5）

- 設定読込: src/domains/sensor/config/api.ts
  - baseUrl: import.meta.env.VITE_API_BASE_URL || '' （L6）
  - useMockData: import.meta.env.VITE_USE_MOCK_DATA === 'true' （L8）

- リポジトリ分岐: src/domains/sensor/repository/index.ts
  - API_CONFIG.useMockData ? mockSensorRepository : sensorRepository （L10）

- 実行時経路
  - sensorService が getSensorRepository() を内部保持（src/domains/sensor/service/SensorService.ts L9）
  - useMockData === true の場合は MockSensorRepository（外部 fetch しない）
  - useMockData !== true の場合は SensorRepository（外部 fetch + response.json()）

### 2.3 デプロイワークフローで API URL がビルド時に注入されるか

- 対象: .github/workflows/frontend-deploy.yml
  - ビルド手順は npm run build （L48-L49）
  - その前後で VITE_API_BASE_URL / VITE_USE_MOCK_DATA を env: や run で設定する処理は確認できない

- 事実
  - ワークフロー上で VITE_ 系の値が明示注入されていないため、CI ビルド成果物に API ベース URL が埋め込まれない可能性が高い
  - src/domains/sensor/config/api.ts のデフォルトが '' のため、未注入時は相対パス呼び出しにフォールバックする設計

## 3. HTML が返ってくる典型パス（今回のエラーとの接続）

- インフラ設定: terraform/modules/cloudfront/main.tf
  - default_root_object = "index.html" （L35）
  - custom_error_response で 404/403 を response_code = 200 + response_page_path = "/index.html" に変換（L65-L76）

- 典型シナリオ
  1. VITE_API_BASE_URL が空文字（または不正）
  2. フロントが fetch('/latest') / fetch('/data?...') を CloudFront/S3 オリジンへ送信
  3. オブジェクト不存在で 404/403
  4. CloudFront が SPA フォールバックで index.html を 200 で返却
  5. response.ok === true なので SensorRepository は通過
  6. response.json() が HTML 先頭 <!doctype ...> を JSON として解釈し失敗
  7. Unexpected token '<' が発生

## 4. 影響範囲と再発条件

### 4.1 影響範囲

- SensorRepository.fetchLatestData() を通る UI
  - src/domains/sensor/ui/pages/SensorDashboard.tsx（初回表示・定期更新・手動更新）
- SensorRepository.fetchSensorData() を通る UI
  - src/domains/dashboard/ui/pages/DashboardPage.tsx（初回表示・時間範囲変更・定期更新）
- これらは App で同時描画されるため、API 不整合時に画面全体でエラー表示が顕在化しやすい

### 4.2 再発条件

- VITE_USE_MOCK_DATA が 'true' 以外（実 API 経路を使う）
- かつ VITE_API_BASE_URL が:
  - 未注入で空文字
  - あるいは誤った URL（SPA 配信の CloudFront ドメイン等）
  - あるいは /latest /data が存在しないオリジン
- かつオリジン/配信層が 404/403 を HTML (index.html) で返す構成

## 5. ドキュメント/要件との整合観点

- docs/SECURITY.md では本番環境でビルド時に環境変数を注入する方針が記載されている（本件はその運用ギャップ）
- docs/RELIABILITY.md ではエラー率低減と再試行戦略が要求されるが、現状は HTML 誤受信を型別判定していないため、原因特定が難しい

## 6. 根本原因（仮説）

最有力仮説は以下の複合要因:

1. フロントデプロイ時に VITE_API_BASE_URL がビルドへ注入されていない
2. その結果、API_CONFIG.baseUrl が '' となり相対パス fetch が発生
3. CloudFront/S3 の SPA フォールバック（404/403 -> /index.html, 200）により HTML が返る
4. SensorRepository が Content-Type を確認せず response.json() を実行し、Unexpected token '<' で失敗

## 7. 改善方針（次段階用）

実装判断は planner フェーズに委ねる前提で、論点は以下:

1. ビルド時注入の保証
   - .github/workflows/frontend-deploy.yml の build step に VITE_API_BASE_URL / VITE_USE_MOCK_DATA の明示注入を追加
   - 値源泉は GitHub Secrets / Variables か、Terraform 出力連携かを決める

2. 起動前バリデーション
   - VITE_USE_MOCK_DATA !== 'true' なのに VITE_API_BASE_URL が空の場合、起動時に明確な設定エラーを出す

3. レスポンス型検証の追加
   - response.headers.get('content-type') を見て application/json 以外を早期失敗
   - HTML受信時は API URL 誤設定の可能性を含む診断メッセージを返す

4. 運用・監視
   - JSON parse error 発生件数を可観測化（まずはログ分類）
   - CI で VITE_API_BASE_URL 未設定時に build を fail させるガードを検討

5. テスト拡張
   - SensorRepository に HTMLレスポンス時の失敗メッセージ テストを追加
   - ワークフロー/ビルド環境変数の欠落検知テスト（または lint 的チェック）を追加

## 8. 参照した主要ファイル

- src/domains/sensor/repository/SensorRepository.ts
- src/domains/sensor/config/api.ts
- src/domains/sensor/repository/index.ts
- src/domains/sensor/service/SensorService.ts
- src/domains/sensor/ui/pages/SensorDashboard.tsx
- src/domains/dashboard/ui/pages/DashboardPage.tsx
- src/vite-env.d.ts
- .github/workflows/frontend-deploy.yml
- terraform/modules/cloudfront/main.tf
- docs/SECURITY.md
- docs/RELIABILITY.md
