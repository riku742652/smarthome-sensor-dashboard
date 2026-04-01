# Lambda 実装リサーチ

**タスク**: Smarthome センサーダッシュボード用の 2 つの Lambda 関数を実装する:
1. **Poller Lambda** - Switchbot API からデータを取得し DynamoDB に保存
2. **API Lambda** - FastAPI エンドポイントでフロントエンドにセンサーデータを提供

**調査日**: 2026-03-29
**ステータス**: 調査完了

---

## 1. タスク概要

### 目的

以下を満たす Lambda 関数を実装する:
- **Poller**: EventBridge スケジュールで 1 分ごとに Switchbot API をポーリングし、30 日 TTL 付きでセンサーデータを DynamoDB に保存
- **API**: フロントエンドがセンサーデータを照会するための REST エンドポイントを提供（ヘルスチェック、柔軟な時間範囲クエリ対応）

### 成功基準

- 両 Lambda 関数が AWS にデプロイされて動作している
- Poller が 1 分ごとに Switchbot API から正常に取得し DynamoDB に保存している
- API Lambda が動作するエンドポイントを公開している: `/`、`/health`、`/data`、`/latest`
- フロントエンドが API エンドポイントを呼び出して有効なデータを受信できる
- すべてのインフラが Terraform/Terragrunt で定義されている
- エラーハンドリングが堅牢である（バリデーション、タイムアウト、リトライ）
- コードがプロジェクトのパターンに従っている（型安全性、バリデーション、エラーハンドリング）

---

## 2. 現状分析

### 既存コード（実装済み）

#### Poller Lambda
- **ファイル**: `lambda/poller/lambda_function.py`
- **ステータス**: スケルトン実装済み
- **主要関数**:
  - `lambda_handler()` - EventBridge でトリガーされるメインエントリーポイント
  - `fetch_switchbot_data()` - HMAC-SHA256 認証で Switchbot API を呼び出す
  - `save_to_dynamodb()` - deviceId、timestamp、temperature、humidity、co2、expiresAt を持つアイテムを保存
- **依存関係**: boto3、requests
- **環境変数**: SWITCHBOT_TOKEN、SWITCHBOT_SECRET、DEVICE_ID、TABLE_NAME

#### API Lambda（FastAPI）
- **ファイル**: `lambda/api/main.py`
- **ステータス**: スケルトン実装済み
- **エンドポイント**:
  - `GET /` - ヘルスチェック（`HealthCheckResponse` を返す）
  - `GET /health` - ヘルスチェックの別名
  - `GET /data?hours=24` - 時間範囲でセンサーデータを照会（1〜168 時間）
  - `GET /latest` - 最新のセンサーデータを取得
  - `GET /docs` - FastAPI 自動 OpenAPI ドキュメント
- **機能**:
  - 全オリジンに対して CORS 有効
  - Decimal から float への変換（DynamoDB は Decimal を返す）
  - バリデーション用 Pydantic モデル
  - HTTPException によるエラーハンドリング
- **依存関係**: fastapi、mangum、boto3、uvicorn、pydantic
- **環境変数**: TABLE_NAME、DEVICE_ID

#### Pydantic モデル
- **ファイル**: `lambda/api/models/sensor.py`
- **モデル**:
  - `SensorData` - 個別センサー読み取り値
  - `SensorDataResponse` - 件数付きリストレスポンス
  - `HealthCheckResponse` - ヘルスチェックレスポンス
- **バリデーション**: フィールド説明、型ヒント、Decimal 用カスタムシリアライザー

#### Docker 設定
- **ファイル**: `lambda/api/Dockerfile`
- **ベース**: `public.ecr.aws/lambda/python:3.11`
- **Lambda Web Adapter**: v0.7.1 を使用して FastAPI を Lambda に適合
- **ポート**: 8000
- **起動コマンド**: `python -m uvicorn main:app --host 0.0.0.0 --port 8000`

### Terraform インフラ

#### DynamoDB モジュール
- **ファイル**: `terraform/modules/dynamodb/main.tf`
- **テーブルスキーマ**:
  - ハッシュキー: `deviceId`（文字列）
  - レンジキー: `timestamp`（数値、ミリ秒）
  - TTL 有効（`expiresAt` 属性、デフォルト 30 日）
  - 保存時暗号化有効
  - ポイントインタイムリカバリ有効
  - 課金: PAY_PER_REQUEST（オンデマンド）
- **出力**: table_name、table_arn、table_id

#### Lambda モジュール（Zip ベース）
- **ファイル**: `terraform/modules/lambda/main.tf`
- **機能**:
  - ローカル source_dir から関数を作成（自動 zip 化）
  - AWSLambdaBasicExecutionRole（CloudWatch Logs）付き IAM ロール
  - 指定アクション（PutItem、GetItem、Query、Scan）用オプション DynamoDB ポリシー
  - EventBridge スケジュールトリガー（オプション、schedule_expression 経由）
  - 設定可能: runtime、handler、timeout、memory_size、environment_variables
