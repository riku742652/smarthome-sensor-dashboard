# 実装計画: CloudFront に Lambda API オリジン（OAC方式）を追加

## Goal and Success Criteria

**Goal**: CloudFront OAC（Origin Access Control）を使用して `/api/*` → Lambda IAM Function URL のルーティングを追加し、フロントエンドが相対パス `/api` 経由で Lambda API を呼び出せるようにする。Lambda の IAM 認証は維持したまま、CloudFront が SigV4 署名を代理実行する。

**Success Criteria**:
- [ ] `https://<cloudfront-domain>/api/health` が Lambda の `/health` レスポンスを返す
- [ ] `https://<cloudfront-domain>/api/data?hours=24` がセンサーデータを返す
- [ ] `https://<cloudfront-domain>/api/latest` が最新センサーデータを返す
- [ ] Lambda IAM Function URL は引き続き有効で、Raspberry Pi から直接アクセスできる（変更なし）
- [ ] フロントエンドビルドで `VITE_API_BASE_URL=/api` が使用される（GitHubの Variable 設定不要）
- [ ] Terraform apply が正常に完了する
- [ ] 既存の CI（lint、typecheck、test）が通過する

---

## アーキテクチャ概要

### データフロー

```
ブラウザ → CloudFront (/api/*) → [CloudFront OAC で SigV4 署名] → Lambda IAM Function URL
Raspberry Pi → Lambda IAM Function URL（直接、変更なし）
```

### OAC 方式の特徴

- CloudFront が Lambda IAM Function URL を呼び出す際に、自動で SigV4 署名を付与する
- Lambda の認証タイプは `AWS_IAM` のまま維持
- フロントエンドは `Authorization` ヘッダーを送信しない（OAC が処理する）
- CloudFront サービスプリンシパル（`cloudfront.amazonaws.com`）から Lambda を呼び出すためのリソースポリシーが必要

---

## Architectural Changes

### Modified Files

- `terraform/modules/cloudfront/variables.tf` - `lambda_function_url` 変数を追加
- `terraform/modules/cloudfront/main.tf` - Lambda 用 OAC、Lambda オリジン、`/api/*` cache_behavior、CloudFront Function を追加
- `terraform/modules/lambda-container/variables.tf` - `cloudfront_distribution_arn` 変数を追加
- `terraform/modules/lambda-container/main.tf` - CloudFront → Lambda の `aws_lambda_permission` を追加
- `terraform/environments/prod/cloudfront/terragrunt.hcl` - `lambda-api` への dependency を追加
- `.github/workflows/frontend-deploy.yml` - `VITE_API_BASE_URL=/api` をハードコード

### 変更不要なファイル

- `terraform/environments/prod/lambda-api/terragrunt.hcl` - `create_iam_function_url = true` のまま変更不要
- `lambda/api/main.py` - Lambda コード変更不要
- Raspberry Pi クライアント（`smarthome-pi-client`）- 変更不要

### Dependencies

- 追加・削除なし（既存の AWS Terraform Provider で対応可能）

---

## Implementation Steps

### Step 1: CloudFront モジュールに Lambda Function URL 変数を追加

**Purpose**: CloudFront モジュールが Lambda IAM Function URL を受け取れるよう変数を定義する。

**Actions**:

1. `terraform/modules/cloudfront/variables.tf` に以下を追加する:

   ```hcl
   variable "lambda_function_url" {
     description = "Lambda IAM Function URL（API オリジン用）。空文字の場合は Lambda オリジンを作成しない"
     type        = string
     default     = ""
   }
   ```

**Completion Criteria**:
- [ ] `lambda_function_url` 変数が定義された
- [ ] デフォルト値が空文字（省略可能）になっている

**Files Affected**:
- `terraform/modules/cloudfront/variables.tf` (modified)

---

### Step 2: CloudFront モジュールに Lambda 用 OAC、オリジン、cache_behavior を追加

**Purpose**: CloudFront が `/api/*` リクエストを OAC（SigV4署名付き）で Lambda IAM URL に転送するための設定を追加する。パスのプレフィックス除去は CloudFront Function で行う。

**Actions**:

