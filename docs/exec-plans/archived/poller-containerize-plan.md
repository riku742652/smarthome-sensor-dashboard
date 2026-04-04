# Lambda Poller コンテナ化 実装計画

> **[アーカイブ済み - 2026-04-04]**
> 方針転換により、このプランは実施しません。
> SwitchBot Hub Mini が手元になく、クラウド API 経由でのデータ取得が不可能なため、
> Lambda Poller によるポーリング方式から Raspberry Pi BLE スキャン方式に切り替えました。
> 参照コードとして `lambda/poller/` は削除せず残します。
> 代替プラン: `docs/exec-plans/active/ble-api-plan.md`

**作成日**: 2026-04-04
**リサーチ文書**: `docs/exec-plans/active/poller-containerize-research.md`
**ステータス**: レビュー待ち

---

## Goal and Success Criteria

**Goal**: Lambda Poller（`lambda/poller/`）を ZIP ベースのデプロイから Docker コンテナイメージ（ECR）ベースのデプロイに移行する。`lambda-container` Terraform モジュールに EventBridge トリガーと DynamoDB PutItem 権限を追加し、既存機能（2分間隔ポーリング・DynamoDB 書き込み）を維持したまま移行する。

**Success Criteria**:
- [ ] `lambda/poller/Dockerfile` が作成され、Lambda イベントハンドラーとしてビルド可能
- [ ] `lambda/poller/.dockerignore` が作成される
- [ ] `terraform/modules/lambda-container/` に `schedule_expression` 変数と EventBridge リソースが追加される
- [ ] `terraform/modules/lambda-container/` の DynamoDB ポリシーに `PutItem` が追加される
- [ ] `terraform/modules/lambda-container/` の `function_url` が条件付き出力になり、poller で apply エラーが発生しない
- [ ] `terraform/environments/prod/lambda-poller/terragrunt.hcl` が `lambda-container` モジュールを使用する
- [ ] `.github/workflows/terraform-apply.yml` が poller の ECR 作成・Docker ビルド・プッシュをサポートする
- [ ] `terraform plan` で差分が期待通りになる（EventBridge ルール・DynamoDB ポリシー更新を含む）

---

## Architectural Changes

### 新規作成ファイル
- `lambda/poller/Dockerfile` — Lambda Web Adapter なし、イベントハンドラー型の Dockerfile
- `lambda/poller/.dockerignore` — Poller 専用（API の `.dockerignore` と同内容）

### 修正ファイル
- `terraform/modules/lambda-container/variables.tf` — `schedule_expression`、`create_function_url` 変数を追加
- `terraform/modules/lambda-container/main.tf` — EventBridge リソース（Rule・Target・Permission）追加、DynamoDB ポリシーに `PutItem` 追加、`aws_lambda_function_url` を `create_function_url` フラグで条件付き化
- `terraform/modules/lambda-container/outputs.tf` — `function_url` 出力を条件付きに変更
- `terraform/environments/prod/lambda-poller/terragrunt.hcl` — `lambda-container` モジュールに変更
- `.github/workflows/terraform-apply.yml` — Phase 1・Docker ビルド・Apply Phase 2 の各ステップに poller を追加

### 依存関係の変更
- 新規パッケージなし
- `terraform/modules/lambda/` は変更なし（ZIP モジュールはそのまま残す）

---

## Implementation Steps

### Step 1: `lambda/poller/Dockerfile` を作成する

**目的**: Lambda イベントハンドラー型（HTTP サーバー不要）の Dockerfile を作成する。Lambda Web Adapter は不要。

**Actions**:
1. `lambda/poller/Dockerfile` を新規作成する
2. 内容は以下の通り：

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

WORKDIR ${LAMBDA_TASK_ROOT}

# 依存パッケージをインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコードをコピー
COPY . .