- **出力**: function_name、function_arn、function_invoke_arn、role_arn

#### Lambda コンテナモジュール（ECR ベース）
- **ファイル**: `terraform/modules/lambda-container/main.tf`
- **機能**:
  - zip の代わりに ECR image_uri を使用
  - Zip モジュールと同じ IAM セットアップ
  - DynamoDB ポリシーは読み取り操作のみに制限: GetItem、Query、Scan（PutItem なし）
  - Lambda Function URL:
    - NONE 認可（公開、認証不要）
    - 全オリジンに対して CORS 有効
  - 設定可能: timeout（デフォルト 30s）、memory_size（デフォルト 512MB）
- **出力**: function_name、function_arn、function_invoke_arn、role_arn

#### Terragrunt 設定

**Poller 設定** (`terraform/environments/prod/lambda-poller/terragrunt.hcl`):
- 依存関係: DynamoDB の出力
- モジュール: `modules/lambda`（zip ベース）
- 関数名: `poller`
- ハンドラー: `lambda_function.lambda_handler`
- ランタイム: `python3.11`
- ソース: `lambda/poller`
- タイムアウト: 30s
- メモリ: 128MB
- スケジュール: `rate(1 minute)`（EventBridge）
- 環境変数:
  - TABLE_NAME: DynamoDB 出力から
  - DEVICE_ID: 環境変数（SWITCHBOT_DEVICE_ID）から
  - SWITCHBOT_TOKEN: 環境変数から
  - SWITCHBOT_SECRET: 環境変数から
- DynamoDB 権限: フル（PutItem、GetItem、Query、Scan）

**API 設定** (`terraform/environments/prod/lambda-api/terragrunt.hcl`):
- 依存関係: DynamoDB の出力
- モジュール: `modules/lambda-container`（ECR ベース）
- 関数名: `api`
- イメージ URI: `${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest`
- タイムアウト: 30s
- メモリ: 512MB
- 環境変数:
  - TABLE_NAME: DynamoDB 出力から
  - DEVICE_ID: 環境変数（SWITCHBOT_DEVICE_ID）から
- DynamoDB 権限: 読み取り専用（GetItem、Query、Scan）
- 注意: Terraform apply 前に ECR イメージの手動ビルド・プッシュが必要

### フロントエンド連携

#### API の期待値
- **ファイル**: `src/domains/sensor/config/api.ts`
- ベース URL: VITE_API_BASE_URL 環境変数から
- 期待されるエンドポイント:
  - `/health` - ヘルスチェック
  - `/data?hours={1-168}` - センサーデータリスト
  - `/latest` - 最新の 1 件
- **モックデータオプション**: VITE_USE_MOCK_DATA='true'

#### フロントエンド型定義
- **ファイル**: `src/domains/sensor/types/SensorData.ts`
- インターフェース `SensorData`:
  ```typescript
  {
    deviceId: string
    timestamp: number  // Unix ミリ秒
    temperature: number
    humidity: number
    co2: number
  }
  ```
- レスポンスモデル: `{ data: SensorData[], count: number }`

#### フロントエンドバリデーション
- **ファイル**: `src/domains/sensor/repository/schemas.ts`
- Zod によるランタイムバリデーション:
  - temperature: -50〜100°C
  - humidity: 0〜100%
  - co2: 0〜10000 ppm
  - timestamp: 正の整数
- 個別アイテムと配列レスポンスの両方をバリデーション

#### フロントエンドリポジトリ
- **ファイル**: `src/domains/sensor/repository/SensorRepository.ts`
- メソッド:
  - `healthCheck()` - Boolean レスポンス
  - `fetchSensorData(hours: number)` - SensorDataResponse を返す
  - `fetchLatestData()` - SensorData を返す
- エラーハンドリング: fetch/parse エラーを ApiError 型に変換
- Zod バリデーション実装済み

### DynamoDB データストレージ

#### アイテム構造（Poller から）
```python
{
    'deviceId': string,
    'timestamp': int,       # ミリ秒
    'temperature': Decimal,
    'humidity': Decimal,
    'co2': int,
    'expiresAt': int        # Unix 秒（TTL 用）
}
```

#### クエリパターン（API から）
- 主クエリ: `deviceId = :deviceId AND timestamp >= :startTime`
- /data は timestamp 昇順（古い順）でソート
- /latest は timestamp 降順（新しい順）でソート
- /latest エンドポイントは Limit 1

### Switchbot API 連携

#### 認証
- 方式: HMAC-SHA256
- 必要なヘッダー:
  - `Authorization`: トークン
  - `t`: タイムスタンプ（ミリ秒）
  - `sign`: Base64 エンコードの HMAC-SHA256
  - `nonce`: UUID
