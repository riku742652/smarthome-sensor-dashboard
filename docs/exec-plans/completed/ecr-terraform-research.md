# ECR Terraform 管理化に関する調査報告書

**調査日**: 2026-03-31
**調査対象**: Lambda コンテナイメージの ECR リポジトリ Terraform 管理化
**ステータス**: 完了

---

## 1. タスク理解

### 目標
- `terraform/modules/lambda-container/` モジュールに ECR リポジトリ管理機能を追加する
- 現在ハードコードされている `image_uri` を動的に生成する
- ECR リポジトリの lifecycle policy を設定する
- Terraform の依存管理によって、ECR 作成 → イメージプッシュ → Lambda 作成の順序を保証する

### 成功基準
1. ECR リポジトリが Terraform で完全に管理される
2. `image_uri` が ECR outputs から動的に取得される
3. Lambda apply 時に ECR イメージが存在しないことによるエラーが解消される
4. 古いイメージの自動削除が設定される

---

## 2. 現状分析

### 2.1 既存のコード構造

#### Lambda Container モジュール
- **ファイル**:
  - `terraform/modules/lambda-container/main.tf` (72行)
  - `terraform/modules/lambda-container/variables.tf` (50行)
  - `terraform/modules/lambda-container/outputs.tf` (20行)

- **現在の実装**:
  ```hcl
  resource "aws_lambda_function" "this" {
    function_name = "${var.project_name}-${var.environment}-${var.function_name}"
    role          = aws_iam_role.lambda_role.arn
    package_type  = "Image"
    image_uri     = var.image_uri          # ← ハードコード前提
    timeout       = var.timeout
    memory_size   = var.memory_size
    environment { variables = var.environment_variables }
    tags = {...}
  }
  ```

- **IAM 権限**:
  - `AWSLambdaBasicExecutionRole` を自動attach
  - DynamoDB アクセス権限を条件付きで付与（`dynamodb_table_arn != ""` 時）

- **Lambda Function URL**:
  - `authorization_type = "NONE"` で public access を許可
  - CORS 有効（allow-all）

#### Lambda API Terragrunt 設定
- **ファイル**: `terraform/environments/prod/lambda-api/terragrunt.hcl`
- **現在の image_uri**:
  ```hcl
  image_uri = "${get_env("AWS_ACCOUNT_ID", "123456789012")}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest"
  ```
  - 環境変数 `AWS_ACCOUNT_ID` から アカウントID を取得
  - ハードコードされたリポジトリ名: `smarthome-sensor-api`
  - タグ: `latest` (固定)

#### Lambda Poller Terragrunt 設定
- **ファイル**: `terraform/environments/prod/lambda-poller/terragrunt.hcl`
- **実装方式**: 従来の ZIP ベースデプロイ
  - `terraform/modules/lambda` を使用（コンテナではなく Python コード直接）
  - `source_dir = "${get_repo_root()}/lambda/poller"` で zip を作成

#### Dockerfile
- **ファイル**: `lambda/api/Dockerfile`
- 基盤イメージ: `public.ecr.aws/lambda/python:3.11`
- Lambda Web Adapter を `COPY --from` で含める
- uvicorn で FastAPI を起動

### 2.2 既存パターンの確認

#### モジュール構造
- `dynamodb`, `lambda`, `cloudfront` モジュール存在
- 各モジュール は独立したリソース管理を行う
- `main.tf`, `variables.tf`, `outputs.tf` の 3 ファイル構成（標準）

#### IAM ロール管理パターン
- Lambda ロール作成は **モジュール内で完結**
- DynamoDB アクセスは `count` で条件付き付与
- 例:
  ```hcl
  resource "aws_iam_role_policy" "lambda_dynamodb" {
    count = var.dynamodb_table_arn != "" ? 1 : 0
    role  = aws_iam_role.lambda_role.id
    name  = "dynamodb-access"
    policy = jsonencode({...})
  }
  ```