# Lambda イベントハンドラー（HTTP サーバー不要のため CMD で直接指定）
CMD ["lambda_function.lambda_handler"]
```

**API の Dockerfile との差分**:
- `COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter` の行なし（Lambda Web Adapter 不要）
- `ENV PORT=8000`、`ENV AWS_LWA_INVOKE_MODE=response_stream` なし
- `CMD` が uvicorn ではなく Lambda ハンドラーを直接指定

**Completion Criteria**:
- [ ] ファイルが作成されている
- [ ] `docker build --platform linux/amd64 -t test lambda/poller/` がローカルでビルド成功する（任意検証）

**Files Affected**:
- `lambda/poller/Dockerfile` (new)

---

### Step 2: `lambda/poller/.dockerignore` を作成する

**目的**: Docker ビルドコンテキストから不要ファイルを除外する。API の `.dockerignore` と同一内容で問題ない。

**Actions**:
1. `lambda/poller/.dockerignore` を新規作成する
2. 内容は以下の通り：

```
__pycache__
*.pyc
*.pyo
*.pyd
.Python
*.so
*.egg
*.egg-info
dist
build
.pytest_cache
.mypy_cache
.coverage
htmlcov
.env
.venv
venv/
ENV/
tests/
requirements-dev.txt
```

**API との差分**: `tests/` ディレクトリと `requirements-dev.txt` を追加で除外する（開発用ファイルをコンテナに含めない）

**Completion Criteria**:
- [ ] ファイルが作成されている

**Files Affected**:
- `lambda/poller/.dockerignore` (new)

---

### Step 3: `lambda-container` モジュールの `variables.tf` を拡張する

**目的**: EventBridge トリガーと Lambda Function URL の条件制御に必要な変数を追加する。

**Actions**:
1. `terraform/modules/lambda-container/variables.tf` の末尾に以下を追加する：

```hcl
variable "schedule_expression" {
  description = "EventBridge スケジュール式（例：rate(2 minutes)）。空文字の場合は EventBridge リソースを作成しない"
  type        = string
  default     = ""
}

variable "create_function_url" {
  description = "Lambda Function URL を作成するかどうか。HTTP トリガー不要の Lambda（Poller 等）は false に設定する"
  type        = bool
  default     = true
}
```

**Completion Criteria**:
- [ ] `schedule_expression` 変数が追加されている
- [ ] `create_function_url` 変数が追加されている
- [ ] `terraform validate` がエラーなし

**Files Affected**:
- `terraform/modules/lambda-container/variables.tf` (modified)

---

### Step 4: `lambda-container` モジュールの `main.tf` を拡張する

**目的**: EventBridge リソースの追加、DynamoDB ポリシーへの `PutItem` 追加、`aws_lambda_function_url` の条件付き化。

**Actions**:

#### 4-a. `aws_lambda_function_url` を条件付き化する

現在の `main.tf` の `aws_lambda_function_url.this` リソース（行 141-152）を以下に置き換える：

```hcl
# Lambda Function URL（HTTP トリガーが必要な Lambda 向け。Poller には不要）
resource "aws_lambda_function_url" "this" {
  count              = var.create_function_url ? 1 : 0
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "NONE" # パブリックアクセス

  cors {
    allow_credentials = false
    allow_origins     = ["*"]
    allow_methods     = ["*"]
    allow_headers     = ["*"]
    max_age           = 86400
  }
}
```

#### 4-b. DynamoDB ポリシーに `PutItem` を追加する

現在の `aws_iam_role_policy.lambda_dynamodb`（行 93-110）の Action リストを以下に変更する：

```hcl
Action = [
  "dynamodb:PutItem",
  "dynamodb:GetItem",
  "dynamodb:Query",
  "dynamodb:Scan"
]
```

#### 4-c. EventBridge リソースを追加する

`main.tf` の末尾（`aws_lambda_function_url` の後）に以下を追加する：

```hcl
# EventBridge (CloudWatch Events) スケジュール
# schedule_expression が設定されている場合のみリソースを作成する
resource "aws_cloudwatch_event_rule" "schedule" {
  count               = var.schedule_expression != "" ? 1 : 0
  name                = "${var.project_name}-${var.environment}-${var.function_name}-schedule"
  schedule_expression = var.schedule_expression
  description         = "${var.function_name} Lambda 関数を定期実行するスケジュールルール"
}