1. `terraform/modules/cloudfront/main.tf` に以下を追加する:

   **a. CloudFront Function（パスプレフィックス除去）**

   既存の `aws_cloudfront_distribution` リソースの前に CloudFront Function を定義する:

   ```hcl
   # /api/* → /* パスプレフィックスを除去する CloudFront Function
   resource "aws_cloudfront_function" "api_rewrite" {
     count   = var.lambda_function_url != "" ? 1 : 0
     name    = "${var.project_name}-${var.environment}-api-rewrite"
     runtime = "cloudfront-js-2.0"
     comment = "/api プレフィックスを除去して Lambda に転送する"
     publish = true

     code = <<-EOT
       async function handler(event) {
         var request = event.request;
         // /api/* → /* に書き換え（例: /api/data → /data、/api/health → /health）
         request.uri = request.uri.replace(/^\/api/, '');
         if (request.uri === '' || request.uri === undefined) {
           request.uri = '/';
         }
         return request;
       }
     EOT
   }
   ```

   **b. Lambda 用 OAC リソース**

   ```hcl
   # Lambda 用 Origin Access Control（IAM SigV4 署名を CloudFront が代理実行）
   resource "aws_cloudfront_origin_access_control" "lambda_api" {
     count                             = var.lambda_function_url != "" ? 1 : 0
     name                              = "${var.project_name}-${var.environment}-lambda-oac"
     description                       = "OAC for Lambda API origin"
     origin_access_control_origin_type = "lambda"
     signing_behavior                  = "always"
     signing_protocol                  = "sigv4"
   }
   ```

   **c. `aws_cloudfront_distribution` リソース内に Lambda オリジンと cache_behavior を追加**

   既存の `origin { ... }` ブロック（S3オリジン）の後に、Lambda オリジンを `dynamic` ブロックで追加する:

   ```hcl
   # Lambda IAM Function URL オリジン（lambda_function_url が設定されている場合のみ）
   dynamic "origin" {
     for_each = var.lambda_function_url != "" ? [1] : []
     content {
       # https:// および末尾スラッシュを除去してドメイン名のみ取得
       domain_name              = trimsuffix(replace(var.lambda_function_url, "https://", ""), "/")
       origin_id                = "Lambda-API"
       origin_access_control_id = aws_cloudfront_origin_access_control.lambda_api[0].id

       custom_origin_config {
         http_port              = 80
         https_port             = 443
         origin_protocol_policy = "https-only"
         origin_ssl_protocols   = ["TLSv1.2"]
       }
     }
   }
   ```

   既存の `default_cache_behavior` ブロックの後（`custom_error_response` の前）に `ordered_cache_behavior` を追加する:

   ```hcl
   # /api/* を Lambda にルーティング（キャッシュなし）
   dynamic "ordered_cache_behavior" {
     for_each = var.lambda_function_url != "" ? [1] : []
     content {
       path_pattern           = "/api/*"
       allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
       cached_methods         = ["GET", "HEAD"]
       target_origin_id       = "Lambda-API"
       compress               = true
       viewer_protocol_policy = "redirect-to-https"

       # API はキャッシュしない
       default_ttl = 0
       max_ttl     = 0
       min_ttl     = 0

       forwarded_values {
         # クエリ文字列を転送（/data?hours=24 の hours パラメータ保持）
         query_string = true
         # Authorization ヘッダーは不要（OAC が自動で SigV4 署名するため）
         headers = []
         cookies {
           forward = "none"
         }
       }

       # CloudFront Function でパスプレフィックスを除去
       function_association {
         event_type   = "viewer-request"
         function_arn = aws_cloudfront_function.api_rewrite[0].arn
       }
     }
   }
   ```

   **注意**: `ordered_cache_behavior` は優先度順に評価される。`/api/*` パターンが S3 の `default_cache_behavior` より先にマッチする。

**Completion Criteria**:
- [ ] `aws_cloudfront_function.api_rewrite` リソースが追加された
- [ ] `aws_cloudfront_origin_access_control.lambda_api` リソースが追加された（`origin_access_control_origin_type = "lambda"`）
- [ ] `dynamic "origin"` ブロックで Lambda オリジンが条件付きで追加された（`origin_access_control_id` 指定あり）
- [ ] `dynamic "ordered_cache_behavior"` ブロックで `/api/*` ルーティングが追加された
- [ ] `forwarded_values` に `Authorization` ヘッダーが含まれていない（OAC が処理するため不要）

**Files Affected**:
- `terraform/modules/cloudfront/main.tf` (modified)

---

