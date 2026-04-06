# CloudFront に Lambda API オリジンを追加するためのリサーチ

## タスク理解

CloudFront（現在 S3 静的ファイル配信のみ）に Lambda API Function URL をオリジンとして追加し、フロントエンドから `/api/*` パスで Lambda エンドポイントにアクセスできる構成にする。これにより、フロントエンドの `VITE_API_BASE_URL` を `/api` に設定でき、相対パスで API 呼び出しが可能になる。

### 目標
- CloudFront 上で `/api/*` パスを Lambda Function URL にルーティング
- Lambda は IAM 認証 URL → パブリック URL へ変更
- フロントエンドから `/api/health`, `/api/data?hours=24`, `/api/latest` 呼び出し可能に
- `VITE_API_BASE_URL` を `/api` に設定可能に

### 成功基準
- [x] CloudFront に Lambda オリジンが追加される
- [x] `/api/*` リクエストが Lambda に正しくルーティングされる
- [x] Lambda には API レスポンス用のパブリック Function URL が存在する
- [x] フロントエンドのビルドで `VITE_API_BASE_URL=/api` が使用可能
- [x] CORS ヘッダーの重複を避ける（CloudFront 経由だから Lambda は不要の可能性）

## 現状分析

### 関連ファイル
- `terraform/modules/cloudfront/main.tf` - CloudFront 現在設定
- `terraform/modules/cloudfront/variables.tf` - CloudFront 変数定義
- `terraform/modules/lambda-container/main.tf` - Lambda Function URL 設定
- `terraform/environments/prod/cloudfront/terragrunt.hcl` - CloudFront inputs
- `terraform/environments/prod/lambda-api/terragrunt.hcl` - Lambda API inputs
- `src/domains/sensor/repository/SensorRepository.ts` - フロントエンド API 呼び出し
- `src/domains/sensor/config/api.ts` - API 設定
- `lambda/api/main.py` - Lambda API 実装
- `ARCHITECTURE.md` - 認証アーキテクチャ説明

### CloudFront 現状

**ファイル**: `terraform/modules/cloudfront/main.tf`

```hcl
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = var.price_class
  comment             = "${var.project_name} ${var.environment} frontend"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.frontend.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.frontend.id}"
    # ... キャッシュ設定
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }
}
```

**現在の構成**:
- `origin`: S3 バケットのみ（1 つ）
- `default_cache_behavior`: すべてのリクエストを S3 にルーティング
- カスタムエラーレスポンス: 404/403 を index.html にリダイレクト（SPA 対応）

**必要な追加**:
- Lambda Function URL 用の新しい `origin` ブロック
- `/api/*` パス用の `cache_behavior` ブロック
- 変数として Lambda URL を受け入れる仕組み

### Lambda 現状

**ファイル**: `terraform/environments/prod/lambda-api/terragrunt.hcl`

```hcl
inputs = {
  function_name = "api"
  # ...
  create_function_url     = false          # パブリック URL なし
  create_iam_function_url = true           # IAM 認証 URL のみ
  # ...
}
```

**認証アーキテクチャ** (`ARCHITECTURE.md` より):
- `GET /data`, `GET /latest`: 現在 IAM 認証 Function URL 経由のため、パブリックアクセスできない
- `POST /data`: AWS IAM 認証専用（Raspberry Pi 用）
- **重要**: Lambda は Function URL を 1 つしか作成できない（パブリック NONE または IAM のいずれか）
- 現在設定: `create_function_url = false`, `create_iam_function_url = true` → IAM Function URL のみ

**必要な変更**:
- `create_iam_function_url = false` に変更し、IAM Function URL を削除
- `create_function_url = true` に変更し、パブリック Function URL を作成
- ただし、Raspberry Pi `POST /data` エンドポイントの保護が失われるため、別の保護方法が必要

### Lambda 実装

**ファイル**: `lambda/api/main.py`

Lambda API は FastAPI + Lambda Web Adapter で実装。

**CORS 設定**:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

CORS は Lambda レベルで有効化。CloudFront 経由の場合、CORS ヘッダーは CloudFront で処理されるため、Lambda の CORS は二重防御（冗長だが害はない）。

### フロントエンド API 設定

**ファイル**: `src/domains/sensor/config/api.ts`

```typescript
export const API_CONFIG = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || '',
  useMockData: import.meta.env.VITE_USE_MOCK_DATA === 'true',
  pollingInterval: Number(import.meta.env.VITE_POLLING_INTERVAL) || 60000,
  maxRetries: 3,
  retryDelay: 1000,
} as const

export const API_ENDPOINTS = {
  health: '/health',
  data: '/data',
  latest: '/latest',
} as const
```