resource "aws_cloudwatch_event_target" "lambda" {
  count = var.schedule_expression != "" ? 1 : 0
  rule  = aws_cloudwatch_event_rule.schedule[0].name
  arn   = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  count         = var.schedule_expression != "" ? 1 : 0
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule[0].arn
}
```

**Completion Criteria**:
- [ ] `aws_lambda_function_url` が `count = var.create_function_url ? 1 : 0` で条件付きになっている
- [ ] DynamoDB ポリシーに `dynamodb:PutItem` が含まれている
- [ ] `aws_cloudwatch_event_rule`、`aws_cloudwatch_event_target`、`aws_lambda_permission` の3リソースが追加されている
- [ ] `terraform validate` がエラーなし（lambda-api ディレクトリで確認）

**Files Affected**:
- `terraform/modules/lambda-container/main.tf` (modified)

---

### Step 5: `lambda-container` モジュールの `outputs.tf` を修正する

**目的**: `function_url` 出力が `aws_lambda_function_url.this` を直接参照しているため、count 化に合わせて条件付き出力に変更する。変更しないと `create_function_url = false` の場合に `terraform apply` でエラーになる。

**Actions**:
1. `terraform/modules/lambda-container/outputs.tf` の `function_url` 出力（行 11-14）を以下に変更する：

```hcl
output "function_url" {
  description = "Lambda 関数 URL（create_function_url = false の場合は null）"
  value       = var.create_function_url ? aws_lambda_function_url.this[0].function_url : null
}
```

**Completion Criteria**:
- [ ] `function_url` 出力が条件付きになっている
- [ ] `create_function_url = true` のとき URL が出力される
- [ ] `create_function_url = false` のとき `null` が出力される

**Files Affected**:
- `terraform/modules/lambda-container/outputs.tf` (modified)

---

### Step 6: `lambda-api` の `terragrunt.hcl` に `create_function_url = true` を明示する

**目的**: Step 3 で追加した `create_function_url` 変数のデフォルトは `true` だが、API 側の設定ファイルに明示的に記述することで将来の変更時に意図が伝わりやすくなる。

**Actions**:
1. `terraform/environments/prod/lambda-api/terragrunt.hcl` の `inputs` ブロックに以下を追加する：

```hcl
  # Lambda Function URL を有効化（API は HTTP トリガーが必要）
  create_function_url = true
```

**Completion Criteria**:
- [ ] `create_function_url = true` が明示的に記述されている

**Files Affected**:
- `terraform/environments/prod/lambda-api/terragrunt.hcl` (modified)

---

### Step 7: `lambda-poller/terragrunt.hcl` を `lambda-container` モジュールに変更する

**目的**: ZIP ベースの `lambda` モジュールから `lambda-container` モジュールに切り替える。

**Actions**:
1. `terraform/environments/prod/lambda-poller/terragrunt.hcl` を以下の内容で全面置換する：

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
  function_name = "poller"
  timeout       = 30
  memory_size   = 128

  # ECR リポジトリ設定
  create_ecr_repository = true
  ecr_repository_name   = "smarthome-sensor-poller"
  image_tag             = "latest"
  image_tag_mutability  = "MUTABLE"
  scan_on_push          = true

  # HTTP トリガー不要（EventBridge で起動）
  create_function_url = false

  # EventBridge スケジュール（2分間隔）
  schedule_expression = "rate(2 minutes)"

  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn

  environment_variables = {
    TABLE_NAME       = dependency.dynamodb.outputs.table_name
    DEVICE_ID        = get_env("SWITCHBOT_DEVICE_ID", "")
    SWITCHBOT_TOKEN  = get_env("SWITCHBOT_TOKEN", "")
    SWITCHBOT_SECRET = get_env("SWITCHBOT_SECRET", "")
  }
}
```

