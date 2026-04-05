# Architecture Overview - Smarthome Sensor Dashboard

このドキュメントは、システムの全体的なアーキテクチャマップを提供します。

## アーキテクチャ原則

### 1. 階層化ドメインアーキテクチャ

各ビジネスドメインは固定されたレイヤー群に分割され、依存関係の方向性は厳密に検証されます。

```
┌─────────────────────────────────────────┐
│           UI Layer                      │
│  (React Components, Pages, Routing)     │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│         API/Service Layer               │
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

**ルール**: コードは「前方」（下方向）にのみ依存できます。逆方向の依存は禁止されます。

### 2. ドメイン構造

```
src/
├── domains/
│   ├── sensor/              # センサードメイン
│   │   ├── types/          # 型定義
│   │   ├── config/         # 設定
│   │   ├── repository/     # データアクセス
│   │   ├── service/        # ビジネスロジック
│   │   └── ui/             # UI コンポーネント
│   ├── dashboard/           # ダッシュボードドメイン
│   │   ├── types/
│   │   ├── config/
│   │   ├── repository/
│   │   ├── service/
│   │   └── ui/
│   └── ...
├── shared/                  # 共有ユーティリティ
│   ├── types/              # 共有型
│   ├── utils/              # ユーティリティ関数
│   ├── components/         # 共有UIコンポーネント
│   └── providers/          # 横断的関心事プロバイダー
└── app/                     # アプリケーション起動
    ├── main.tsx            # エントリーポイント
    └── routes.tsx          # ルーティング設定
```

### 3. 横断的関心事

以下は専用のプロバイダー経由でのみアクセスします：

- **認証/認可** - `shared/providers/auth`
- **ロギング** - `shared/providers/logger`
- **エラーハンドリング** - `shared/providers/error`
- **API クライアント** - `shared/providers/api`

## ドメイン設計

### センサードメイン

**責務**: Switchbot APIとの通信、センサーデータの取得と正規化

**主要コンポーネント**:
- `SensorRepository` - Switchbot API呼び出し
- `SensorService` - データの正規化、キャッシング
- `SensorTypes` - センサーデータの型定義

### ダッシュボードドメイン

**責務**: データの可視化、グラフ表示、UI

**主要コンポーネント**:
- `DashboardService` - 表示用データの準備
- `ChartComponents` - グラフUIコンポーネント
- `DashboardTypes` - ダッシュボード関連の型定義

## データフロー

```
┌──────────────────┐
│  Switchbot API   │
└────────┬─────────┘
         │
         ↓
┌──────────────────┐
│ SensorRepository │ ← API呼び出し、レスポンス検証
└────────┬─────────┘
         │
         ↓
┌──────────────────┐
│  SensorService   │ ← データ正規化、キャッシング
└────────┬─────────┘
         │
         ↓
┌──────────────────┐
│DashboardService  │ ← 表示用データ準備
└────────┬─────────┘
         │
         ↓