- 署名対象文字列: `{token}{timestamp}{nonce}`

#### エンドポイント
- URL: `https://api.switch-bot.com/v1.1/devices/{device_id}/status`
- レスポンス形式:
  ```json
  {
    "statusCode": 100,
    "body": {
      "temperature": float,
      "humidity": float,
      "CO2": int
    }
  }
  ```
- エラー: statusCode != 100 は失敗を示す

#### 対応デバイス種別
- 温湿度・CO2 計測器
- レスポンスに temperature、humidity、CO2 が含まれる

---

## 3. 技術的コンテキスト

### 依存関係

#### Poller Lambda
```
boto3>=1.34.0      - AWS SDK
requests>=2.31.0   - Switchbot API 用 HTTP クライアント
```

#### API Lambda
```
fastapi>=0.104.0           - REST API フレームワーク
mangum>=0.17.0            - ASGI->Lambda アダプター
boto3>=1.34.0             - AWS SDK
uvicorn>=0.24.0           - ASGI サーバー
pydantic>=2.0.0           - データバリデーション
```

### データフロー

```
┌──────────────────┐
│  EventBridge     │
│  (1 分レート)    │
└────────┬─────────┘
         │ トリガー
         ↓
┌──────────────────────────────┐
│  Poller Lambda               │
│  lambda/poller/              │
│  lambda_function.py          │
└────────┬─────────────────────┘
         │
         ├─→ Switchbot API
         │   (HMAC-SHA256 認証)
         │
         ├─→ DynamoDB
         │   Put Item
         │   (deviceId, timestamp,
         │    temperature, humidity,
         │    co2, expiresAt)
         │
┌────────▼─────────────────────┐
│  DynamoDB テーブル            │
│  smarthome-sensor-           │
│  prod-sensor-data            │
│  ├─ deviceId (PK)            │
│  └─ timestamp (SK)           │
│  ├─ temperature (Decimal)    │
│  ├─ humidity (Decimal)       │
│  ├─ co2 (Number)             │
│  └─ expiresAt (TTL)          │
└──────────┬────────────────────┘
           │
┌──────────▼─────────────────────┐
│  API Lambda                    │
│  lambda/api/                   │
│  main.py (FastAPI)            │
│  ├─ GET / → ヘルスチェック     │
│  ├─ GET /health → ヘルスチェック│
│  ├─ GET /data → 範囲クエリ    │
│  ├─ GET /latest → 最新取得    │
│  └─ GET /docs → FastAPI docs  │
└──────────┬─────────────────────┘
           │ Lambda Function URL
           ├─→ CORS 有効
           ├─→ 公開（認証なし）
           │
┌──────────▼─────────────────────┐
│  フロントエンド（React）        │
│  src/domains/sensor/           │
│  SensorRepository              │
└────────────────────────────────┘
```

### API コントラクト

#### リクエスト
- クエリパラメータ: `hours`（1〜168）
- 認証不要
- Content-Type: application/json（GET では暗黙的）

#### レスポンス（/data エンドポイント）
```json
{
  "data": [
    {
      "deviceId": "device-123",
      "timestamp": 1706745600000,
      "temperature": 22.5,
      "humidity": 45.0,
      "co2": 800
    }
  ],
  "count": 24
}
```

#### レスポンス（/latest エンドポイント）
```json
{
  "deviceId": "device-123",
  "timestamp": 1706745600000,
  "temperature": 22.5,
  "humidity": 45.0,
  "co2": 800
}
```

#### エラーレスポンス
```json
{
  "detail": "データ取得エラー: ..."
}
```

---

## 4. 制約と考慮事項

### パフォーマンス

#### Lambda 設定
- **Poller**: 128MB メモリ（1 分間隔の実行、数秒で完了）
- **API**: 512MB メモリ（同期処理、可変データサイズに対して 30s タイムアウト）
- DynamoDB: オンデマンド料金（使用量に応じて自動スケール）

#### データ考慮事項
- Poller は 1 分ごとに実行 → デバイスあたり約 1440 アイテム/日
- クエリパターン: timestamp の範囲クエリ（DynamoDB スキーマで十分サポート）
- フロントエンドは効率的な取得を期待: レスポンスタイム 2 秒以内

### セキュリティ

#### Switchbot クレデンシャル
- **保存**: 環境変数のみ（Terragrunt で管理）
- **HMAC-SHA256**: API の真正性を保証
- **漏洩リスク**: Lambda 環境変数のクレデンシャル（AWS の標準的な手法）

#### DynamoDB アクセス
- **Poller IAM ロール**: フル DynamoDB アクセス（PutItem、GetItem、Query、Scan）
- **API IAM ロール**: 読み取り専用（GetItem、Query、Scan - PutItem/DeleteItem なし）
- **暗号化**: DynamoDB はデフォルトで保存時暗号化