#### Terragrunt の依存管理
- `dependency` ブロックで他モジュール出力を参照
- `mock_outputs` で plan/validate 時の値を提供
- `mock_outputs_allowed_terraform_commands` で実行制御
- 例 (lambda-api):
  ```hcl
  dependency "dynamodb" {
    config_path = "../dynamodb"
    mock_outputs = {
      table_arn  = "arn:aws:dynamodb:ap-northeast-1:123456789012:table/mock-table"
      table_name = "mock-table"
    }
    mock_outputs_allowed_terraform_commands = ["plan", "validate"]
  }
  ```

#### 環境変数利用パターン
- `get_env()` で環境変数を読み取り
- デフォルト値を提供（存在しない場合は空文字列など）
- CI/CD ワークフロー内で `env:` セクションで設定

### 2.3 プロバイダーバージョン

- **Terraform**: `~> 1.5` (実装時 1.14.8)
- **AWS Provider**: `~> 6.0` (実装時 6.38.0)
- ECR リソースタイプは AWS 6.0 で全て利用可能

### 2.4 GitHub Actions ワークフロー

#### Terraform CI (`terraform-ci.yml`)
- **検証フェーズ**:
  - `terraform fmt --check` (format check)
  - `terraform validate` (各モジュール)
  - `terragrunt hcl fmt --check`

- **計画フェーズ** (PR のみ):
  - 各環境で `terragrunt plan` 実行
  - Trivy セキュリティスキャン実行
  - plan 結果を PR コメントに投稿

#### Terraform Apply (`terraform-apply.yml`)
- **手動トリガー**:
  - 環境選択 (all/dynamodb/lambda-api/lambda-poller/cloudfront)
  - Dry run オプション (plan のみ)

- **実行内容**:
  - AWS OIDC 認証（`AWS_ROLE_ARN`）
  - `terragrunt run-all` または `terragrunt apply`
  - `TERRAGRUNT_NON_INTERACTIVE=true` で対話防止

---

## 3. 技術コンテキスト

### 3.1 AWS ECR リソース (Terraform AWS Provider)

#### 必要な リソースタイプ

1. **`aws_ecr_repository`** - ECR リポジトリ作成
   - 必須パラメータ: `name`
   - 主要パラメータ:
     - `image_tag_mutability` - タグ上書き可否 (IMMUTABLE推奨)
     - `image_scanning_configuration` - イメージスキャン有効化
     - `encryption_configuration` - 暗号化設定
     - `force_delete` - 削除時の強制削除

2. **`aws_ecr_lifecycle_policy`** - ライフサイクルポリシー
   - 古いイメージの自動削除を制御
   - JSON ポリシードキュメント形式
   - 例:
     ```json
     {
       "rules": [
         {
           "rulePriority": 1,
           "description": "Keep last 10 images",
           "selection": {
             "tagStatus": "any",
             "countType": "imageCountMoreThan",
             "countNumber": 10
           },
           "action": {
             "type": "expire"
           }
         }
       ]
     }
     ```

3. **`aws_ecr_pull_through_cache_rule`** - プルスルーキャッシュ (オプション)
   - 公開イメージをキャッシュする場合に使用

#### 出力値

- `aws_ecr_repository.this.repository_url` - リポジトリURI
  - 形式: `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPOSITORY_NAME>`
  - Lambda `image_uri` に直接使用可能

- `aws_ecr_repository.this.repository_arn` - リポジトリ ARN

- `aws_ecr_repository.this.registry_id` - レジストリID（アカウントID）

### 3.2 IAM 権限

ECR リポジトリへのアクセスに必要な権限:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "arn:aws:ecr:ap-northeast-1:ACCOUNT_ID:repository/smarthome-sensor-api"
    },
    {
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    }
  ]
}
```

**重要**: Lambda がコンテナイメージを pull するには:
- Lambda 実行ロールに上記権限が必要
- 現在の `AWSLambdaBasicExecutionRole` には ECR 権限が **含まれない**

### 3.3 イメージのプッシュタイミング

#### 現在の手動プロセス
```bash
# ユーザーが手動で実行
cd lambda/api
docker build --platform linux/amd64 -t smarthome-sensor-api:latest .
aws ecr get-login-password --region ap-northeast-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com
docker tag smarthome-sensor-api:latest \
  <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest
docker push <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest
```

#### 自動化の課題
- GitHub Actions では Docker buildx を使って ECR に直接 push 可能
- Terraform apply の **前に** イメージが push されている必要がある
- Terragrunt の依存管理は Terraform リソース間のみ（外部 CI/CD ステップは含まない）

### 3.4 Placeholder イメージの使用

Lambda apply 時に ECR イメージが存在しない場合:
- **オプション 1**: `null_resource` で apply 前に検証ステップを追加
- **オプション 2**: Terraform locals で条件付きリポジトリ作成
- **オプション 3**: 開発段階では「イメージが存在しない」エラーを受け入れる（CI/CD で完全に自動化される前提）

---

## 4. 制約と考慮事項

### 4.1 パフォーマンス
- ECR リポジトリ作成: 数秒
- ライフサイクルポリシー適用: 即座
- イメージ push: ネットワーク依存（数十秒～数分）

### 4.2 セキュリティ
- ECR リポジトリはデフォルト private
- `image_tag_mutability = "MUTABLE"` (デフォルト) は本番環境では `IMMUTABLE` 推奨
- スキャン設定: オプションだが有効化推奨

### 4.3 信頼性
- イメージプッシュ失敗時の再試行メカニズムが必要
- Terraform の idempotency を確保（リポジトリ存在時の再create を防ぐ）

### 4.4 既存の依存関係
1. **DynamoDB への依存**
   - lambda-api は DynamoDB の outputs を使用中
   - ECR リポジトリ追加後も DynamoDB 依存は変わらない

2. **IAM ロール管理**
   - 現在 Lambda ロールは lambda-container モジュール内で管理
   - ECR pull 権限追加により IAM ポリシーを拡張

3. **イメージタグ管理**
   - 現在 `latest` タグ固定
   - 本番運用では タグ戦略（SHA, semantic versioning など）を検討

---

## 5. 関連するコード例と参考資料

### 5.1 既存モジュールの参考

#### DynamoDB モジュール構造 (`terraform/modules/dynamodb/main.tf`)
```hcl
resource "aws_dynamodb_table" "sensor_data" {
  name         = "${var.project_name}-${var.environment}-sensor-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "deviceId"
  range_key    = "timestamp"

  attribute {
    name = "deviceId"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "N"
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-sensor-data"
    Project     = var.project_name
    Environment = var.environment
  }
}
```

**学習点**:
- リソース命名: `${var.project_name}-${var.environment}-リソース種別`
- タグは一貫性を持たせる（Name, Project, Environment）

#### Terragrunt の依存参照 (`lambda-api/terragrunt.hcl`)
```hcl
dependency "dynamodb" {
  config_path = "../dynamodb"

  mock_outputs = {
    table_arn  = "arn:aws:dynamodb:ap-northeast-1:123456789012:table/mock-table"
    table_name = "mock-table"
  }
  mock_outputs_allowed_terraform_commands = ["plan", "validate"]
}