### Step 3: Lambda モジュールに CloudFront distribution ARN 変数を追加

**Purpose**: CloudFront から Lambda IAM URL を呼び出すためのリソースポリシー（`aws_lambda_permission`）を追加する際に、CloudFront Distribution ARN を条件として指定できるようにする。

**Actions**:

1. `terraform/modules/lambda-container/variables.tf` に以下を追加する:

   ```hcl
   variable "cloudfront_distribution_arn" {
     description = "CloudFront Distribution ARN。設定された場合、CloudFront から Lambda IAM URL を呼び出すためのリソースポリシーを追加する"
     type        = string
     default     = ""
   }
   ```

**Completion Criteria**:
- [ ] `cloudfront_distribution_arn` 変数が定義された
- [ ] デフォルト値が空文字（省略可能）になっている

**Files Affected**:
- `terraform/modules/lambda-container/variables.tf` (modified)

---

### Step 4: Lambda モジュールに CloudFront 向けリソースポリシーを追加

**Purpose**: CloudFront の OAC が Lambda IAM Function URL を呼び出せるよう、`aws_lambda_permission` でサービスプリンシパルを許可する。`source_arn` は省略し、CloudFront サービスプリンシパルのみで許可する（chicken-and-egg 問題を回避するシンプルな方法）。

**Actions**:

1. `terraform/modules/lambda-container/main.tf` の最後に以下を追加する:

   ```hcl
   # CloudFront OAC から Lambda IAM Function URL を呼び出すためのリソースポリシー
   # create_iam_function_url = true かつ cloudfront_distribution_arn が設定されている場合のみ作成
   resource "aws_lambda_permission" "allow_cloudfront" {
     count         = var.create_iam_function_url && var.cloudfront_distribution_arn != "" ? 1 : 0
     statement_id  = "AllowCloudFrontServicePrincipal"
     action        = "lambda:InvokeFunctionUrl"
     function_name = aws_lambda_function.this.function_name
     principal     = "cloudfront.amazonaws.com"
     source_arn    = var.cloudfront_distribution_arn
   }
   ```

   **注意**:
   - `action` は `lambda:InvokeFunction` ではなく `lambda:InvokeFunctionUrl` を使用する（Function URL 経由のアクセス用）
   - `source_arn` に CloudFront Distribution ARN を指定することで、特定の Distribution のみが呼び出せるよう制限できる
   - `cloudfront_distribution_arn` が空文字（初回 apply 時など）の場合はリソースが作成されない

**Completion Criteria**:
- [ ] `aws_lambda_permission.allow_cloudfront` リソースが追加された
- [ ] `create_iam_function_url = true` かつ `cloudfront_distribution_arn != ""` の場合のみ作成される条件になっている
- [ ] `principal = "cloudfront.amazonaws.com"` が設定されている

**Files Affected**:
- `terraform/modules/lambda-container/main.tf` (modified)

---

### Step 5: Terragrunt cloudfront に lambda-api 依存関係を追加

**Purpose**: `cloudfront` の Terragrunt が `lambda-api` の outputs（`iam_function_url`）を参照できるようにする。

**Actions**:

1. `terraform/environments/prod/cloudfront/terragrunt.hcl` を以下のように更新する:

   ```hcl
   include "root" {
     path = find_in_parent_folders()
   }

   terraform {
     source = "../../../modules/cloudfront"
   }

   # lambda-api の outputs を参照するための依存関係
   dependency "lambda_api" {
     config_path = "../lambda-api"

     mock_outputs = {
       iam_function_url = "https://mock.lambda-url.ap-northeast-1.on.aws/"
     }
     mock_outputs_allowed_terraform_commands = ["plan", "validate"]
   }

   inputs = {
     price_class         = "PriceClass_200" # US, Europe, Asia, Middle East, Africa
     default_cache_ttl   = 3600             # 1 hour
     max_cache_ttl       = 86400            # 24 hours
     lambda_function_url = dependency.lambda_api.outputs.iam_function_url
   }
   ```

   **注意**: `dependency.lambda_api.outputs.iam_function_url` を使用する（IAM Function URL が対象）。

**Completion Criteria**:
- [ ] `dependency "lambda_api"` ブロックが追加された
- [ ] `mock_outputs` に `iam_function_url` が設定されている
- [ ] `lambda_function_url = dependency.lambda_api.outputs.iam_function_url` が `inputs` に追加された