#### API セキュリティ
- **認可**: なし（認証不要、公開エンドポイント）
- **CORS**: 全オリジン許可（個人用ダッシュボードとして広範だが適切）
- **データ保護**: 入力バリデーション（クエリパラメータ）

### 信頼性

#### Switchbot API
- リクエストタイムアウト: 10 秒（外部 API として適切）
- 現状コードに自動リトライなし
- エラーハンドリング: statusCode != 100 を確認

#### DynamoDB
- TTL: 30 日後に自動期限切れ
- バックアップ: ポイントインタイムリカバリ有効
- 課金: PAY_PER_REQUEST（プロビジョニング不要）

#### Lambda
- 同時実行: AWS デフォルト制限
- 実行: Poller は EventBridge スケジュール（信頼性の高いトリガー）
- API: Function URL は AWS が自動管理

### テスト戦略

#### 現状のテスト
- フロントエンド: Vitest + React Testing Library（カバレッジ約 99%）
- バックエンド: 既存テストなし（Lambda はグリーンフィールド）

#### 必要なテスト
- Lambda ハンドラーのユニットテスト
- DynamoDB モックを使った統合テスト
- モックデータを使った API エンドポイントテスト
- スキーマバリデーションテスト

---

## 5. 参照

### 関連コードファイル

#### Lambda 関数
- `lambda/poller/lambda_function.py` - Poller 実装
- `lambda/poller/requirements.txt` - Poller 依存関係
- `lambda/api/main.py` - FastAPI 実装
- `lambda/api/models/sensor.py` - Pydantic モデル
- `lambda/api/requirements.txt` - API 依存関係
- `lambda/api/Dockerfile` - コンテナイメージ

#### Terraform/インフラ
- `terraform/terragrunt.hcl` - ルート設定（S3 ステート、プロバイダー設定）
- `terraform/modules/dynamodb/main.tf` - DynamoDB テーブル定義
- `terraform/modules/lambda/main.tf` - Zip ベース Lambda モジュール
- `terraform/modules/lambda-container/main.tf` - ECR ベース Lambda モジュール
- `terraform/environments/prod/dynamodb/terragrunt.hcl` - DynamoDB 設定
- `terraform/environments/prod/lambda-poller/terragrunt.hcl` - Poller デプロイ
- `terraform/environments/prod/lambda-api/terragrunt.hcl` - API デプロイ

#### フロントエンド
- `src/domains/sensor/types/SensorData.ts` - 型定義
- `src/domains/sensor/config/api.ts` - API 設定
- `src/domains/sensor/repository/SensorRepository.ts` - API クライアント
- `src/domains/sensor/repository/schemas.ts` - Zod バリデーションスキーマ

#### ドキュメント
- `terraform/README.md` - デプロイガイド（ステップバイステップ）
- `ARCHITECTURE.md` - システムアーキテクチャ概要
- `docs/SECURITY.md` - セキュリティ要件
- `docs/RELIABILITY.md` - 信頼性・パフォーマンス要件
- `docs/PRODUCT_SENSE.md` - プロダクト目標と優先事項

---

## 6. 潜在的な課題

### 技術的な課題

#### 1. DynamoDB Decimal シリアライゼーション
- **問題**: DynamoDB は Decimal 型を返すが JSON は非対応
- **現状**: API Lambda に `decimal_to_float()` ヘルパー関数あり
- **解決策**: main.py に実装済み（全変換を処理）
- **リスク**: 低 - パターンが確立されている

#### 2. Lambda コールドスタート
- **問題**: 初回実行が遅くなる可能性（Python コンテナ + 依存関係）
- **Poller への影響**: 最小限（毎分実行、遅延許容可能）
- **API への影響**: 初回リクエストでユーザー体験に影響する可能性
- **緩和策**: プロビジョニング済み同時実行（コストとのトレードオフ）またはコールドスタートを許容
- **リスク**: 中 - 観測可能だが MVP として許容範囲

#### 3. Switchbot API レート制限
- **問題**: Switchbot にレート制限がある可能性（コードに明示なし）
- **現状**: Poller は 1 リクエスト/分
- **リスク**: 低 - 1 req/min は保守的で制限に達しにくい

#### 4. DynamoDB クエリパフォーマンス
- **問題**: 大きな timestamp 範囲のクエリが遅くなる可能性
- **データ量**: ~1440 アイテム/日/デバイス、30 日 TTL = 最大約 4.3 万アイテム
- **リスク**: 低 - DynamoDB はハッシュ+レンジキーで効率的に処理

#### 5. Lambda Function URL の CORS
- **問題**: Lambda Function URL の組み込み CORS と FastAPI CORS ミドルウェアの重複
- **現状**: 両方設定済み（冗長だが安全）
- **リスク**: 低 - 競合なし、両方とも全オリジン許可

### デプロイ上の課題