inputs = {
  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn
  environment_variables = {
    TABLE_NAME = dependency.dynamodb.outputs.table_name
  }
}
```

**学習点**:
- `config_path` は相対パス（`../`）で参照
- mock は plan/validate 時のみ使用可能（本番apply時は実リソースから取得）

### 5.2 AWS Provider ドキュメント参照

- `aws_ecr_repository` - リポジトリ管理
- `aws_ecr_lifecycle_policy` - ポリシー管理
- `aws_iam_role_policy` - IAM インラインポリシー

---

## 6. 潜在的な課題

### 6.1 イメージプッシュの順序保証

**問題**: Terraform は ECR リポジトリは create できるが、イメージの push は外部タスク（Docker コマンドまたは GitHub Actions）

**可能な解決策**:
- **A) GitHub Actions で 2 段階化**
  1. Docker build & push to ECR
  2. Terraform apply

- **B) Terraform の `null_resource` + `local-exec` で push を試行**
  ```hcl
  resource "null_resource" "ecr_image_push" {
    provisioner "local-exec" {
      command = "aws ecr get-login-password ... | docker push ..."
    }
    depends_on = [aws_ecr_repository.this]
  }
  ```
  - **長所**: Terraform apply で完全自動化
  - **短所**: local-exec はCI/CD環境に依存、idempotency 低い

- **C) Terraform の `depends_on` でカバー（推奨）**
  - ECR リポジトリ作成後、apply 前にスクリプト実行（GitHub Actions で制御）
  - Lambda create は ECR リポジトリと image existence に暗黙依存

### 6.2 IAM 権限の拡張

**現在**: Lambda ロールが ECR pull 権限を持たない

**対応**:
```hcl
resource "aws_iam_role_policy" "lambda_ecr" {
  role = aws_iam_role.lambda_role.id
  name = "ecr-pull"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability"
      ]
      Resource = var.ecr_repository_arn
    }, {
      Effect = "Allow"
      Action = "ecr:GetAuthorizationToken"
      Resource = "*"
    }]
  })
}
```

### 6.3 複数環境・複数 Lambda への対応

**現状**: lambda-api のみコンテナベース

**将来検討事項**:
- lambda-poller もコンテナ化する場合、別々のリポジトリか共有リポジトリか
- ECR リポジトリモジュールを独立させるか lambda-container に統合するか

---

## 7. 設計上の推奨

### 7.1 ECR リポジトリの配置

#### オプション A: lambda-container モジュール内に統合（推奨）

**長所**:
- Lambda と ECR が同じモジュールで管理される
- lambda-container の使用者は ECR リポジトリの作成と Lambda デプロイを同時に実行可能
- シンプルで理解しやすい

**短所**:
- 複数 Lambda で同じリポジトリを共有する場合、冗長になる可能性

**実装イメージ**:
```hcl
# modules/lambda-container/main.tf

resource "aws_ecr_repository" "this" {
  name                 = var.ecr_repository_name
  image_tag_mutability = var.image_tag_mutability
  force_delete         = var.force_delete

  image_scanning_configuration {
    scan_on_push = var.scan_on_push
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.function_name}"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name
  policy     = var.lifecycle_policy
}

# image_uri を ECR repository から動的に生成
locals {
  image_uri = var.image_uri != "" ? var.image_uri : "${aws_ecr_repository.this.repository_url}:${var.image_tag}"
}

