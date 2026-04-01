# ECR Terraform 管理化 実装計画書

**作成日**: 2026-03-31
**ステータス**: 実装完了（2026-03-31）
**リサーチ文書**: `docs/exec-plans/active/ecr-terraform-research.md`

---

## Goal and Success Criteria

**Goal**: `lambda-container` モジュールに ECR リポジトリ管理を統合し、`image_uri` のハードコードを解消する

**成功基準**:
- [x] `aws_ecr_repository` が `lambda-container` モジュールで Terraform 管理される
- [x] `aws_ecr_lifecycle_policy` で最新 10 件保持ルールが設定される
- [x] Lambda 実行ロールが ECR pull 権限を持ち、コンテナイメージを起動できる
- [x] `image_uri` は `var.image_uri` が空の場合、ECR リポジトリ URL から自動生成される
- [ ] `terraform validate` が全モジュールで通過する（CI で確認）
- [x] 既存の `image_uri` を明示指定した場合の後方互換性が保たれる

---

## Architectural Changes

### 変更ファイル

| ファイル | 種別 | 変更内容 |
|---------|------|---------|
| `terraform/modules/lambda-container/variables.tf` | 変更 | ECR 管理用の変数を追加 |
| `terraform/modules/lambda-container/main.tf` | 変更 | ECR リソースと IAM ポリシーを追加 |
| `terraform/modules/lambda-container/outputs.tf` | 変更 | ECR 関連の出力値を追加 |
| `terraform/environments/prod/lambda-api/terragrunt.hcl` | 変更 | ECR 設定を追加、`image_uri` ハードコードを削除 |

### 新規ファイル

なし（既存モジュールへの追加のみ）

### 依存関係の変更

なし（既存の AWS Provider ~>6.0 で `aws_ecr_repository` は利用可能）

---

## Implementation Steps

### Step 1: `variables.tf` に ECR 管理変数を追加

**目的**: ECR リポジトリ作成を制御する変数と、`image_uri` の自動生成に必要な変数を追加する

**変更対象**: `terraform/modules/lambda-container/variables.tf`

**変更内容**:

既存の `image_uri` 変数を以下のように変更する（`required` から `default = ""` に変更して後方互換性を確保）:

```hcl
variable "image_uri" {
  description = "ECR イメージ URI。指定された場合は ECR リポジトリ自動生成より優先される"
  type        = string
  default     = ""
}
```

以下の変数を末尾に追加する:

```hcl
# --- ECR リポジトリ管理 ---

variable "create_ecr_repository" {
  description = "ECR リポジトリを作成するかどうか"
  type        = bool
  default     = true
}

variable "ecr_repository_name" {
  description = "ECR リポジトリ名。未指定の場合は {project_name}-{function_name} が使用される"
  type        = string
  default     = null
}

variable "image_tag" {
  description = "コンテナイメージのタグ"
  type        = string
  default     = "latest"
}

variable "image_tag_mutability" {
  description = "イメージタグの変更可否 (MUTABLE または IMMUTABLE)"
  type        = string
  default     = "MUTABLE"

  validation {
    condition     = contains(["MUTABLE", "IMMUTABLE"], var.image_tag_mutability)
    error_message = "image_tag_mutability は MUTABLE または IMMUTABLE である必要があります。"
  }
}

variable "scan_on_push" {
  description = "プッシュ時にイメージスキャンを有効にするかどうか"
  type        = bool
  default     = true
}

variable "force_delete" {
  description = "イメージが残っていても ECR リポジトリを強制削除するかどうか"
  type        = bool
  default     = false
}
```

**完了基準**:
- [x] `image_uri` が `default = ""` を持つ（必須から任意へ変更）
- [x] 6 つの ECR 変数が追加されている
- [x] `image_tag_mutability` の validation ブロックが正しく記述されている

**影響ファイル**:
- `terraform/modules/lambda-container/variables.tf`（変更）

---

### Step 2: `main.tf` に ECR リソースを追加

**目的**: `aws_ecr_repository` と `aws_ecr_lifecycle_policy` を追加し、`image_uri` の動的生成ロジックを実装する

**変更対象**: `terraform/modules/lambda-container/main.tf`

**変更内容**:

ファイル冒頭に `locals` ブロックを追加する:

```hcl
locals {
  # ECR リポジトリ名: 明示指定がなければ {project_name}-{function_name} を使用
  ecr_repository_name = var.ecr_repository_name != null ? var.ecr_repository_name : "${var.project_name}-${var.function_name}"

  # image_uri: 明示指定があれば優先、なければ ECR リポジトリ URL から生成
  image_uri = var.image_uri != "" ? var.image_uri : "${aws_ecr_repository.this[0].repository_url}:${var.image_tag}"
}
```

`aws_lambda_function` より前に ECR リソースを追加する:

```hcl
# ECR リポジトリ
resource "aws_ecr_repository" "this" {
  count = var.create_ecr_repository ? 1 : 0

  name                 = local.ecr_repository_name
  image_tag_mutability = var.image_tag_mutability
  force_delete         = var.force_delete

  image_scanning_configuration {
    scan_on_push = var.scan_on_push
  }

  tags = {
    Name        = local.ecr_repository_name
    Project     = var.project_name
    Environment = var.environment
  }
}

# ECR ライフサイクルポリシー（最新 10 件を保持）
resource "aws_ecr_lifecycle_policy" "this" {
  count = var.create_ecr_repository ? 1 : 0

  repository = aws_ecr_repository.this[0].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "最新 10 件のイメージを保持し、古いものを削除する"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
```

`aws_lambda_function` の `image_uri` を `local.image_uri` に変更する:

```hcl
resource "aws_lambda_function" "this" {
  function_name = "${var.project_name}-${var.environment}-${var.function_name}"
  role          = aws_iam_role.lambda_role.arn
  package_type  = "Image"
  image_uri     = local.image_uri  # var.image_uri から変更
  timeout       = var.timeout
  memory_size   = var.memory_size
  # ... 以下変更なし
}
```

**完了基準**:
- [x] `locals` ブロックが `ecr_repository_name` と `image_uri` を定義している
- [x] `aws_ecr_repository.this` が `count` で条件付き作成される
- [x] `aws_ecr_lifecycle_policy.this` が最新 10 件保持ルールを持つ
- [x] `aws_lambda_function.this` が `local.image_uri` を使用している

**影響ファイル**:
- `terraform/modules/lambda-container/main.tf`（変更）

---

### Step 3: `main.tf` に ECR pull IAM ポリシーを追加

**目的**: Lambda 実行ロールが ECR からコンテナイメージを pull できるよう IAM ポリシーを追加する

**変更対象**: `terraform/modules/lambda-container/main.tf`

**変更内容**:

既存の `aws_iam_role_policy.lambda_dynamodb` の後に以下を追加する:

```hcl
# ECR pull 権限（コンテナイメージ Lambda に必須）
resource "aws_iam_role_policy" "lambda_ecr" {
  count = var.create_ecr_repository ? 1 : 0

  role = aws_iam_role.lambda_role.id
  name = "ecr-pull"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
        Resource = aws_ecr_repository.this[0].arn
      },
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      }
    ]
  })
}
```

**完了基準**:
- [x] `ecr:GetDownloadUrlForLayer`、`ecr:BatchGetImage`、`ecr:BatchCheckLayerAvailability` が ECR リポジトリ ARN を対象として許可されている
- [x] `ecr:GetAuthorizationToken` が `Resource = "*"` で許可されている
- [x] `count = var.create_ecr_repository ? 1 : 0` でモジュール利用者が無効化できる

**影響ファイル**:
- `terraform/modules/lambda-container/main.tf`（変更）

---

### Step 4: `outputs.tf` に ECR 出力値を追加

**目的**: ECR リポジトリの URL と ARN を出力し、他のモジュールやデプロイスクリプトから参照できるようにする

**変更対象**: `terraform/modules/lambda-container/outputs.tf`

**変更内容**:

既存の出力値の末尾に以下を追加する:

```hcl
output "ecr_repository_url" {
  description = "ECR リポジトリ URL（Docker push に使用）"
  value       = var.create_ecr_repository ? aws_ecr_repository.this[0].repository_url : null
}

output "ecr_repository_arn" {
  description = "ECR リポジトリ ARN"
  value       = var.create_ecr_repository ? aws_ecr_repository.this[0].arn : null
}

output "ecr_registry_id" {
  description = "ECR レジストリ ID（AWS アカウント ID）"
  value       = var.create_ecr_repository ? aws_ecr_repository.this[0].registry_id : null
}
```

**完了基準**:
- [x] 3 つの ECR 出力値が追加されている
- [x] `create_ecr_repository = false` の場合は `null` を返す条件式が正しい

**影響ファイル**:
- `terraform/modules/lambda-container/outputs.tf`（変更）

---

### Step 5: `terragrunt.hcl` を更新

**目的**: `image_uri` ハードコードを削除し、ECR 設定変数を追加する

**変更対象**: `terraform/environments/prod/lambda-api/terragrunt.hcl`

**変更内容**:

`inputs` ブロックを以下のように変更する。変更点は:
1. `image_uri = "..."` の行を削除
2. 関連するコメント（`# NOTE: Update this...` から `docker push` まで）を削除
3. ECR 設定変数を追加

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
  image_tag_mutability  = "MUTABLE"
  scan_on_push          = true

  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn

  environment_variables = {
    TABLE_NAME = dependency.dynamodb.outputs.table_name
    DEVICE_ID  = get_env("SWITCHBOT_DEVICE_ID", "")
  }
}
```

**注意**: `image_tag_mutability = "MUTABLE"` としているのは既存の `latest` タグ運用との互換性を保つため。タグ戦略を変更する場合は `IMMUTABLE` に切り替える。

**完了基準**:
- [x] `image_uri` のハードコード行が削除されている
- [x] 手動 Docker コマンドのコメントブロックが削除されている
- [x] `create_ecr_repository`、`ecr_repository_name`、`image_tag`、`image_tag_mutability`、`scan_on_push` が追加されている
- [ ] `terraform validate` が通過する（CI で確認）

**影響ファイル**:
- `terraform/environments/prod/lambda-api/terragrunt.hcl`（変更）

---

## Test Strategy

### terraform validate による検証

各変更後に以下コマンドで構文・型チェックを実施する:

```bash
# lambda-container モジュール単体の検証
cd terraform/modules/lambda-container
terraform init
terraform validate