**Files Affected**:
- `terraform/environments/prod/cloudfront/terragrunt.hcl` (modified)

---

### Step 6: Terraform apply とリソースポリシーの設定

**Purpose**: OAC を有効化するには、CloudFront Distribution の ARN を Lambda のリソースポリシーに追加する必要がある。apply は 2 ステップで行う。

**Actions**:

1. **第1フェーズ: CloudFront と Lambda を apply する**

   まず `lambda-api` を apply する（`cloudfront_distribution_arn` は空のまま）:
   ```
   cloudfront_distribution_arn は空文字のため aws_lambda_permission.allow_cloudfront は作成されない
   ```

   次に `cloudfront` を apply する（Lambda OAC と `/api/*` behavior が作成される）:
   ```
   この時点では Lambda リソースポリシーがないため、CloudFront → Lambda は 403 になる
   ```

2. **第2フェーズ: CloudFront ARN を Lambda に伝えて再 apply**

   `terraform/environments/prod/lambda-api/terragrunt.hcl` に CloudFront ARN の dependency を追加して再 apply する:

   ```hcl
   # cloudfront の outputs を参照するための依存関係
   dependency "cloudfront" {
     config_path = "../cloudfront"

     mock_outputs = {
       cloudfront_distribution_arn = "arn:aws:cloudfront::123456789012:distribution/mock"
     }
     mock_outputs_allowed_terraform_commands = ["plan", "validate"]
   }
   ```

   そして `inputs` に追加する:
   ```hcl
   cloudfront_distribution_arn = dependency.cloudfront.outputs.cloudfront_distribution_arn
   ```

   この再 apply で `aws_lambda_permission.allow_cloudfront` が作成され、CloudFront → Lambda の接続が完成する。

3. CloudFront outputs に `cloudfront_distribution_arn` を追加する必要があるため、`terraform/modules/cloudfront/outputs.tf` を確認して `aws_cloudfront_distribution.frontend.arn` が出力されているか確認する。なければ追加する。

**Completion Criteria**:
- [ ] `terraform/environments/prod/lambda-api/terragrunt.hcl` に `dependency "cloudfront"` が追加された
- [ ] `cloudfront_distribution_arn` が `inputs` に設定された
- [ ] `terraform/modules/cloudfront/outputs.tf` に `cloudfront_distribution_arn` の出力が確認または追加された

**Files Affected**:
- `terraform/environments/prod/lambda-api/terragrunt.hcl` (modified)
- `terraform/modules/cloudfront/outputs.tf` (確認、必要に応じて modified)

---

### Step 7: フロントエンドデプロイワークフローの環境変数をハードコード

**Purpose**: `VITE_API_BASE_URL` を GitHub Variable に依存せず `/api` に固定する。Variable が未設定でも CI がエラーにならない状態にする。

**Actions**:

1. `.github/workflows/frontend-deploy.yml` を編集する

   変更前:
   ```yaml
   env:
     TERRAGRUNT_NON_INTERACTIVE: "true"
     VITE_USE_MOCK_DATA: ${{ vars.VITE_USE_MOCK_DATA || 'false' }}
     VITE_API_BASE_URL: ${{ vars.VITE_API_BASE_URL }}
   ```

   変更後:
   ```yaml
   env:
     TERRAGRUNT_NON_INTERACTIVE: "true"
     VITE_USE_MOCK_DATA: ${{ vars.VITE_USE_MOCK_DATA || 'false' }}
     # CloudFront の /api/* → Lambda OAC ルーティングを使用するため /api に固定
     VITE_API_BASE_URL: "/api"
   ```

2. バリデーションステップを更新する（`VITE_API_BASE_URL` が常に設定済みになるため、エラー条件を削除）:

   変更前:
   ```yaml
   - name: Validate frontend API env configuration
     run: |
       echo "VITE_USE_MOCK_DATA=${VITE_USE_MOCK_DATA}"
       if [ "${VITE_USE_MOCK_DATA}" != "true" ] && [ -z "${VITE_API_BASE_URL}" ]; then
         echo "::error::VITE_API_BASE_URL is required when VITE_USE_MOCK_DATA is not 'true'. Set repository variable VITE_API_BASE_URL."
         exit 1
       fi
   ```

   変更後:
   ```yaml
   - name: Validate frontend API env configuration
     run: |
       echo "VITE_USE_MOCK_DATA=${VITE_USE_MOCK_DATA}"
       echo "VITE_API_BASE_URL=${VITE_API_BASE_URL}"
   ```