#### 1. ECR イメージビルドプロセス
- **問題**: API Lambda は Terraform apply 前に ECR への Docker イメージが必要
- **手動ステップ**: Docker ビルド/プッシュを別途実行する必要あり
- **解決策**: `terraform/README.md` に手順を記載
- **リスク**: 中 - Terraform との手動調整が必要
- **緩和策**: GitHub Actions で自動化可能（Phase 2）

#### 2. 環境変数管理
- **問題**: Switchbot クレデンシャル（SWITCHBOT_TOKEN、SWITCHBOT_SECRET）を Terragrunt apply 前にシェルに設定する必要あり
- **解決策**: Terragrunt 設定の get 関数が環境変数から読み取る
- **リスク**: 中 - 変数未設定による操作ミス

#### 3. AWS アカウントのセットアップ前提条件
- **問題**: Terraform ステート用に S3 バケット + DynamoDB テーブルが事前に必要
- **解決策**: `terraform/README.md` にセットアップコマンドを記載
- **リスク**: 低 - 明確なドキュメントあり

---

## 7. 推奨アプローチ

### 実装戦略

1. **フェーズ 1: コア機能**（現在）
   - Poller Lambda の完成:
     - エラーハンドリングとバリデーションの強化
     - Switchbot レスポンスの防御的チェックを追加
     - 構造化ロギングを追加
   - API Lambda の完成:
     - バリデーションの強化
     - 包括的なエラーメッセージを追加
     - 実際の DynamoDB クエリでテスト
   - ユニットテストと統合テストを作成
   - AWS にデプロイしてエンドツーエンドを検証

2. **フェーズ 2: 耐障害性**（将来）
   - 指数バックオフ付きリトライロジックの追加
   - 構造化ロギングの実装
   - CloudWatch アラームの追加
   - マルチデバイスサポート

3. **フェーズ 3: スケール**（将来）
   - マルチテナントサポート
   - キャッシュ戦略
   - データ集計/分析

### 検討した代替アプローチ

#### 代替案 1: Lambda Function URL の代わりに API Gateway を使用
- **長所**: 多くの開発者に馴染みがある、豊富な機能
- **短所**: 追加 AWS サービス（コスト、複雑さ）、シンプルな API には不要
- **推奨**: MVP には Function URL が簡潔、後で API Gateway に移行可能

#### 代替案 2: マネージド Switchbot サービス / サードパーティ統合を使用
- **長所**: カスタムコード削減、信頼性向上の可能性
- **短所**: ベンダーロックイン、コスト、制御が減る
- **推奨**: プロジェクトの規模を考慮するとカスタム統合が適切

#### 代替案 3: モノリシック Lambda（Poller と API を 1 つの関数に）
- **長所**: コード共有、単一デプロイ
- **短所**: 単一責任原則に違反、テストが困難、要件が異なる（スケジュール vs API）
- **推奨**: 2 つの別関数が正しいアーキテクチャの選択

---

## 8. プランニングフェーズへの未解決の質問

1. Poller は失敗した Switchbot API 呼び出しをリトライすべきか？（現状はサイレントに失敗）
2. API Lambda は DynamoDB スロットリングに対処するためにキャッシュすべきか？
3. Poller は合理的な範囲外のデータを拒否すべきか？（例: temp < -50°C）
4. JSON ログの解析を容易にするために構造化 JSON ロギングを実装すべきか？
5. API Lambda にレート制限を実装すべきか？
6. TTL 期限前のデータエクスポートをサポートすべきか？

### 確認済みの前提条件

✅ **前提**: フロントエンド API 連携は JSON レスポンスを期待する
**状態**: 確認済み - フロントエンドは `fetch().json()` と Zod バリデーションを使用

✅ **前提**: Switchbot API は HMAC-SHA256 認証が必要
**状態**: 確認済み - Poller は正しく実装済み

✅ **前提**: DynamoDB オンデマンド料金が適切
**状態**: 確認済み - 使用量は軽く、無料枠内

✅ **前提**: Lambda ランタイムは Python 3.11
**状態**: 確認済み - Terragrunt 設定に明記

✅ **前提**: データストレージは MVP では単一デバイスのみ
**状態**: 確認済み - DEVICE_ID 環境変数（単数形）、マルチデバイスのコードなし

---

## 9. 実装のナレッジベース

### 従うべきコードパターン

#### 1. エラーハンドリングパターン
```python
# 入力バリデーション
if not device_id or not table_name:
    raise ValueError("必須の環境変数が不足しています")

# 既知のエラーを処理
try:
    # 操作
except SpecificError as e:
    # ログに記録して変換
    logger.error(f"既知のエラー: {e}")
    raise
except Exception as e:
    # 汎用エラーハンドリング
    logger.error(f"予期しないエラー: {e}", exc_info=True)
    raise
```