**現状**:
- `VITE_API_BASE_URL` は `.env` または環境変数から読み込み
- `.env.example`: `VITE_API_BASE_URL=https://your-lambda-function-url.lambda-url.ap-northeast-1.on.aws`
- フロントエンド API 呼び出し: `${baseUrl}${API_ENDPOINTS.data}` = `https://xxx.lambda-url.../data`

**必要な変更**:
- `VITE_API_BASE_URL=/api` に設定すると、CloudFront パス `/api` 経由で呼び出し可能

### フロントエンド API 呼び出し

**ファイル**: `src/domains/sensor/repository/SensorRepository.ts`

```typescript
async fetchSensorData(hours: number): Promise<SensorDataResponse> {
  const url = `${this.baseUrl}${API_ENDPOINTS.data}?hours=${hours}`
  const response = await fetch(url)
  // ...
}
```

`baseUrl = ''` の場合、URL は `/data?hours=24` となり、CloudFront がリクエストを処理する場合、CloudFront の origin が `/data` を正しく Lambda に送信する必要がある。

## 技術コンテキスト

### CloudFront Origin + Cache Behavior パターン

CloudFront で複数オリジン + パスベースのルーティングを実装するパターン:

```hcl
# Origin 1: S3
origin {
  domain_name              = "bucket.s3.amazonaws.com"
  origin_id                = "S3-bucket"
  origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
}

# Origin 2: Lambda Function URL
origin {
  domain_name = "xxx.lambda-url.ap-northeast-1.on.aws"  # Function URL ドメイン
  origin_id   = "Lambda-API"
  
  # Lambda Function URL は HTTPS + Host ヘッダー検証が必要な場合がある
  # HTTP only -> Lambda が HTTPS を強制リダイレクト
  custom_header {
    name  = "X-Origin-Verify"
    value = "cloudfront"  # Lambda で検証（オプション）
  }
}

# Default: S3 へ
default_cache_behavior {
  target_origin_id = "S3-bucket"
  # ...
}

# API: Lambda へ
cache_behavior {
  path_pattern     = "/api/*"
  allowed_methods  = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
  cached_methods   = ["GET", "HEAD"]
  target_origin_id = "Lambda-API"
  
  # API はキャッシュしない（デフォルト TTL = 0）
  default_ttl = 0
  max_ttl     = 0
  
  # クエリ文字列を Forward（/data?hours=24 の hours パラメータを保持）
  forwarded_values {
    query_string = true
    cookies {
      forward = "none"
    }
  }
  
  viewer_protocol_policy = "redirect-to-https"
}
```

### パス書き換え

CloudFront で `/api/*` → `/api/*` をそのまま Lambda に送信する場合、Lambda はリクエストパスを見て `/api/data` として処理される。これは期待値ではない。

**選択肢**:

1. **CloudFront でパス除去** (オプション)
   - CloudFront の `origin_path = "/api"` または request rewriting を使用して `/api/*` を `/*` に変換
   - Lambda は `/data` として受信

2. **Lambda でパス処理**
   - Lambda は `/api/data` を受け取り、FastAPI が自動的にルーティング
   - FastAPI は未登録のパス `/api/data` に 404 を返す
   - **問題**: エンドポイント設定を変更する必要がある