**ZIP モジュールからの主な変更点**:
- `terraform.source`: `lambda` → `lambda-container`
- `handler`, `runtime`, `source_dir` を削除（コンテナイメージでは不要）
- `create_ecr_repository`, `ecr_repository_name`, `image_tag`, `image_tag_mutability`, `scan_on_push` を追加
- `create_function_url = false` を追加（Lambda Function URL 不要）
- `schedule_expression = "rate(2 minutes)"` は維持（モジュールに移動）

**Completion Criteria**:
- [ ] `terraform.source` が `lambda-container` を参照している
- [ ] `create_function_url = false` が設定されている
- [ ] `schedule_expression = "rate(2 minutes)"` が設定されている
- [ ] `terragrunt plan` が ZIP モジュールのリソース削除 + コンテナモジュールのリソース作成を示す

**Files Affected**:
- `terraform/environments/prod/lambda-poller/terragrunt.hcl` (modified)

---

### Step 8: `.github/workflows/terraform-apply.yml` を拡張する

**目的**: Poller の ECR 作成・Docker ビルド・プッシュ・Terraform apply を CI/CD に統合する。

**Actions**:

#### 8-a. `Apply Phase 1` ステップを分割する（行 86-96）

現在の1ステップ（`lambda-api` ECR のみ）を、`lambda-api` と `lambda-poller` をそれぞれ条件付きで実行するよう変更する。

現在のステップを以下に置き換える：

```yaml
      - name: Apply Phase 1 - Create ECR repository (lambda-api)
        if: (inputs.environment == 'all' || inputs.environment == 'lambda-api') && inputs.dry_run == false
        working-directory: terraform/environments/prod/lambda-api
        run: |
          # -target で ECR リポジトリのみを先行作成
          # Lambda 本体は後続の apply ステップ（Phase 2 または Full lambda-api）で作成される
          terragrunt apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve \
            -target=aws_ecr_repository.this[0]

      - name: Apply Phase 1 - Create ECR repository (lambda-poller)
        if: (inputs.environment == 'all' || inputs.environment == 'lambda-poller') && inputs.dry_run == false
        working-directory: terraform/environments/prod/lambda-poller
        run: |
          # -target で ECR リポジトリのみを先行作成
          # Lambda 本体は後続の apply ステップ（Phase 2 または Full lambda-poller）で作成される
          terragrunt apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve \
            -target=aws_ecr_repository.this[0]
```

#### 8-b. TODO コメントを削除し、Docker ビルドステップを分割する（行 98-135）

現在の `Build and push Docker image` ステップ（lambda-api のみ）の直後に、lambda-poller 用のステップを追加する。

また、行 100-105 の TODO コメントを削除する。

```yaml
      # ===== Docker ビルド・ECR プッシュ =====

      - name: Build and push Docker image (lambda-api)
        if: (inputs.environment == 'all' || inputs.environment == 'lambda-api') && inputs.dry_run == false
        env:
          ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com
          ECR_REPOSITORY: smarthome-sensor-api
          IMAGE_TAG: sha-${{ github.sha }}
        run: |
          # "sha-" (4文字) + commit hash 7文字 = 11文字
          SHORT_TAG=${IMAGE_TAG:0:11}

          # ECR にログイン
          aws ecr get-login-password --region ap-northeast-1 | \
            docker login --username AWS --password-stdin "${ECR_REGISTRY}"

          # Docker イメージビルド（linux/amd64 を明示指定: Lambda の実行環境は x86_64）
          docker build \
            --platform linux/amd64 \
            -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest" \
            -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}" \
            lambda/api/

          # ECR へプッシュ（latest: 常に最新イメージを示す）
          docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"

          # ECR へプッシュ（sha-XXXXXXX: git コミットと紐付いたイメージ追跡用）
          docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}"

          echo "Pushed: ${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
          echo "Pushed: ${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}"

      - name: Build and push Docker image (lambda-poller)
        if: (inputs.environment == 'all' || inputs.environment == 'lambda-poller') && inputs.dry_run == false
        env:
          ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com
          ECR_REPOSITORY: smarthome-sensor-poller
          IMAGE_TAG: sha-${{ github.sha }}
        run: |
          # "sha-" (4文字) + commit hash 7文字 = 11文字
          SHORT_TAG=${IMAGE_TAG:0:11}

          # ECR にログイン
          aws ecr get-login-password --region ap-northeast-1 | \
            docker login --username AWS --password-stdin "${ECR_REGISTRY}"

          # Docker イメージビルド（linux/amd64 を明示指定: Lambda の実行環境は x86_64）
          docker build \
            --platform linux/amd64 \
            -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest" \
            -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}" \
            lambda/poller/

          # ECR へプッシュ（latest: 常に最新イメージを示す）
          docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"

          # ECR へプッシュ（sha-XXXXXXX: git コミットと紐付いたイメージ追跡用）
          docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}"

          echo "Pushed: ${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
          echo "Pushed: ${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}"
```