┌──────────────────┐
│  UI Components   │ ← レンダリング
└──────────────────┘
```

## 技術スタック

### フロントエンド
- **フレームワーク**: React + TypeScript
- **ビルドツール**: Vite
- **スタイリング**: TailwindCSS
- **グラフ**: Recharts または Chart.js
- **状態管理**: React Context + Hooks（必要に応じてZustand）

### バックエンド/API
- **Lambda API**: FastAPI + Lambda Web Adapter、DynamoDBからセンサーデータを取得・提供。Raspberry Pi BLE スキャンデータの受け取りにも対応（4エンドポイント）
- **データベース**: DynamoDB（パーティションキー: deviceId、ソートキー: timestamp）
- **ロギング**: Lambda は CloudWatch 向けの構造化JSONログ

### 開発ツール
- **リンター**: ESLint + TypeScript ESLint
- **フォーマッター**: Prettier
- **テスト**: Vitest + React Testing Library
- **型チェック**: TypeScript strict mode
- **Python 依存管理**: uv（pyproject.toml + uv.lock による再現可能なビルド）

## 不変条件（機械的に適用）

以下のルールはカスタムリンターとテストで自動検証されます：

1. **境界でのデータ検証**: すべての外部データは境界で検証スキーマを通す
2. **型安全性**: `any`型の使用禁止（例外は明示的に文書化）
3. **依存方向**: レイヤー間の依存は下方向のみ
4. **ファイルサイズ**: 単一ファイルは300行以内
5. **関数の複雑度**: cyclomatic complexity は10以下
6. **テストカバレッジ**: 新規コードは80%以上

詳細: `docs/QUALITY_SCORE.md`

## スケーラビリティの考慮

### 現在のフェーズ（MVP）
- クライアントサイドのみ
- ローカルストレージでのキャッシング
- 定期的なポーリング（1分間隔）

### 将来の拡張
- バックエンドAPIサーバーの追加
- データベース永続化
- WebSocketによるリアルタイム更新
- 複数センサーのサポート
- ユーザー認証とマルチテナント

## セキュリティ

- **APIキー管理**: 環境変数のみ、ハードコード禁止
- **データ検証**: すべての外部入力を検証
- **エラーメッセージ**: 内部情報の漏洩を防ぐ

詳細: `docs/SECURITY.md`

## パフォーマンス

- **バンドルサイズ**: 初期ロード < 500KB
- **Time to Interactive**: < 3秒
- **データ取得**: レスポンス時間 < 2秒

詳細: `docs/RELIABILITY.md`

## Lambda アーキテクチャの詳細

### API Lambda (`lambda/api/main.py`)

**役割**: DynamoDB内のセンサーデータをHTTPで公開、Raspberry Pi BLE データの受け入れ

**エンドポイント**:
- `GET /` - ヘルスチェック（ステータス確認）
- `GET /health` - ヘルスチェックのエイリアス
- `GET /data?hours=24` - 指定時間範囲のセンサーデータ（デフォルト24時間、最大168時間）
- `GET /latest` - 最新のセンサーデータ1件
- `POST /data` - Raspberry Pi BLE スキャン結果を受け取り DynamoDB に保存（201 Created）。IAM 認証（Lambda Function URL レベル）で保護

**実装ハイライト**:
- **FastAPI + Lambda Web Adapter**: コンテナ化してECR経由でLambdaにデプロイ
- **CORS有効**: フロントエンドからのクロスオリジンリクエスト（GET等）を許可
- **構造化JSONログ**: リクエスト・エラー・設定問題をCloudWatchに記録
- **起動時バリデーション**: DEVICE_ID (GET用) および TABLE_NAME (共通) が設定されていることを確認
- **Pydantic v2**: request/response_model による自動検証・OpenAPIドキュメント生成

### BLE センサーデータフロー（Raspberry Pi 経由）

SwitchBot Hub Mini なしの環境では、Raspberry Pi が BLE で直接センサーをスキャンし、
Lambda API IAM Function URL 経由でデータを登録します。

```
SwitchBot CO2センサー --BLE--> Raspberry Pi --HTTP POST (SigV4署名)--> Lambda API (IAM認証 Function URL) --> DynamoDB
```

Raspberry Pi 側のスクリプトは別リポジトリで管理します（関心の分離）。
`POST /data` のリクエスト/レスポンス仕様が両リポジトリ間の契約です。

**認証アーキテクチャ**:
- `GET /data`, `GET /latest`: 現在 IAM 認証 Function URL 経由のため、パブリックアクセスできない。フロントエンド向けの公開方法が別途必要（API Gateway、CloudFront、または別の Function URL）
- `POST /data`: AWS IAM 認証専用の Function URL 経由でアクセス。Raspberry Pi は SigV4 署名付きリクエストを送信
- **重要**: Lambda は単一の Function URL のみ作成可能（パブリック NONE または IAM のいずれか）。現在、`terraform/environments/prod/lambda-api/terragrunt.hcl` で `create_function_url = false` に設定し、パブリック URL を削除。IAM Function URL のみ有効。GET エンドポイントをフロントエンドに公開するには設計変更が必要

### テストカバレッジ

- **API**: 93% 行カバレッジ（35テストケース）
  - 全エンドポイント、エラーパス、環境変数検証

### Lambda 依存関係管理

**パッケージマネージャー**: uv（Python 高速パッケージマネージャー）

**構成**:
- `lambda/api/pyproject.toml` - API Lambda の依存定義（FastAPI, boto3, pydantic など）
- `lambda/api/uv.lock` - API Lambda の完全にロックされた依存版（再現可能なビルド用）

**ローカル開発**:
```bash
# Lambda API ディレクトリで
cd lambda/api
uv sync        # pyproject.toml から仮想環境をセットアップ
uv run pytest tests/  # テスト実行
```

**本番ビルド（Docker）**:
```dockerfile
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN UV_SYSTEM_PYTHON=1 uv sync --frozen --no-dev  # ロックファイル完全準拠、開発依存除外
```

**利点**:
- `uv.lock` によりローカル・CI・本番で同じ依存版を保証（再現可能性）
- `--frozen` オプションで意図しないバージョン更新を防止
- uv による高速インストール（pip比で数倍高速）
- 開発依存の明確な分離（`[dependency-groups] dev`）

## 変更履歴

- 2026-03-28: 初期アーキテクチャ設計
- 2026-03-29: Lambda実装完了（Poller + API）、構造化ログ・リトライ・バリデーション追加
- 2026-04-05: PR #22 マージ後、IAM Function URL 認証アーキテクチャを反映。API エンドポイント説明更新、GET/POST 認証方式の明確化。フロントエンド GET アクセス問題をテック負債として登録
- 2026-04-05: Lambda Poller 削除。BLE 方式（Raspberry Pi）へ移行完了のため Poller 関連記述を除去