3. **CloudFront Origin Path を使用** (推奨）
   - Origin 定義で `origin_path` パラメータを使用
   - CloudFront → Lambda への送信時に `/api` プレフィックスを除去

```hcl
origin {
  domain_name = "xxx.lambda-url.ap-northeast-1.on.aws"
  origin_id   = "Lambda-API"
  origin_path = ""  # デフォルト: パス除去なし
}
```

実装例:

```hcl
# Option A: origin_path を使用せず、Lambda で /api パスを処理
origin {
  domain_name = aws_lambda_function_url.this[0].function_url
  origin_id   = "Lambda-API"
  # FastAPI で @app.get("/api/data") などを追加
}

# Option B: origin_path で /api を除去
# ※ AWS では origin_path が Lambda URL に対応しているか確認が必要
```

Terraform の CloudFront Origin で `origin_path` サポート確認:
- Terraform aws_cloudfront_distribution: `origin_path` パラメータあり
- ただし、Lambda Function URL に対する `origin_path` の動作は未検証（CloudFront が Function URL ドメイン名を認識するかどうか）

**安全策**: Lambda エンドポイント定義を `/api/health`, `/api/data`, `/api/latest` に変更する（Option 3）

```python
@app.get("/api/health", response_model=HealthCheckResponse)
async def health_check():
    ...

@app.get("/api/data", response_model=SensorDataResponse)
async def get_sensor_data(hours: int = Query(...)):
    ...
```

しかし、これは Raspberry Pi の `POST /data` エンドポイント（IAM 認証）にも影響を与える（Raspberry Pi クライアントとの互換性がなくなる）。

**実際の推奨策**:
1. CloudFront 上で `/api/*` → Lambda へルーティング
2. Lambda で `/api/health` などを処理、または Origin Path で調整
3. Raspberry Pi 用は別の IAM User/Role ベースのアクセス方法を検討

### 認証とセキュリティ

**現在の問題**:
- Lambda は Function URL を 1 つのみ作成可能
- `create_function_url = true` (パブリック) または `create_iam_function_url = true` (IAM) のいずれか
- 両立不可

**解決策**:

1. **フロントエンドはパブリック URL を使用**
   - `create_function_url = true` で `/api/*` エンドポイントを公開
   - GET エンドポイント (`/data`, `/latest`) はパブリックアクセス可

2. **Raspberry Pi POST エンドポイント (`/data`)を別の方法で保護**
   - **Option A**: API Gateway を追加
     - CloudFront → API Gateway → Lambda の構成
     - API Gateway で IAM 認証制御
     - Raspberry Pi は API Gateway IAM URL にアクセス
   - **Option B**: Lambda コード内で API キーベースの認証
     - `POST /data` リクエストに `Authorization` または `X-API-Key` ヘッダーを要求
     - Raspberry Pi クライアント側で環境変数から API キーを送信
   - **Option C**: Lambda Authorizer
     - CloudFront は認可しない
     - Lambda 内で認証ロジックを実装

**ARCHITECTURE.md での現状記述** (2026-04-05):
> GET エンドポイントをフロントエンドに公開するには設計変更が必要

本リサーチで設計変更を実施することになる。

### パス除去/書き換え詳細

**Lambda Function URL の特性**:
- AWS から提供されるパブリックドメイン: `https://xxxx.lambda-url.ap-northeast-1.on.aws`
- Function URL は「ドメイン + パス」で起動
- CloudFront Origin として指定した場合、CloudFront → Lambda への通信でパスが保持される

**例**:
- CloudFront リクエスト: `GET /api/data?hours=24`
- CloudFront Origin: `lambda-url.ap-northeast-1.on.aws`
- Lambda が受け取るパス: `/api/data?hours=24`
- FastAPI: `/data` エンドポイントにマッチしない → 404

**解決方法**:
- CloudFront `cache_behavior` + `origin_path` で `/api` を除去
  - ただし、terraform aws_cloudfront_distribution の origin_path は `/api` のような「プリフィックス除去」をサポートしているか確認が必要

Terraform AWS Provider ドキュメント確認:
- `origin_path` - (Optional) Web application/API that CloudFront will access. For example, `somesite.com/app` → `origin_path = "/app"`
- Lambda Function URL に対して origin_path を使用すると、CloudFront が自動的にパスを除去するかどうかは明示されていない

**実装方針**:
- Terraform で Lambda origin に `origin_path` パラメータを追加して検証
- または Lambda エンドポイントを `/api/` で統一する（エンドポイント再定義）

## 制約と検討事項

### 1. Lambda Function URL は 1 つのみ

**制約**: AWS Lambda は 1 つの Function URL のみ作成可能（パブリック NONE または IAM）

**現状**:
- `create_iam_function_url = true` → IAM 認証 URL が存在
- `create_function_url = false` → パブリック URL なし

**変更の影響**:
- IAM URL を削除すると、Raspberry Pi の `POST /data` が失敗する
- 代替の認証方法が必須

### 2. Raspberry Pi POST エンドポイントの保護

**現状**: IAM Function URL で保護 (SigV4 署名で認証)

**変更後の選択肢**:
- **Option A (推奨)**: API キーベース認証
  - `POST /data` ヘッダーに `Authorization: Bearer $API_KEY` を要求
  - Lambda 環境変数 `API_KEY` で検証
  - Terraform: `API_KEY` を `environment_variables` に追加
  - Raspberry Pi: クライアント側で `API_KEY` 環境変数を設定

- **Option B**: IP 制限
  - CloudFront origin security group で Raspberry Pi IP を許可
  - Lambda には origin security group が不要（パブリック URL）

- **Option C**: API Gateway を追加
  - CloudFront → API Gateway (IAM/カスタム認認証) → Lambda
  - 構成が複雑化

**推奨**: Option A（API キー認証）
  - 実装が簡単
  - Raspberry Pi クライアント側の変更を最小化
  - terraform/lambda/api/main.py で `API_KEY` チェックを追加

### 3. CORS ヘッダー

**現状**: Lambda で CORS ヘッダーを返す

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    ...
)
```

**CloudFront 経由の場合**:
- クライアント (ブラウザ) → CloudFront → Lambda
- CloudFront は CORS をキャッシュしない（デフォルト）
- Lambda が CORS ヘッダーを返し、ブラウザが処理

**処理方法**: Lambda の CORS 設定は保持（二重防御）

### 4. キャッシュ戦略

**API レスポンス**:
- GET `/api/data` (変動データ) → キャッシュなし (TTL=0)
- GET `/api/latest` (変動データ) → キャッシュなし (TTL=0)
- GET `/api/health` (ステータス) → オプション: 短い TTL (数秒)

**CloudFront cache_behavior**:
```hcl
cache_behavior {
  path_pattern     = "/api/*"
  default_ttl      = 0
  max_ttl          = 0
  min_ttl          = 0
  compress         = true
  viewer_protocol_policy = "redirect-to-https"
}
```

## 参考実装パターン

### CloudFront + 複数オリジン（S3 + Lambda）の構成

```hcl
# Origin 1: S3
origin {
  domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
  origin_id                = "S3"
  origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
}