#### 8-c. `Apply (single)` ステップの条件式を更新する（行 158-165）

現在の条件に `lambda-poller` の除外を追加する（poller 専用の apply ステップを追加するため）：

```yaml
      # Apply - Full lambda-poller
      - name: Apply - Full lambda-poller
        if: inputs.environment == 'lambda-poller' && inputs.dry_run == false
        working-directory: terraform/environments/prod/lambda-poller
        run: |
          terragrunt apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve

      # lambda-api・lambda-poller 以外の個別 apply（Docker ビルド不要な環境）
      - name: Apply (single)
        if: inputs.environment != 'all' && inputs.environment != 'lambda-api' && inputs.environment != 'lambda-poller' && inputs.dry_run == false
        working-directory: terraform/environments/prod/${{ inputs.environment }}
        run: |
          terragrunt apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve
```

#### 8-d. `Write summary` ステップを更新する（行 169-192）

poller のイメージ情報も Summary に出力するよう変更する：

```yaml
      - name: Write summary
        if: always()
        run: |
          {
            echo "## Terraform Apply Results"
            echo ""
            if [ "${{ inputs.dry_run }}" = "true" ]; then
              echo "> **Dry run** - plan のみ実行（apply はスキップ）"
              echo ""
            fi
            echo "- **Environment**: \`${{ inputs.environment }}\`"
            echo "- **Dry run**: \`${{ inputs.dry_run }}\`"
            echo "- **Triggered by**: ${{ github.actor }}"
            echo "- **Commit**: \`${GITHUB_SHA:0:7}\`"
            echo ""
            ECR_REGISTRY="${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com"
            if [[ "${{ inputs.dry_run }}" == "false" ]] && \
               [[ "${{ inputs.environment }}" == "all" || \
                  "${{ inputs.environment }}" == "lambda-api" ]]; then
              echo "### Docker Image (lambda-api)"
              echo "- **Registry**: \`${ECR_REGISTRY}/smarthome-sensor-api\`"
              echo "- **Image tag**: \`sha-${GITHUB_SHA:0:7}\`"
            fi
            if [[ "${{ inputs.dry_run }}" == "false" ]] && \
               [[ "${{ inputs.environment }}" == "all" || \
                  "${{ inputs.environment }}" == "lambda-poller" ]]; then
              echo "### Docker Image (lambda-poller)"
              echo "- **Registry**: \`${ECR_REGISTRY}/smarthome-sensor-poller\`"
              echo "- **Image tag**: \`sha-${GITHUB_SHA:0:7}\`"
            fi
          } >> $GITHUB_STEP_SUMMARY
```

