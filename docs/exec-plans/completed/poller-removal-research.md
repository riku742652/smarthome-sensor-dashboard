# Lambda Poller 削除調査

**作成日**: 2026-04-05
**対象**: `lambda/poller/` ディレクトリと関連する Terraform リソース、GitHub Actions ワークフローの削除

---

## 1. タスク理解

### 目標
Lambda Poller（`lambda/poller/`）に関連するすべてのコードと Terraform リソースを削除し、システムから完全に除去する。

### 背景
ユーザーがポーリング処理の削除を希望。このリサーチでは、削除対象ファイル、Terraform リソース、CI/CD ワークフローステップを完全に特定し、削除時の注意点・リスクを分析する。

---

## 2. 現状分析

### 2.1 lambda/poller/ の全構成

#### ディレクトリ構造
```
lambda/poller/
├── .dockerignore          # Docker ビルド時の除外ファイル定義
├── .pytest_cache/         # pytest キャッシュ（削除対象に含まない）
├── .venv/                 # Python 仮想環境（削除対象に含まない）
├── Dockerfile             # Lambda コンテナイメージ定義
├── lambda_function.py     # Poller ハンドラー実装（170行 → ロジック削除対象）
├── pyproject.toml         # Python 依存定義（boto3, requests）
├── uv.lock                # 依存ロック（uv パッケージマネージャー）
└── tests/
    ├── __init__.py
    └── test_lambda_function.py  # 300行のテストコード
```

#### 主要ファイルの役割

**lambda_function.py（171行）**
- `lambda_handler(event, context)`: EventBridge トリガー時のエントリーポイント
- `_fetch_with_retry()`: 指数バックオフ付き Switchbot API 呼び出し（最大3回リトライ）
- `fetch_switchbot_data()`: HMAC-SHA256 認証で Switchbot API からセンサーデータ取得
- `_validate_sensor_data()`: レスポンスバリデーション（必須フィールド確認、範囲チェック）
- `save_to_dynamodb()`: センサーデータを DynamoDB に永続化（30日 TTL 付き）
- `StructuredLogger`: CloudWatch 向け JSON ログ

**pyproject.toml**
```
dependencies = ["boto3>=1.34.0", "requests>=2.31.0"]
[dependency-groups] dev = ["pytest>=7.0", "pytest-mock>=3.0"]
```

**test_lambda_function.py（300行）**
- 26 個のテストケース、100% 行カバレッジ
- テスト範囲：API 成功・失敗パス、リトライロジック、バリデーション、DynamoDB 保存、環境変数検証

**Dockerfile**
```dockerfile
FROM public.ecr.aws/lambda/python:3.11
WORKDIR ${LAMBDA_TASK_ROOT}
COPY pyproject.toml uv.lock ./
RUN UV_SYSTEM_PYTHON=1 uv sync --frozen --no-dev
COPY . .
CMD ["lambda_function.lambda_handler"]
```

### 2.2 Terraform リソースの全体図

#### `terraform/environments/prod/lambda-poller/terragrunt.hcl`

**現在の設定**:
```hcl
terraform {
  source = "../../../modules/lambda-container"  # ECR ベース Lambda
}

dependency "dynamodb" {
  config_path = "../dynamodb"  # DynamoDB テーブルへの依存
}

inputs = {
  function_name = "poller"
  timeout       = 30
  memory_size   = 128
  create_ecr_repository = true
  ecr_repository_name   = "smarthome-sensor-poller"
  image_tag             = "latest"
  scan_on_push          = true
  create_function_url = false  # HTTP トリガーなし
  schedule_expression = "rate(2 minutes)"  # EventBridge スケジュール
  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn
  
  environment_variables = {
    TABLE_NAME       = dependency.dynamodb.outputs.table_name
    DEVICE_ID        = get_env("SWITCHBOT_DEVICE_ID", "")
    SWITCHBOT_TOKEN  = get_env("SWITCHBOT_TOKEN", "")
    SWITCHBOT_SECRET = get_env("SWITCHBOT_SECRET", "")
  }
}
```

**生成される Terraform リソース**（`terraform/modules/lambda-container/main.tf` より）:

| リソース | リソースID | 説明 |
|---------|-----------|------|
| `aws_ecr_repository` | `smarthome-sensor-poller` | ECR リポジトリ（スキャン有効） |
| `aws_ecr_lifecycle_policy` | `smarthome-sensor-poller` 向けポリシー | イメージローテーション（最新10個保持） |
| `aws_lambda_function` | `smarthome-prod-poller` | Lambda 関数（コンテナイメージベース） |
| `aws_iam_role` | `smarthome-prod-poller-role` | Lambda 実行ロール |
| `aws_iam_role_policy_attachment` | AWSLambdaBasicExecutionRole | CloudWatch Logs 基本実行権限 |
| `aws_iam_role_policy` | `dynamodb-access` | DynamoDB PutItem/GetItem/Query/Scan 権限 |
| `aws_iam_role_policy` | `ecr-pull` | ECR イメージプル権限 |
| `aws_cloudwatch_event_rule` | `smarthome-prod-poller-schedule` | EventBridge スケジュール（2分ごと） |
| `aws_cloudwatch_event_target` | Lambda へのバインディング | スケジュールターゲット |
| `aws_lambda_permission` | `allow_eventbridge` | EventBridge → Lambda 実行権限 |