# Origin 2: Lambda API
origin {
  domain_name = replace(
    aws_lambda_function_url.this[0].function_url,
    "https://",
    ""
  )
  origin_id = "Lambda-API"
}

# Default: S3
default_cache_behavior {
  target_origin_id = "S3"
  # ... 既존設定
}

# API: Lambda
cache_behavior {
  path_pattern           = "/api/*"
  allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
  cached_methods         = ["GET", "HEAD"]
  target_origin_id       = "Lambda-API"
  default_ttl            = 0
  max_ttl                = 0
  min_ttl                = 0
  compress               = true
  viewer_protocol_policy = "redirect-to-https"
  
  forwarded_values {
    query_string = true
    headers      = ["*"]
    cookies {
      forward = "all"
    }
  }
}
```

### Terraform 変数追加

```hcl
# variables.tf
variable "lambda_function_url" {
  description = "Lambda Function URL for API origin"
  type        = string
  default     = ""
}

# terragrunt.hcl (environments/prod/cloudfront/)
inputs = {
  lambda_function_url = dependency.lambda_api.outputs.function_url  # 出力値から取得
}
```

## 既知の問題と決定が必要な事項

### 1. エンドポイントパス設計

**問題**: `/api/data` vs `/data`
- CloudFront で `/api/*` をルーティング
- Lambda で `/api/data` として処理するか、それとも `/data` として処理するか

**決定が必要**:
- [ ] Option A: Lambda エンドポイントを `/api/health`, `/api/data`, `/api/latest` に変更
- [ ] Option B: CloudFront で `origin_path` を使用してパスを除去
- [ ] Option C: CloudFront で Request Rewriting を使用（AWS 仕様確認が必要）

### 2. Raspberry Pi POST エンドポイント認証方法

**問題**: IAM Function URL が削除される → POST /data へのアクセスが失敗

**決定が必要**:
- [ ] Option A: API キーベース認証 (推奨)
- [ ] Option B: IP 制限
- [ ] Option C: API Gateway を追加

### 3. CloudFront Origin パス処理の実装確認

**問題**: `origin_path` パラメータが Lambda Function URL で動作するか未検証

**対応**:
- Terraform Apply 時に実装を確認
- 必要に応じて Lambda エンドポイントを変更

## 推奨実装方針

1. **CloudFront 変更**
   - Lambda origin を追加（Function URL ドメイン）
   - `/api/*` 用 cache_behavior を追加（TTL=0）
   - `lambda_function_url` 変数を定義

2. **Lambda Function URL 認証変更**
   - `create_iam_function_url = false` (IAM URL を削除)
   - `create_function_url = true` (パブリック URL を作成)

3. **Lambda POST エンドポイント保護**
   - API キーベース認証を実装
   - `POST /data` リクエストで `Authorization` ヘッダーを検証
   - 環境変数 `API_KEY` を追加

4. **エンドポイントパス処理**
   - 実装時に `origin_path` または Lambda 側の対応を検証
   - CloudFront → Lambda へのパス保持/除去を確認

5. **フロントエンド設定**
   - `.env.example`: `VITE_API_BASE_URL=/api` に更新
   - `src/domains/sensor/config/api.ts`: 変更不要（相対 URL で動作）

## 参考ドキュメント

- `ARCHITECTURE.md` - 認証アーキテクチャ（2026-04-05 更新）
- `terraform/modules/cloudfront/main.tf` - 現在の CloudFront 構成
- `terraform/modules/lambda-container/main.tf` - Lambda Function URL 実装
- `lambda/api/main.py` - FastAPI エンドポイント定義
- `src/domains/sensor/repository/SensorRepository.ts` - フロントエンド API 呼び出し
- AWS Terraform Provider: aws_cloudfront_distribution ドキュメント
- FastAPI: オリジンパス処理パターン

## 変更履歴

- 2026-04-06: 初期リサーチ作成