**Completion Criteria**:
- [ ] `Apply Phase 1` が `lambda-api` と `lambda-poller` で独立したステップになっている
- [ ] TODO コメント（行 100-105）が削除されている
- [ ] `Build and push Docker image (lambda-api)` ステップが存在する
- [ ] `Build and push Docker image (lambda-poller)` ステップが存在する
- [ ] `Apply - Full lambda-poller` ステップが追加されている
- [ ] `Apply (single)` の条件に `lambda-poller` の除外が含まれている
- [ ] `Write summary` に poller の Docker イメージ情報が含まれる

**Files Affected**:
- `.github/workflows/terraform-apply.yml` (modified)

---

## ワークフロー全体イメージ（付録）

`environment = 'all'` の場合の実行フロー：

```
[Plan] run-all plan
  ↓
[Phase 1] lambda-api ECR リポジトリ作成
  ↓
[Phase 1] lambda-poller ECR リポジトリ作成
  ↓
[Build] lambda-api Docker イメージビルド・プッシュ
  ↓
[Build] lambda-poller Docker イメージビルド・プッシュ
  ↓
[Phase 2] run-all apply（全リソース）
```

`environment = 'lambda-poller'` の場合：

```
[Plan] terragrunt plan
  ↓
[Phase 1] lambda-poller ECR リポジトリ作成
  ↓
[Build] lambda-poller Docker イメージビルド・プッシュ
  ↓
[Apply] Full lambda-poller apply
```

`environment = 'lambda-api'` の場合（既存フロー、変更なし）：

```
[Plan] terragrunt plan
  ↓
[Phase 1] lambda-api ECR リポジトリ作成
  ↓
[Build] lambda-api Docker イメージビルド・プッシュ
  ↓
[Apply] Full lambda-api apply
```

---

## Test Strategy

### Terraform モジュールの検証
- **方法**: 各ディレクトリで `terragrunt plan` を実行し差分を確認する
- **lambda-api**: `create_function_url = true` を明示した後、`terraform plan` で差分なし（既存リソースに影響なし）を確認
- **lambda-poller**: `terragrunt plan` で以下のリソースが作成される差分を確認
  - `aws_ecr_repository.this[0]`（smarthome-sensor-poller）
  - `aws_ecr_lifecycle_policy.this[0]`
  - `aws_lambda_function.this`
  - `aws_iam_role.lambda_role`
  - `aws_iam_role_policy.lambda_dynamodb[0]`（PutItem 含む）
  - `aws_iam_role_policy.lambda_ecr[0]`
  - `aws_cloudwatch_event_rule.schedule[0]`
  - `aws_cloudwatch_event_target.lambda[0]`
  - `aws_lambda_permission.allow_eventbridge[0]`
  - （ZIP モジュールのリソースが destroy される）
  - `aws_lambda_function_url` は **作成されない**（`create_function_url = false`）

### Docker ビルドの検証（任意・ローカル）
```bash
docker build --platform linux/amd64 -t poller-test lambda/poller/
```

### CI ワークフローの検証
- `environment = 'lambda-poller'`、`dry_run = true` で手動実行し、plan が正常に完了することを確認
- `environment = 'lambda-api'`、`dry_run = true` で手動実行し、API への影響がないことを確認

### 手動テスト（apply 後）
- [ ] AWS コンソールで `smarthome-sensor-poller` ECR リポジトリが作成されていることを確認
- [ ] Lambda 関数 `smarthome-prod-poller` がコンテナイメージタイプで存在することを確認
- [ ] EventBridge ルール `smarthome-prod-poller-schedule` が `rate(2 minutes)` で存在することを確認
- [ ] Lambda 関数の手動テスト実行で DynamoDB にデータが書き込まれることを確認
- [ ] CloudWatch Logs にログが出力されることを確認

---

## Known Risks and Constraints

### Technical Risks

- **Risk**: `lambda-container` モジュールの `aws_lambda_function_url` を count 化することで、既存の `lambda-api` リソースが `destroy -> create` されるリスク
  - **Impact**: High（API の停止につながる可能性）
  - **Mitigation**: Step 6 で `create_function_url = true` を `lambda-api/terragrunt.hcl` に明示する。`count = 1` は変わらないため、Terraform は destroy しない。**Apply 前に必ず `terraform plan` で差分を確認する**