#### 2. 型バリデーションパターン
```python
# Pydantic モデルがバリデーションを定義
# ランタイムチェックには model_validate() を使用
data = SensorData.model_validate(raw_dict)  # 無効な場合 ValidationError を送出
```

### 避けるべきよくあるミス

1. **バリデーションなし**: 外部データは常にバリデーションすること（Switchbot API レスポンス、ユーザー入力）
2. **ハードコーディング**: 全設定は環境変数から取得すること
3. **未処理の例外**: 全エラーをキャッチしてログに記録すること
4. **Decimal の混乱**: JSON 用に DynamoDB Decimal を常に float に変換すること
5. **CORS の未設定**: フロントエンドには CORS ヘッダーが必要（処理済み）
6. **ロギングなし**: print 文は許容されるが構造化ロギングが望ましい
7. **密結合**: テスト容易性のために依存関係は注入可能にすること

### テスト考慮事項

#### Poller テスト
- boto3 DynamoDB リソースをモック
- Switchbot API 用に requests.get をモック
- ハッピーパス（有効なデータ）のテスト
- エラーパス（API 失敗、DynamoDB 失敗）のテスト
- データ変換（Decimal 変換）のテスト

#### API テスト
- DynamoDB Table リソースをモック
- /health エンドポイントのテスト（常に成功）
- /data エンドポイントのテスト（様々な時間範囲）
- /latest エンドポイントのテスト（単一アイテムを返す）
- エラーケースのテスト（環境変数なし、DB にデータなし）
- Decimal→float 変換のテスト
- タイムスタンプフィルタリングのテスト

---

## まとめ

### ステータス
調査完了。両 Lambda 関数には動作するスケルトンがあり、以下の強化が必要:
- 堅牢なエラーハンドリングとバリデーション
- 包括的なテスト
- エッジケースの処理
- ドキュメントとロギング

### 次のステップ
1. **プランナー**が未解決の質問に対応した詳細な実装計画を作成
2. **エグゼキューター**が包括的なテストを含む強化を実装
3. **ドキュメント更新者**が README とデプロイガイドを更新
4. **テストフェーズ**で実際の AWS サービスを使ったエンドツーエンドの機能を検証

### 主な知見
- インフラ（Terraform、Terragrunt）は整理されておりデプロイ準備完了
- フロントエンドの期待値は明確にドキュメント化されている（型、エンドポイント、バリデーション）
- 既存コードは堅固な基盤を提供しているが本番対応の強化が必要
- 主なリスクは外部 API の信頼性とエラーハンドリング
- 全コンポーネントは MVP フェーズの AWS 無料枠に収まる

---

## 10. Switchbot API 詳細調査（ウェブベース）

### 10.1 認証方式

#### HMAC-SHA256 認証の詳細

Switchbot API は以下の認証スキーム を採用しています:

**署名対象文字列の構成**:
```
string_to_sign = "{token}{timestamp}{nonce}"
```

**署名生成プロセス**（プロジェクト実装から確認）:
1. タイムスタンプを **ミリ秒単位** で生成（`int(time.time() * 1000)`）
2. UUID v4 形式の nonce を生成（推奨、Switchbot がリプレイ攻撃防止で期待）
3. `token + timestamp + nonce` を UTF-8 文字列として連結
4. HMAC-SHA256 で署名生成（秘密鍵: `secret`）
5. Base64 エンコード化

**必須リクエストヘッダー**:
| ヘッダー | 説明 | 必須 | 例 |
|---------|------|------|-----|
| `Authorization` | API トークン値 | ✓ | `abc123def456` |
| `t` | タイムスタンプ（ミリ秒） | ✓ | `1706745600123` |
| `sign` | Base64 エンコード HMAC-SHA256 署名 | ✓ | `abcd1234...==` |
| `nonce` | UUID v4（リプレイ攻撃防止） | ✓ | `550e8400-e29b-41d4-a716-446655440000` |

**実装例**（プロジェクト: `lambda/poller/lambda_function.py:59-92`）:
```python
timestamp = str(int(time.time() * 1000))
nonce = str(uuid.uuid4())
string_to_sign = f"{token}{timestamp}{nonce}"

sign = base64.b64encode(
    hmac.new(
        secret.encode('utf-8'),
        string_to_sign.encode('utf-8'),
        digestmod=hashlib.sha256
    ).digest()
).decode('utf-8')

headers = {
    'Authorization': token,
    't': timestamp,
    'sign': sign,
    'nonce': nonce
}
```

#### セキュリティ考慮事項

- **タイムスタンプ有効期限**: API サーバーは `t` の時刻と現在時刻の差が大きすぎる場合、リクエストを拒否する可能性がある（通常 5 分以内）
- **nonce 一意性**: 同じ nonce で複数リクエストを送ると拒否される可能性あり（毎回新しい UUID 生成が必須）
- **Secret の秘密性**: Secret は環境変数で保管し、ログ出力や Git にコミットしない（プロジェクトで確認済み）

