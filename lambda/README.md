# Lambda 関数

Smarthome センサーダッシュボード用の API Lambda 関数です。

## 概要

### API Lambda (`api/`)

DynamoDB内のセンサーデータをHTTPで公開します。FastAPI + Lambda Web Adapterで実装。
Raspberry Pi BLE スキャン結果の受け取りにも対応しています。

**エンドポイント**:
- `GET /` - ヘルスチェック
- `GET /health` - ヘルスチェック（エイリアス）
- `GET /data?hours=24` - 指定時間範囲のセンサーデータ
- `GET /latest` - 最新のセンサーデータ1件
- `POST /data` - Raspberry Pi BLE スキャン結果を受け取り DynamoDB に保存（IAM認証）

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

uv を使用して Lambda 関数の依存関係をセットアップします。

**uv がインストールされていない場合**:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**API Lambda**:
```bash
cd lambda/api
uv sync  # pyproject.toml から仮想環境をセットアップ
```

### テスト実行

**API Lambda**:
```bash
cd lambda/api
uv run pytest tests/ -v
```

### ローカル開発（API Lambda）

FastAPI開発サーバーを直接実行（DynamoDBのモック時）：

```bash
cd lambda/api
uv sync  # 依存関係をセットアップ
uv run python main.py
# http://localhost:8000/docs でOpenAPI UIを確認
```

## デプロイ

### インフラストラクチャ設定

デプロイはTerragruntで管理されます。詳細は [`terraform/README.md`](../terraform/README.md) を参照してください。

**手動デプロイ（開発・検証用）**:

```bash
# API Lambda
cd terraform/environments/prod/lambda-api
terragrunt apply
```

### 環境変数の設定

デプロイ前に、`terraform/environments/prod/` 配下のTerragrunt設定ファイルで環境変数を指定します：

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
├── api/
│   ├── main.py                # FastAPI アプリケーション
│   ├── models/
│   │   ├── __init__.py
│   │   └── sensor.py          # Pydanticモデル定義
│   ├── pyproject.toml         # 依存関係定義（uv用）
│   ├── uv.lock                # ロックファイル（再現可能なビルド用）
│   ├── tests/
│   │   ├── __init__.py
│   │   └── test_main.py       # ユニットテスト
│   └── Dockerfile             # Lambda Web Adapter用コンテナイメージ
└── README.md
```

**依存関係管理**: uv（pyproject.toml + uv.lock）
- 従来の requirements.txt は削除済み
- `[project]` で本番依存、`[dependency-groups] dev` で開発依存を管理

## トラブルシューティング

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