resource "aws_lambda_function" "this" {
  # ...
  image_uri = local.image_uri
  # ...
}
```

#### オプション B: 独立した ecr モジュール

**長所**:
- ECR と Lambda が独立していて、複数 Lambda で共有可能
- 将来的に ECR のみを更新する柔軟性

**短所**:
- Terragrunt 依存管理が複雑になる
- 新しいファイル・フォルダ構造が増える

### 7.2 ライフサイクルポリシー設定

**推奨ポリシー**:
```hcl
variable "lifecycle_policy" {
  type = string
  default = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep latest 10 images, expire others"
        selection = {
          tagStatus       = "any"
          countType       = "imageCountMoreThan"
          countNumber     = 10
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Expire images older than 30 days"
        selection = {
          tagStatus             = "any"
          countType             = "sinceImagePushed"
          countUnit             = "days"
          countNumber           = 30
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
```

### 7.3 Variables 設計

#### 新規追加変数の提案

```hcl
# ECR リポジトリ管理
variable "create_ecr_repository" {
  description = "Whether to create ECR repository"
  type        = bool
  default     = true
}

variable "ecr_repository_name" {
  description = "ECR repository name (auto-generated if null)"
  type        = string
  default     = null
}

variable "image_uri" {
  description = "Full ECR image URI. If provided, overrides auto-generated URI"
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Container image tag"
  type        = string
  default     = "latest"
}

variable "image_tag_mutability" {
  description = "Image tag mutability (MUTABLE or IMMUTABLE)"
  type        = string
  default     = "MUTABLE"

  validation {
    condition     = contains(["MUTABLE", "IMMUTABLE"], var.image_tag_mutability)
    error_message = "image_tag_mutability must be MUTABLE or IMMUTABLE"
  }
}

variable "scan_on_push" {
  description = "Enable image scanning on push"
  type        = bool
  default     = true
}

variable "force_delete" {
  description = "Force delete ECR repository with images"
  type        = bool
  default     = false
}

variable "lifecycle_policy" {
  description = "ECR lifecycle policy JSON"
  type        = string
  default     = ""
}
```

#### Variables の互換性

- 既存の `image_uri` 変数はそのまま使用可能
- `image_uri` が空でない場合は優先（後方互換性確保）
- 新規環境では `create_ecr_repository = true` で ECR リポジトリ自動作成

### 7.4 Outputs 設計

```hcl
output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = var.create_ecr_repository ? aws_ecr_repository.this[0].repository_url : null
}

output "ecr_repository_arn" {
  description = "ECR repository ARN"
  value       = var.create_ecr_repository ? aws_ecr_repository.this[0].arn : null
}

output "ecr_registry_id" {
  description = "ECR registry ID (AWS Account ID)"
  value       = var.create_ecr_repository ? aws_ecr_repository.this[0].registry_id : null
}

output "lambda_function_image_uri" {
  description = "Lambda function image URI"
  value       = aws_lambda_function.this.image_uri
}
```

---

## 8. Terragrunt での使用例

### lambda-api/terragrunt.hcl の推奨変更

```hcl
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/lambda-container"
}

dependency "dynamodb" {
  config_path = "../dynamodb"
  mock_outputs = {
    table_arn  = "arn:aws:dynamodb:ap-northeast-1:123456789012:table/mock-table"
    table_name = "mock-table"
  }
  mock_outputs_allowed_terraform_commands = ["plan", "validate"]
}

inputs = {
  function_name = "api"
  timeout       = 30
  memory_size   = 512

  # ECR リポジトリ設定
  create_ecr_repository = true
  ecr_repository_name   = "smarthome-sensor-api"
  image_tag             = "latest"
  image_tag_mutability  = "IMMUTABLE"  # 本番環境では推奨
  scan_on_push          = true

  # image_uri を明示的に指定する必要はなくなる（auto-generated）
  # 必要に応じて上書き:
  # image_uri = "${get_env("AWS_ACCOUNT_ID", "123456789012")}.dkr.ecr.ap-northeast-1.amazonaws.com/custom-repo:v1.0"

  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn

  environment_variables = {
    TABLE_NAME = dependency.dynamodb.outputs.table_name
    DEVICE_ID  = get_env("SWITCHBOT_DEVICE_ID", "")
  }
}
```

---

## 9. 実装上の注意点

### 9.1 段階的実装戦略

1. **Phase 1: ECR リポジトリ管理を lambda-container に追加**
   - `aws_ecr_repository` + `aws_ecr_lifecycle_policy` 追加
   - variables と outputs 拡張
   - `create_ecr_repository` フラグで オプション化

2. **Phase 2: IAM 権限を拡張**
   - Lambda IAM ロールに ECR pull 権限追加
   - `aws_iam_role_policy` で ecr:GetDownloadUrlForLayer 等を許可

3. **Phase 3: Terragrunt 設定を更新**
   - lambda-api/terragrunt.hcl で ECR 設定を入力
   - `image_uri` の生成ロジック変更

4. **Phase 4: GitHub Actions イメージプッシュ自動化**
   - Terraform plan/apply 前に Docker push を実行

### 9.2 後方互換性

- 既存の `image_uri` パラメータを指定した場合、ECR リポジトリを create しない
- `create_ecr_repository = false` で明示的に無効化可能
- 既存環境の apply には影響なし

### 9.3 開発環境での検証

- Plan 時の動作確認（mock_outputs で検証）
- 小規模な別リポジトリで テスト
- `terraform validate` + `terraform fmt` で構文確認

---

## 10. 代替案と比較

### 代替案 1: ECR リポジトリは Terraform 管理、イメージプッシュは CI/CD タスク

**メリット**:
- シンプル、Terraform の責任が明確
- GitHub Actions で Docker build/push を完全制御
- Terraform と CI/CD の関心分離

**デメリット**:
- Terraform apply 前にイメージが存在しない場合、エラー
- 依存順序を CI/CD で明示的に管理する必要あり

**推奨**: ✅ **こちらを推奨**

---

## 11. 推奨される実装順序

```
1. modules/lambda-container/variables.tf に新変数追加
2. modules/lambda-container/main.tf に ECR リソース追加
3. modules/lambda-container/outputs.tf に ECR outputs 追加
4. modules/lambda-container/main.tf で IAM 権限拡張
5. terraform/environments/prod/lambda-api/terragrunt.hcl を更新
6. GitHub Actions で イメージプッシュをplan/apply前に実行
7. terraform plan/apply で動作確認
```

---

## 12. リスク評価

| リスク | 確度 | 影響度 | 対応策 |
|--------|------|--------|--------|
| イメージが存在しないまま Lambda apply | 中 | 高 | GitHub Actions で apply 前にプッシュ確認 |
| IAM 権限不足で Lambda が起動できない | 低 | 高 | ECR pull 権限の明示的な付与・テスト |
| 複数環境での ECR リポジトリ名衝突 | 低 | 中 | 環境別にリポジトリ名を分ける |
| Terraform state の不整合 | 低 | 高 | `terraform import` で既存リポジトリを import |
| ライフサイクルポリシーが削除されるイメージ中 | 中 | 中 | 保持ルール（10個+30日）を適切に設定 |

---

## 13. 参考資料

### AWS Terraform Provider ドキュメント
- [`aws_ecr_repository`](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecr_repository)
- [`aws_ecr_lifecycle_policy`](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecr_lifecycle_policy)
- [`aws_iam_role_policy`](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role_policy)

### プロジェクト内の参考
- `terraform/modules/dynamodb/main.tf` - モジュール構造の参考
- `terraform/environments/prod/lambda-api/terragrunt.hcl` - Terragrunt 依存管理の参考
- `.github/workflows/terraform-apply.yml` - CI/CD 統合の参考

### 関連する AWS ドキュメント
- [ECR ライフサイクルポリシー](https://docs.aws.amazon.com/ja_jp/AmazonECR/latest/userguide/LifecyclePolicies.html)
- [Lambda コンテナイメージ](https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/images-create.html)

---

## 14. まとめ

### 主要な発見

1. **lambda-container モジュール内に ECR リポジトリ管理を統合するのが最適**
   - Lambda と ECR が同じライフサイクルで管理される
   - 他の Terraform リソース（DynamoDB など）との依存を活用可能

2. **image_uri は動的に生成可能**
   - `aws_ecr_repository.this.repository_url + image_tag` で実装
   - 既存の `image_uri` 変数は後方互換性のため保持

3. **IAM 権限拡張が必須**
   - Lambda がコンテナイメージを pull するには ECR 権限が必要
   - `AWSLambdaBasicExecutionRole` には ECR 権限が含まれない

4. **イメージプッシュは Terraform の外（GitHub Actions）で管理**
   - Terraform は ECR リポジトリ作成のみ
   - イメージプッシュは CI/CD パイプラインで実行
   - apply 前にプッシュを確認する仕組みが必要

5. **ライフサイクルポリシーで古いイメージを自動削除**
   - 推奨: 最新 10 個のイメージ保持 + 30日以上前のイメージを削除
   - 開発環境では要件に応じてカスタマイズ

### 次のステップ

- 実装計画書の作成（harness-planner にて）
- 実装と テスト（harness-executor にて）
- GitHub Actions イメージプッシュ自動化（別タスク）