**Completion Criteria**:
- [ ] `VITE_API_BASE_URL` が `/api` にハードコードされた
- [ ] GitHub Variable `VITE_API_BASE_URL` への依存が除去された
- [ ] バリデーションステップが変数の実際の値をログ出力するようになっている

**Files Affected**:
- `.github/workflows/frontend-deploy.yml` (modified)

---

### Step 8: ARCHITECTURE.md の認証アーキテクチャを更新

**Purpose**: OAC 方式への移行を記録する。ARCHITECTURE.md が実態と乖離しないようにする。

**Actions**:

1. `ARCHITECTURE.md` の BLE センサーデータフロー図を更新する:

   変更前:
   ```
   SwitchBot CO2センサー --BLE--> Raspberry Pi --HTTP POST (SigV4署名)--> Lambda API (IAM認証 Function URL) --> DynamoDB
   ```

   変更後:
   ```
   SwitchBot CO2センサー --BLE--> Raspberry Pi --HTTP POST (SigV4署名)--> Lambda API (IAM認証 Function URL) --> DynamoDB
                                                         ↑
   ブラウザ --> CloudFront (/api/*) --[OAC: SigV4署名]--> Lambda API (IAM認証 Function URL)
   ```

2. 認証アーキテクチャ説明セクションを更新する:

   変更前:
   ```
   - `GET /data`, `GET /latest`: 現在 IAM 認証 Function URL 経由のため、パブリックアクセスできない。フロントエンド向けの公開方法が別途必要...
   - `POST /data`: AWS IAM 認証専用の Function URL 経由でアクセス。Raspberry Pi は SigV4 署名付きリクエストを送信
   - **重要**: Lambda は単一の Function URL のみ作成可能...
   ```

   変更後:
   ```
   - `GET /data`, `GET /latest`: CloudFront `/api/*` → OAC 経由でアクセス可能。フロントエンドから相対パス `/api` で呼び出す。CloudFront が SigV4 署名を代理実行する
   - `POST /data`: IAM 認証 Function URL 経由でアクセス。Raspberry Pi は SigV4 署名付きリクエストを直接送信（変更なし）
   - **CloudFront OAC 方式**: `GET` 系エンドポイントへのフロントエンドアクセスは CloudFront `/api/*` 経由。OAC（`origin_access_control_origin_type = "lambda"`）が自動で SigV4 署名を付与し、Lambda IAM URL を呼び出す
   ```

3. 変更履歴に追記する:
   ```
   - 2026-04-06: CloudFront OAC 方式で Lambda API オリジンを追加。IAM Function URL は維持したまま、CloudFront が SigV4 署名を代理実行。フロントエンドが /api 経由で Lambda にアクセス可能に
   ```

**Completion Criteria**:
- [ ] BLE データフロー図が更新された
- [ ] 認証アーキテクチャの説明が OAC 方式を反映している
- [ ] 変更履歴に追記された

**Files Affected**:
- `ARCHITECTURE.md` (modified)

---

## Test Strategy

### Terraform 構文チェック

各モジュールで以下を実行:
```bash
cd terraform/modules/cloudfront
terraform validate

cd terraform/modules/lambda-container
terraform validate

cd terraform/environments/prod/cloudfront
terragrunt validate

cd terraform/environments/prod/lambda-api
terragrunt validate
```

### 手動テスト（Terraform Apply 後）

- [ ] `curl https://<cloudfront-domain>/api/health` → `{"status":"ok","message":"Healthy"}` が返る
- [ ] `curl "https://<cloudfront-domain>/api/data?hours=1"` → センサーデータが返る
- [ ] `curl https://<cloudfront-domain>/api/latest` → 最新センサーデータが返る
- [ ] Raspberry Pi から Lambda IAM URL に直接 POST できる（変更なし）
- [ ] フロントエンドのダッシュボードページでセンサーデータが表示される

---

## Known Risks and Constraints

### Technical Risks

- **Chicken-and-egg 問題（CloudFront ARN と Lambda リソースポリシー）**
  - **Impact**: Medium
  - **詳細**: `aws_lambda_permission.allow_cloudfront` の `source_arn` に CloudFront Distribution ARN が必要だが、CloudFront は Lambda の ARN を使って作成される。初回は循環依存が発生する
  - **Mitigation**: Step 6 に記載の通り、2ステップ apply で解決する。第1フェーズで CloudFront を apply → 第2フェーズで `cloudfront_distribution_arn` を lambda-api に渡して再 apply する。または `source_arn` を省略して CloudFront サービスプリンシパルのみで許可することでシンプルに解決できる（セキュリティは若干下がるが、ホームプロジェクトでは許容範囲）

- **CloudFront OAC for Lambda の対応状況**
  - **Impact**: Medium
  - **詳細**: `origin_access_control_origin_type = "lambda"` は AWS Provider バージョン 5.x 以降でサポート。現在の Terraform Provider バージョンを確認する必要がある
  - **Mitigation**: `terraform/modules/cloudfront` または root `terragrunt.hcl` で required_providers の aws バージョン制約を確認する

- **Lambda Function URL のドメイン形式**
  - **Impact**: Low
  - **詳細**: IAM Function URL は `https://<id>.lambda-url.<region>.on.aws/` の形式。`trimsuffix` と `replace` でドメイン名のみを抽出する必要がある
  - **Mitigation**: Step 2 の `domain_name = trimsuffix(replace(var.lambda_function_url, "https://", ""), "/")` で対応済み

- **CloudFront の `dynamic` ブロックと既存リソースの互換性**
  - **Impact**: Low
  - **詳細**: `origin` ブロックと `ordered_cache_behavior` ブロックを `dynamic` で追加することで、既存のリソース定義に変更が生じる。Terraform の plan で既存リソースへの影響がないことを確認する
  - **Mitigation**: `terragrunt plan` で既存の S3 オリジン・デフォルト cache_behavior が変更されないことを確認してから apply する

### Constraints

- **CloudFront のデプロイ時間**: CloudFront の変更適用には数分かかる場合がある
- **Raspberry Pi クライアント**: Lambda IAM Function URL と認証方式は変更しないため、`smarthome-pi-client` の変更は不要

---

## Alternative Approaches Considered

### Approach A: Lambda をパブリック URL に変更 + API キー認証（旧計画、採用せず）

- **Pros**: シンプルな設定
- **Cons**: IAM 認証を廃止するため Raspberry Pi の認証変更が必要。アプリレベルの API キー認証への移行コストが高い
- **Decision**: 採用せず。IAM 認証を維持したいというユーザー要件に合わない

### Approach B: CloudFront OAC で Lambda IAM URL に直接ルーティング（採用）

- **Pros**: Lambda の認証方式（AWS_IAM）を変更しない。Raspberry Pi への影響なし。CloudFront が SigV4 署名を代理実行するため、フロントエンドは普通の HTTP リクエストを送ればよい
- **Cons**: 初回 apply 時に chicken-and-egg 問題が発生するため 2 ステップ apply が必要。`origin_access_control_origin_type = "lambda"` のサポート状況を確認する必要がある
- **Decision**: 採用。ユーザー要件（IAM 認証維持）を満たし、Raspberry Pi への影響もない

### Approach C: source_arn 省略でシンプル化

- **Pros**: Chicken-and-egg 問題が発生しない。2 ステップ apply が不要
- **Cons**: CloudFront Distribution を特定しないため、同一アカウントの他の CloudFront Distribution からも Lambda を呼び出せてしまう（ホームプロジェクトでは実質問題なし）
- **Decision**: 実装時に executor が判断する。シンプルさを優先するなら Approach C、セキュリティを優先するなら Approach B（2ステップ apply）を選択する

---

## Post-Implementation Tasks

- [ ] `ARCHITECTURE.md` の認証アーキテクチャを更新（Step 8 で実施）
- [ ] GitHub Repository Variable `VITE_API_BASE_URL` の削除（不要になるため）
- [ ] 計画を `docs/exec-plans/completed/` に移動
- [ ] `docs/exec-plans/tech-debt-tracker.md` の該当テック負債エントリを解消済みにマーク

---

## 変更履歴

- 2026-04-06: 初期計画作成（パブリック URL + API キー認証方式）
- 2026-04-06: OAC 方式に全面更新。IAM 認証維持、Raspberry Pi への影響なし、CloudFront が SigV4 署名を代理実行する方式に変更
