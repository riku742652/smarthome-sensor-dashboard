# Lambda 関数

Smarthome センサーダッシュボード用の2つのLambda関数です。

## 概要

### Poller Lambda (`poller/`)

定期的（2分ごと）にSwitchbot APIをポーリングして、センサーデータ（温度・湿度・CO2）をDynamoDBに保存します。

**機能**:
- Switchbot APIからセンサーデータを取得
- 一時的な障害に対する指数バックオフリトライ（最大3回）
- センサーデータの検証（必須フィールド確認、範囲チェック）
- DynamoDBへの永続化（30日TTL付き）
- CloudWatch向け構造化JSONログ

**環境変数**:
- `SWITCHBOT_TOKEN`: Switchbot APIトークン
- `SWITCHBOT_SECRET`: Switchbot APIシークレット
- `DEVICE_ID`: 対象デバイスID
- `TABLE_NAME`: DynamoDBテーブル名

### API Lambda (`api/`)

DynamoDB内のセンサーデータをHTTPで公開します。FastAPI + Lambda Web Adapterで実装。

**エンドポイント**:
- `GET /` - ヘルスチェック
- `GET /health` - ヘルスチェック（エイリアス）
- `GET /data?hours=24` - 指定時間範囲のセンサーデータ
- `GET /latest` - 最新のセンサーデータ1件

**特徴**:
- CORS有効（フロントエンドからのアクセスを許可）
- 自動OpenAPIドキュメント生成（`/docs`で確認可）
- CloudWatch向け構造化JSONログ
- Pydantic v2による自動バリデーション

**環境変数**:
- `DEVICE_ID`: 対象デバイスID
- `TABLE_NAME`: DynamoDBテーブル名

## ローカルテスト

### セットアップ

各Lambda関数のディレクトリに移動し、開発用依存関係をインストール：

```bash
cd lambda/poller
pip install -r requirements-dev.txt
```

または

```bash
cd lambda/api
pip install -r requirements-dev.txt
```

### テスト実行

**Poller Lambda**:
```bash
cd lambda/poller
python -m pytest tests/ -v
```

**API Lambda**:
```bash
cd lambda/api
python -m pytest tests/ -v
```

### カバレッジ確認

```bash
cd lambda/poller
python -m pytest tests/ --cov=lambda_function --cov-report=html
```

### ローカル開発（API Lambda）

FastAPI開発サーバーを直接実行（DynamoDBのモック時）：

```bash
cd lambda/api
pip install -r requirements.txt
python main.py
# http://localhost:8000/docs でOpenAPI UIを確認
```

## デプロイ

### インフラストラクチャ設定

デプロイはTerragruntで管理されます。詳細は [`terraform/README.md`](../terraform/README.md) を参照してください。

**手動デプロイ（開発・検証用）**:

```bash
# Poller Lambda
cd terraform/environments/prod/lambda-poller
terragrunt apply

# API Lambda
cd terraform/environments/prod/lambda-api
terragrunt apply
```

### 環境変数の設定

デプロイ前に、`terraform/environments/prod/` 配下のTerragrunt設定ファイルで環境変数を指定します：

**Poller** (`lambda-poller/terragrunt.hcl`):
```hcl
inputs = {
  environment_variables = {
    SWITCHBOT_TOKEN  = "your-token"
    SWITCHBOT_SECRET = "your-secret"
    DEVICE_ID        = "your-device-id"
    TABLE_NAME       = "sensor-data"
  }
}
```

**API** (`lambda-api/terragrunt.hcl`):
```hcl
inputs = {
  environment_variables = {
    DEVICE_ID  = "your-device-id"
    TABLE_NAME = "sensor-data"
  }
}
```

## プロジェクト構造

```
lambda/
├── poller/
│   ├── lambda_function.py     # Poller Lambda メイン処理
│   ├── requirements.txt        # 本番依存関係
│   ├── requirements-dev.txt    # 開発・テスト依存関係
│   ├── tests/
│   │   ├── __init__.py
│   │   └── test_lambda_function.py  # ユニットテスト
│   └── Dockerfile             # コンテナイメージ（オプション）
├── api/
│   ├── main.py                # FastAPI アプリケーション
│   ├── models/
│   │   ├── __init__.py
│   │   └── sensor.py          # Pydanticモデル定義
│   ├── requirements.txt        # 本番依存関係
│   ├── requirements-dev.txt    # 開発・テスト依存関係
│   ├── tests/
│   │   ├── __init__.py
│   │   └── test_main.py       # ユニットテスト
│   └── Dockerfile             # Lambda Web Adapter用コンテナイメージ
└── README.md
```

## トラブルシューティング

### Switchbot API エラー

Pollerが失敗する場合、CloudWatch Logsで構造化ログを確認してください：

```bash
# AWS CLIで最新のログを確認
aws logs tail /aws/lambda/poller --follow
```

エラーの種類：
- `statusCode=101`: 認証エラー（トークン・シークレットを確認）
- `statusCode=102`: デバイス無効（デバイスIDを確認）
- `statusCode=105`: レート制限（ポーリング間隔が短すぎる）

### API 503 エラー

Cold Startが原因の場合があります。数秒待ってからリクエストを再実行してください。

### DynamoDB 接続エラー

IAMロールに以下の権限があることを確認：
- `dynamodb:Query`
- `dynamodb:PutItem`

## 関連ドキュメント

- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) - システム全体のアーキテクチャ
- [`terraform/README.md`](../terraform/README.md) - インフラストラクチャ設定とデプロイ方法
- [`docs/SECURITY.md`](../docs/SECURITY.md) - セキュリティ考慮事項