#### 依存関係

**`lambda-poller` の依存**:
- `dependency "dynamodb"` により `/terraform/environments/prod/dynamodb` への依存あり
  - DynamoDB テーブル名・ARN を参照

**`lambda-poller` を参照している他の環境**:
- なし（他の環境から lambda-poller への参照は確認されない）

### 2.3 GitHub Actions ワークフロー内のポーラー関連ステップ

#### `.github/workflows/terraform-apply.yml`

**ワークフロー選択肢** （行 6-16）:
```yaml
environment:
  options:
    - all                 # 全環境（dynamodb, lambda-api, lambda-poller, cloudfront）
    - dynamodb
    - lambda-api
    - lambda-poller       # ← 削除対象
    - cloudfront
```

**ステップ 1: Plan フェーズ** （行 66-80）
- `Plan (run-all)`: `inputs.environment == 'all'` の場合、全環境を plan
  - 条件に `lambda-poller` が暗黙的に含まれる
- `Plan (single)`: 単一環境の plan

**ステップ 2: Apply Phase 1 - ECR リポジトリ先行作成** （行 86-109）
```yaml
# Line 99-109: lambda-poller ECR 先行作成
- name: Apply Phase 1 - Create ECR repository (lambda-poller)
  if: (inputs.environment == 'all' || inputs.environment == 'lambda-poller') && inputs.dry_run == false
  working-directory: terraform/environments/prod/lambda-poller
  run: |
    terragrunt apply \
      -lock-timeout=5m \
      -no-color \
      -auto-approve \
      -target=aws_ecr_repository.this[0]
```

**ステップ 3: Docker ビルド・ECR プッシュ** （行 143-171）
```yaml
# Line 143-171: lambda-poller Docker イメージビルド・プッシュ
- name: Build and push Docker image (lambda-poller)
  if: (inputs.environment == 'all' || inputs.environment == 'lambda-poller') && inputs.dry_run == false
  env:
    ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com
    ECR_REPOSITORY: smarthome-sensor-poller
    IMAGE_TAG: sha-${{ github.sha }}
  run: |
    # Linux amd64 ビルド、ECR へプッシュ（latest + sha タグ）
    docker build --platform linux/amd64 \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest" \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}" \
      lambda/poller/
    docker push ...
```

**ステップ 4: Apply Phase 2 - 全リソース apply** （行 175-201）
```yaml
# Line 194-201: lambda-poller 個別 apply ステップ
- name: Apply - Full lambda-poller
  if: inputs.environment == 'lambda-poller' && inputs.dry_run == false
  working-directory: terraform/environments/prod/lambda-poller
  run: |
    terragrunt apply ...
```

**ステップ 5: Summary** （行 238-244）
```yaml
# Line 238-244: Summary に lambda-poller イメージ情報を含める
if [[ "${{ inputs.environment }}" == "all" || \
      "${{ inputs.environment }}" == "lambda-poller" ]]; then
  echo "### Docker Image (lambda-poller)"
  echo "- **Registry**: \`${ECR_REGISTRY}/smarthome-sensor-poller\`"
  echo "- **Image tag**: \`sha-${GITHUB_SHA:0:7}\`"
fi
```

#### `.github/workflows/terraform-ci.yml`

**CI トリガー** （行 3-18）:
```yaml
on:
  pull_request:
    paths:
      - 'lambda/**/*.py'         # lambda/poller/*.py の変更検出
      - 'lambda/**/pyproject.toml'
      - 'lambda/**/Dockerfile'
  push:
    branches: [main]
    paths:
      - 'terraform/**/*.tf'
```

**Terraform Validate マトリックス** （行 54-61）:
```yaml
strategy:
  matrix:
    module:
      - terraform/modules/dynamodb
      - terraform/modules/lambda
      - terraform/modules/lambda-container
      - terraform/modules/cloudfront
```
※ `lambda-container` モジュール検証は残る（lambda-api が使用）

**Plan ステップ** （行 183-195）:
```yaml
- name: Plan - lambda-poller
  id: plan_lambda_poller
  working-directory: terraform/environments/prod/lambda-poller
  run: |
    terragrunt plan ...
```

**Summary 生成** （行 218）:
```yaml
for ENV in dynamodb lambda-api lambda-poller cloudfront; do
  # lambda-poller の plan 結果を処理
done
```

**Summary 失敗判定** （行 231-236）:
```yaml
if [ "${{ steps.plan_lambda_poller.outputs.exit_code }}" != "0" ]; then
  OVERALL_EXIT=1
fi
```