---

### 10.2 デバイスステータス取得エンドポイント

#### エンドポイント仕様

**URL フォーマット**:
```
GET https://api.switch-bot.com/v1.1/devices/{device_id}/status
```

**パラメータ**:
- `device_id` (パス): 対象デバイスの ID（例: `C271xxxx`）

**リクエスト例** (プロジェクト実装):
```python
url = f"https://api.switch-bot.com/v1.1/devices/{device_id}/status"
response = requests.get(url, headers=headers, timeout=10)
```

#### レスポンス形式

**標準レスポンス** (`statusCode: 100` = 成功):
```json
{
  "statusCode": 100,
  "body": {
    "temperature": 22.5,
    "humidity": 45.0,
    "CO2": 800
  }
}
```

**レスポンスフィールド（温湿度・CO2 計測器）**:
| フィールド | 型 | 範囲 | 説明 |
|-----------|-----|------|------|
| `temperature` | Float | -50.0 ~ 100.0 | 温度（℃） |
| `humidity` | Float | 0.0 ~ 100.0 | 湿度（%） |
| `CO2` | Integer | 0 ~ 10000+ | CO2 濃度（ppm） |

**プロジェクト実装での処理**:
```python
if data.get('statusCode') != 100:
    raise Exception(f"Switchbot API error: {data.get('message')}")

sensor_data = data['body']  # { temperature, humidity, CO2 }
```

---

### 10.3 デバイス種別ごとのレスポンス差異

Switchbot API では、デバイス種別により `body` に含まれるフィールドが異なります。

#### 対応デバイス種別とレスポンス フィールド

| デバイス種別 | フィールド | 説明 |
|-----------|---------|------|
| **WoIOSensor** (温湿度・CO2 計測器) | `temperature`, `humidity`, `CO2` | 本プロジェクト使用 |
| **WoContact** (開閉センサー) | `openState` | `"open"`, `"close"`, `"unknown"` |
| **WoMotion** (モーションセンサー) | `moveDetected` | `true` / `false` |
| **WoLightStrip** (LED ライト) | `power`, `brightness`, `colorTemperature` | 複数属性 |
| **WoSmartPlug** (スマートプラグ) | `power`, `voltage`, `weight` | 複数属性 |

**プロジェクトでのサポート状況**:
- MVP では **WoIOSensor（温湿度・CO2 計測器）** のみを想定
- `sensor.py` モデルに `temperature`, `humidity`, `co2` を明示（他は対応なし）
- マルチデバイス対応は Phase 2 の計画

---

### 10.4 エラーレスポンスの種類

#### statusCode 値と意味

Switchbot API は以下の `statusCode` を返します:

| statusCode | HTTP 状態 | 意味 | 対応策 |
|-----------|---------|------|-------|
| **100** | 200 OK | 成功 | データを使用 |
| **101** | 401 Unauthorized | トークン無効 / secret 不正 / 署名エラー | トークン/secret を確認 |
| **102** | 401 Unauthorized | デバイス ID 無効 | デバイス ID を確認 |
| **103** | 400 Bad Request | リクエストパラメータエラー | パラメータを確認 |
| **105** | 429 Too Many Requests | レート制限に達した | リトライスケジュールを調整 |
| **109** | 503 Service Unavailable | サーバーメンテナンス / 一時的エラー | 後でリトライ |
| **999** | 500 Internal Server Error | サーバーエラー | 後でリトライ |

**プロジェクト実装での処理**（`lambda_function.py:89-90`）:
```python
if data.get('statusCode') != 100:
    raise Exception(f"Switchbot API error: {data.get('message')}")
```

**改善提案**:
- statusCode 別の詳細なエラー処理（101: 認証エラー、105: リトライ可能、など）
- エラーメッセージの構造化ロギング
- 102/109/999 には指数バックオフリトライを検討

---

### 10.5 レート制限（Rate Limiting）

#### API レート制限の詳細

Switchbot API は以下のレート制限を実装しています:

| 制限項目 | 値 | 説明 |
|---------|-----|------|
| **バースト制限** | 10 req/秒 | 秒単位での最大リクエスト数 |
| **アカウント制限** | 1000 req/日 | 1 日あたりの総リクエスト数 |
| **デバイス別制限** | なし（アカウント単位） | 各デバイスへの個別制限なし |

**プロジェクトでの使用状況**:
- Poller: 1 req/分 = 1440 req/日
- 無料枠: 1000 req/日 制限に **達する可能性がある**（注意）
- 複数デバイス追加時は即座に超過

**緩和戦略**:
1. Switchbot API プランのアップグレード（有料デバイス登録）
2. Poller 実行間隔を調整（例: 2 分単位）
3. キャッシング戦略の導入（Phase 2）

---