# lambda-api Terragrunt 設定の検証（mock_outputs を使用）
cd terraform/environments/prod/lambda-api
terragrunt validate
```

**検証ポイント**:
- [ ] `variables.tf` の変数型・validation が正しく解釈される
- [ ] `main.tf` の `count` と `local.*` 参照が解決される
- [ ] `outputs.tf` の条件式が型エラーなく評価される
- [ ] `terragrunt.hcl` の `inputs` が全変数を正しく充足している

### terraform fmt による整形確認

```bash
cd terraform
terraform fmt -recursive -check
```

### 後方互換性の確認

`image_uri` を明示指定した場合でも動作することを plan で確認する:

```hcl
# terragrunt.hcl の inputs に追加してテスト
image_uri = "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/custom-repo:v1.0"
```

`local.image_uri` が `var.image_uri` を優先することを plan 出力で確認する。

### count = 0 の確認

`create_ecr_repository = false` を設定した場合に、ECR リソースが plan に現れないことを確認する。

---

## Known Risks and Constraints

### 技術的リスク

- **リスク**: `image_uri` を空文字 `""` にしたが、`aws_ecr_repository.this[0]` への参照は `create_ecr_repository = true` 時のみ有効
  - **影響度**: 高
  - **軽減策**: `local.image_uri` の三項演算子が `create_ecr_repository = false` かつ `image_uri = ""` の組み合わせでエラーになる。この組み合わせは不正な設定であり、validation ブロックではなくユーザードキュメントで禁止を明示する

- **リスク**: ECR イメージが存在しない状態で `terraform apply` を実行するとエラーになる
  - **影響度**: 高
  - **軽減策**: GitHub Actions で Docker push を apply より先に実行する順序を守る（本計画スコープ外）

- **リスク**: 既存の ECR リポジトリ `smarthome-sensor-api` が手動作成されていた場合、Terraform がコンフリクトする
  - **影響度**: 高
  - **軽減策**: apply 前に `terraform import aws_ecr_repository.this[0] smarthome-sensor-api` で既存リソースをインポートする

### 制約

- **後方互換性**: `image_uri` 変数を `required` から `default = ""` に変更するため、既存の呼び出し元で明示指定していた場合も引き続き動作する
- **image_tag_mutability**: `latest` タグを使用している間は `MUTABLE` が必要。本番運用でタグ戦略を変更するまで `MUTABLE` を維持する
- **`force_delete = false`**: デフォルトでは `terraform destroy` 時にイメージが残っているとエラーになる。意図的な設定

---

## Alternative Approaches Considered

### アプローチ A: 独立した `ecr` モジュールを作成

- **長所**: ECR と Lambda が独立して管理でき、将来的に複数 Lambda でリポジトリを共有しやすい
- **短所**: Terragrunt 依存チェーンが `dynamodb → ecr → lambda-api` と複雑になる
- **不採用理由**: 現状 lambda-api のみコンテナベースであり、シンプルな統合を優先

### アプローチ B: `lambda-container` モジュール内に統合（選択）

- **長所**: Lambda と ECR が同じライフサイクルで管理される。シンプルで理解しやすい
- **短所**: 将来的に複数 Lambda で ECR を共有する場合は見直しが必要
- **採用理由**: 現状のユースケースに適切。`create_ecr_repository` フラグで柔軟性を確保

---

## Post-Implementation Tasks

- [ ] `terraform validate` / `terraform fmt --check` が CI で通過することを確認
- [ ] 既存の ECR リポジトリがある場合は `terraform import` を実施
- [ ] 初回 `terraform apply` 前に ECR へのイメージ push を手動確認
- [ ] ARCHITECTURE.md のインフラ構成セクションを更新（ECR が Terraform 管理に移行したことを記録）
- [ ] 計画書を `docs/exec-plans/completed/` に移動
- [ ] GitHub Actions の Docker push → Terraform apply 順序の自動化を検討（別タスク）

---

## 変更ファイルサマリー

| ファイル | 変更種別 | 主な変更内容 |
|---------|---------|------------|
| `terraform/modules/lambda-container/variables.tf` | 変更 | `image_uri` を任意化、ECR 関連変数 6 つ追加 |
| `terraform/modules/lambda-container/main.tf` | 変更 | `locals`、`aws_ecr_repository`、`aws_ecr_lifecycle_policy`、`aws_iam_role_policy.lambda_ecr` を追加。`aws_lambda_function.image_uri` を `local.image_uri` に変更 |
| `terraform/modules/lambda-container/outputs.tf` | 変更 | `ecr_repository_url`、`ecr_repository_arn`、`ecr_registry_id` を追加 |
| `terraform/environments/prod/lambda-api/terragrunt.hcl` | 変更 | `image_uri` ハードコードを削除、ECR 設定変数を追加 |