### 2.4 ドキュメント内のポーラー言及箇所

#### `ARCHITECTURE.md`

**言及箇所**:
- 行 192-201: Poller Lambda の役割・実装ハイライト
  - 指数バックオフリトライ、バリデーション、構造化ログ、TTL 管理
- 行 238-244: テストカバレッジ（Poller 100% 行カバレッジ、26 テストケース）
- 行 250-268: Lambda 依存関係管理（uv による pyproject.toml + uv.lock）
- 行 252-253: Poller の pyproject.toml・uv.lock ファイルへの言及
- 行 258: `lambda/poller` ディレクトリでのローカル開発コマンド例

#### ドキュメント内の参照ファイル

| ファイル | ポーラー言及箇所 | 削除対象 |
|---------|----------------|--------|
| `docs/exec-plans/active/poller-containerize-research.md` | 全体 | YES（アーカイブ候補） |
| `docs/exec-plans/archived/poller-containerize-plan.md` | 全体 | YES（既にアーカイブ） |
| `docs/exec-plans/completed/terraform-cicd-phase2-plan.md` | 言及なし確認待ち | TBD |
| `lambda/README.md` | Poller の説明 | YES（削除対象） |

---

## 3. 削除対象の完全リスト

### 3.1 削除するファイル・ディレクトリ

```
削除対象（ファイルシステム）:
├── lambda/poller/                         # ディレクトリ全体
│   ├── lambda_function.py
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── Dockerfile
│   ├── .dockerignore
│   └── tests/
│       ├── __init__.py
│       └── test_lambda_function.py

削除対象（Terraform）:
├── terraform/environments/prod/lambda-poller/
│   └── terragrunt.hcl

削除対象（ドキュメント）:
├── docs/exec-plans/active/poller-containerize-research.md
├── docs/exec-plans/archived/poller-containerize-plan.md
├── lambda/README.md 内のポーラー部分

修正対象（GitHub Actions）:
├── .github/workflows/terraform-apply.yml
│   - ワークフロー入力選択肢から 'lambda-poller' を削除
│   - Apply Phase 1 (lambda-poller ECR) を削除
│   - Build and push (lambda-poller) を削除
│   - Apply Phase 2 (Full lambda-poller) を削除
│   - Summary からポーラー記出部分を削除
│
├── .github/workflows/terraform-ci.yml
│   - Plan - lambda-poller ステップを削除
│   - Summary 生成の lambda-poller ループ処理を削除
│   - Summary 失敗判定の lambda-poller 条件を削除
```

### 3.2 削除対象の Terraform リソース

削除される AWS リソース（`terraform destroy` または `terraform apply` 削除時）:

| リソース | リソース ID | 削除理由 |
|---------|-----------|--------|
| `aws_ecr_repository` | `smarthome-sensor-poller` | Poller イメージリポジトリ |
| `aws_ecr_lifecycle_policy` | Poller リポジトリ向け | イメージローテーション |
| `aws_lambda_function` | `smarthome-prod-poller` | Poller Lambda 関数 |
| `aws_iam_role` | `smarthome-prod-poller-role` | Lambda 実行ロール |
| `aws_iam_role_policy_attachment` | 基本実行ロール (Poller) | CloudWatch Logs 権限 |
| `aws_iam_role_policy` | `dynamodb-access` (Poller) | DynamoDB アクセス権限 |
| `aws_iam_role_policy` | `ecr-pull` (Poller) | ECR pull 権限 |
| `aws_cloudwatch_event_rule` | `smarthome-prod-poller-schedule` | EventBridge スケジュール |
| `aws_cloudwatch_event_target` | 上記ルールのターゲット | スケジュール → Lambda バインディング |
| `aws_lambda_permission` | `allow_eventbridge` (Poller) | EventBridge → Lambda 実行権限 |

---

## 9. 次のステップ

本リサーチの結果をもとに、以下のタスクが続きます：

1. **削除計画ドキュメント作成** (`poller-removal-plan.md`)
   - ステップバイステップの削除手順
   - テスト検証項目

2. **削除実装** （harness-executor の使用）
   - ファイル削除
   - Terraform 修正
   - CI/CD 修正
   - ドキュメント更新

3. **PR 作成・レビュー**
   - AI レビュアー対応（Gemini・Codex）
   - CI 通過確認
   - 人間レビュー対応

4. **本番環境への反映** （Terraform apply）
   - 削除実行
   - リソース確認（CloudWatch でポーラー関連ログ・アラーム削除確認）

---

**リサーチ完了**: すべての削除対象が特定され、実装フェーズの準備が整いました。

---

## 完了情報

**完了日**: 2026-04-05  
**完了PR**: #25  
**完了コミット**: 8cd7770 (chore: remove lambda-poller and all related resources)

すべての計画されたステップが実装され、PR がマージされました。Lambda Poller に関するコード、Terraform リソース、CI/CD ステップ、ドキュメントが完全に削除されました。