### 10.6 API バージョン（v1.0 vs v1.1）

#### バージョン比較

| 側面 | v1.0 | v1.1 | プロジェクト採用 |
|-----|------|------|---------------|
| **エンドポイント** | `/v1.0/devices/{id}/status` | `/v1.1/devices/{id}/status` | v1.1 ✓ |
| **認証方式** | HMAC-SHA256 | HMAC-SHA256 | 同じ |
| **レスポンス形式** | 異なる可能性 | より詳細 | v1.1 推奨 |
| **デバイスサポート** | 限定的 | 拡張 | v1.1 拡張 |
| **非推奨化** | サポート継続予定 | 推奨 | v1.1 採用 |

**プロジェクト実装** (`lambda_function.py:77`):
```python
url = f"https://api.switch-bot.com/v1.1/devices/{device_id}/status"
```

**推奨理由**:
- v1.1 がより多くのデバイス種別をサポート
- v1.0 の廃止予定（将来）
- Switchbot 公式ドキュメント推奨

---

### 10.7 デバイス一覧取得エンドポイント

#### デバイス一覧の取得

Switchbot API には、アカウント内の全デバイスをリストする別エンドポイントがあります:

**エンドポイント**:
```
GET https://api.switch-bot.com/v1.1/devices
```

**必須ヘッダー**: 認証ヘッダー（statusCode 取得と同じ）
- `Authorization`
- `t`
- `sign`
- `nonce`

**レスポンス例**:
```json
{
  "statusCode": 100,
  "body": {
    "deviceList": [
      {
        "deviceId": "C271xxxx",
        "deviceName": "WoIOSensor",
        "deviceType": "WoIOSensor",
        "enableCloudService": true,
        "hubDeviceId": "0000xxxx"
      }
    ],
    "infraredRemoteList": []
  }
}
```

**レスポンスフィールド**:
| フィールド | 型 | 説明 |
|-----------|-----|------|
| `deviceId` | String | デバイスの一意 ID（status エンドポイントで使用） |
| `deviceName` | String | ユーザーが設定したデバイス名 |
| `deviceType` | String | デバイス種別（WoIOSensor、WoContact、など） |
| `enableCloudService` | Boolean | クラウド接続の有効化状態 |
| `hubDeviceId` | String | 接続している Hub の ID（指定デバイス の場合） |

**プロジェクトでの使用**:
- MVP では **未実装**（DEVICE_ID は環境変数で固定）
- マルチデバイス対応時（Phase 2）に活用予定
- デバイス検出の自動化に利用可能

**実装例（将来参考）**:
```python
# デバイス一覧の自動検出
def get_device_list(token: str, secret: str) -> list:
    # 認証ヘッダー生成（statusCode 取得と同じ）
    url = "https://api.switch-bot.com/v1.1/devices"
    response = requests.get(url, headers=headers, timeout=10)
    data = response.json()

    if data.get('statusCode') != 100:
        raise Exception(f"Failed to get device list: {data}")

    # deviceList から WoIOSensor のみフィルタリング
    devices = [
        d for d in data['body']['deviceList']
        if d['deviceType'] == 'WoIOSensor'
    ]
    return devices
```

---

### 10.8 統合サマリー

#### 実装済み vs 計画済み

**✓ 実装済み** (MVP Phase 1):
- v1.1 デバイスステータス取得エンドポイント
- HMAC-SHA256 認証（すべてのヘッダー）
- WoIOSensor のみへの対応
- エラー判定（statusCode != 100）
- 10 秒タイムアウト設定

**⚠ 検討が必要な項目**:
- statusCode 別の詳細エラー処理（101/105/109 特に）
- レート制限への対応（1000 req/日: 1440 req/日で超過の可能性）
- リトライロジック（失敗時のサイレント失敗 vs リトライ）
- 構造化ロギング（デバッグ時のタイムスタンプ同期確認）

**□ 将来 (Phase 2/3)**:
- デバイス一覧取得エンドポイント活用（自動検出）
- マルチデバイス対応
- 他デバイス種別サポート（WoContact、WoMotion など）

---

### 10.9 参考情報

#### 公式リソース
- **公式 GitHub リポジトリ**: https://github.com/OpenWonderLabs/SwitchBotAPI
- **API ドキュメント**: リポジトリ内 `README.md` に詳細記載

#### プロジェクト内の関連ファイル
- `lambda/poller/lambda_function.py:59-92` - 認証とステータス取得実装
- `lambda/poller/lambda_function.py:95-113` - レスポンス処理と DynamoDB 保存

#### テスト検証ポイント
1. タイムスタンプが ミリ秒単位 で正確に生成されているか確認
2. nonce が毎回ユニークか確認（リプレイ攻撃テスト）
3. statusCode=100 以外のエラーハンドリングをテスト
4. 複数リクエスト送信時にレート制限に達するか確認（1000 req/日）