- **Risk**: ZIP モジュール（`lambda` モジュール）から `lambda-container` モジュールへの切り替え時に、Terraform が既存 Lambda 関数を destroy して新規作成する
  - **Impact**: Medium（移行中に約1-2分の Lambda 停止。EventBridge スケジュールが2分間隔のため、最大1回のポーリングが欠落する可能性）
  - **Mitigation**: apply はメンテナンス時間帯に実施。データの欠落は許容範囲内（監視用途のため）

- **Risk**: コンテナイメージが ECR にプッシュされる前に Lambda が apply されると、Lambda 関数の作成に失敗する
  - **Impact**: High
  - **Mitigation**: Phase 1（ECR 作成） → Docker ビルド・プッシュ → Phase 2（Lambda apply）の順序を CI で強制している

- **Risk**: `dynamodb:PutItem` を lambda-container モジュールの DynamoDB ポリシーに追加すると、`lambda-api` にも `PutItem` 権限が付与される
  - **Impact**: Low（最小権限原則からのズレだが、API コードは PutItem を呼ばないため実害なし）
  - **Mitigation**: 決定事項として許容済み。将来的に `allow_dynamodb_write` 変数での分離も可能

### Constraints
- **ECR リポジトリ名**: `smarthome-sensor-poller` で確定（決定事項による）
- **Lambda メモリ**: 128 MB（ZIP 時と同値。コンテナ化後も変更なし）
- **Lambda タイムアウト**: 30 秒（ZIP 時と同値。変更なし）
- **プラットフォーム**: `linux/amd64`（Lambda の実行環境に合わせる。ARM 化は本タスクのスコープ外）

---

## Alternative Approaches Considered

### Approach A: `aws_lambda_function_url` を常に作成（条件付き化しない）
- **Pros**: `outputs.tf` の変更が不要
- **Cons**: Poller に不要な Lambda Function URL が作成される。パブリックアクセスが可能になる（セキュリティリスク）
- **Decision**: 不採用。Poller に外部 URL は不要であり、`NONE` 認証での公開は避けるべき

### Approach B: EventBridge を `lambda-poller/terragrunt.hcl` で別途定義する（モジュール未拡張）
- **Pros**: `lambda-container` モジュールへの変更が最小限
- **Cons**: EventBridge リソースが Terragrunt 設定に散在する。将来の Lambda 追加時に再利用できない
- **Decision**: 不採用。モジュール拡張の方が再利用性が高い（決定事項による）

### Approach C: DynamoDB ポリシーを `allow_dynamodb_write` フラグで分離する
- **Pros**: lambda-api に `PutItem` 権限が不要。最小権限原則を厳密に適用できる
- **Cons**: 変数が増える。現状 API がデータを書かないため実害はない
- **Decision**: 不採用。決定事項で「常に PutItem を含める」と確定済み。将来必要になれば追加可能

### Approach D: Phase 1 の ECR 作成を1ステップで両方 apply する（shell の if 分岐）
- **Pros**: YAML のステップ数が減る
- **Cons**: エラー時にどちらが失敗したか分かりにくい。GitHub Actions のステップ名でのフィルタリングが困難
- **Decision**: 不採用。ステップを分けた方がログが明確で問題切り分けが容易

---

## Post-Implementation Tasks

- [ ] `terraform plan` で lambda-api への影響がないことを確認してから apply する
- [ ] apply 後、CloudWatch Logs で Poller が正常動作していることを確認する
- [ ] `ARCHITECTURE.md` の「Lambda アーキテクチャの詳細 > Poller Lambda」セクションを更新する（ZIP → コンテナイメージ）
- [ ] 計画書を `docs/exec-plans/completed/` に移動する
- [ ] `terraform/modules/lambda/` の Poller 用リソース（EventBridge・DynamoDB ポリシー）はそのまま残す（他の Lambda が ZIP モジュールを使う可能性のため）
