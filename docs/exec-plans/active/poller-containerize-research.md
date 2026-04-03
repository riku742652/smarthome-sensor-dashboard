# Lambda Poller コンテナ化（ZIP → Docker/ECR）調査

**作成日**: 2026-04-04
**対象**: `lambda/poller/` を ZIP デプロイから Docker コンテナイメージ（ECR）ベースのデプロイに移行

---

## 1. タスク理解

### 目標
Lambda Poller 関数を現在の ZIP ベースのデプロイから、Docker コンテナイメージを ECR で管理するデプロイに移行する。

### 成功基準
1. `lambda/poller/Dockerfile` を作成し、Lambda Web Adapter ベースでビルド可能な状態
2. `terraform/environments/prod/lambda-poller/terragrunt.hcl` を `lambda-container` モジュール使用に変更
3. `.github/workflows/terraform-apply.yml` を拡張し、poller のビルド・プッシュを統合
4. poller 専用の ECR リポジトリが自動作成される
5. 既存の EventBridge スケジュール（2分ごと）と DynamoDB への書き込みが維持される
6. テスト（pytest 100% カバレッジ）が動作する

### 既知の TODO コメント
`.github/workflows/terraform-apply.yml` の行 100-105 に以下の TODO があります：
```yaml
# TODO: lambda-poller をコンテナ化する際は、このステップに poller のビルドも追加する
#   1. terraform/environments/prod/lambda-poller/terragrunt.hcl を
#      lambda-container モジュールに変更
#   2. 同様のビルド・プッシュステップを追加（ECR_REPOSITORY を変更）
#   3. Apply Phase 1 の -target に aws_ecr_repository.this[0] を追加
#   参考: docs/exec-plans/active/docker-build-research.md「8. 既知の制限と今後の拡張」
```

---

## 2. 現状分析

### 2.1 Lambda Poller の現在の状態

#### `lambda/poller/lambda_function.py`
**ハンドラー関数**: `lambda_handler(event, context)`
**ランタイム**: Python 3.11
**主な機能**:
- EventBridge（CloudWatch Events）トリガー（2分間隔）
- Switchbot API からセンサーデータ（temperature, humidity, CO2）を取得（指数バックオフリトライ付き）
- DynamoDB にデータ保存（30日 TTL 付き）
- 構造化 JSON ログを CloudWatch に出力

**重要な実装特性**:
- HTTP サーバーなし（eventhandler 型）
- 外部 API（Switchbot）への HMAC-SHA256 認証
- リトライロジック：最大3回、ベース遅延1秒、指数バックオフ
- バリデーション：必須フィールド確認、範囲チェック
- DynamoDB への PutItem 操作のみ

#### `lambda/poller/requirements.txt`
```
boto3>=1.34.0
requests>=2.31.0
```

**特徴**:
- 依存パッケージが少ない（2個）
- Lambda API の requirements.txt より軽量
- 外部 HTTP クライアント（requests）が必要（Switchbot API 呼び出し用）

#### `lambda/poller/requirements-dev.txt`
```
pytest>=7.0
pytest-mock>=3.0
```

#### 現在の Terraform 設定（`terraform/environments/prod/lambda-poller/terragrunt.hcl`）
```hcl
terraform {
  source = "../../../modules/lambda"  # ZIP モジュール使用
}

inputs = {
  function_name = "poller"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  source_dir    = "${get_repo_root()}/lambda/poller"
  timeout       = 30
  memory_size   = 128
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

**現在の IAM パーミッション** （`terraform/modules/lambda/main.tf`）:
- CloudWatch Logs 基本実行ロール
- DynamoDB：`PutItem`, `GetItem`, `Query`, `Scan` 許可

**EventBridge スケジュール**:
- `rate(2 minutes)` で定期実行
- CloudWatch Event Rule と Lambda Permission で統合

---

### 2.2 Lambda API（参考）との比較

#### Lambda API の現状

**実装**:
- FastAPI ベースの HTTP サーバー
- Lambda Web Adapter 使用（HTTP リクエスト処理）
- CORS 有効化

**Dockerfile** (`lambda/api/Dockerfile`):
```dockerfile
FROM public.ecr.aws/lambda/python:3.11
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.7.1 /lambda-adapter /opt/extensions/lambda-adapter
WORKDIR ${LAMBDA_TASK_ROOT}
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8000
ENV AWS_LWA_INVOKE_MODE=response_stream
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**requirements.txt**:
```
fastapi>=0.104.0
mangum>=0.17.0
boto3>=1.34.0
uvicorn>=0.24.0
pydantic>=2.0.0
```

**`.dockerignore`**:
- Python キャッシュ、egg、pytest キャッシュ、.env、venv

**現在の Terraform 設定** (`terraform/environments/prod/lambda-api/terragrunt.hcl`):
```hcl
terraform {
  source = "../../../modules/lambda-container"
}

inputs = {
  function_name = "api"
  timeout       = 30
  memory_size   = 512
  create_ecr_repository = true
  ecr_repository_name   = "smarthome-sensor-api"
  image_tag             = "latest"
  image_tag_mutability  = "MUTABLE"
  scan_on_push          = true

  environment_variables = {
    TABLE_NAME = dependency.dynamodb.outputs.table_name
    DEVICE_ID  = get_env("SWITCHBOT_DEVICE_ID", "")
  }
}
```

**注目すべき点**:
- HTTP サーバーが必須なため、Lambda Web Adapter と uvicorn が必要
- イベント処理ではなく HTTP リクエスト・レスポンス処理
- メモリサイズが 512 MB（Poller は 128 MB）

#### Poller と API の差分
| 項目 | Poller | API |
|------|--------|-----|
| トリガー | EventBridge | Lambda Function URL（HTTP） |
| サーバー | 不要 | FastAPI + uvicorn |
| Handler 型 | event handler | HTTP request/response |
| 外部 API | Switchbot API（outbound） | なし（DynamoDB read） |
| DynamoDB | Put のみ | Get/Query のみ |
| Lambda Web Adapter | **不要** | **必須** |
| メモリ | 128 MB | 512 MB |
| 依存数 | 2 個 | 5 個 |

---

### 2.3 lambda-container モジュールの構成

#### `terraform/modules/lambda-container/main.tf`
**機能**:
- ECR リポジトリ作成（条件付き）
- ECR ライフサイクルポリシー（最新 10 イメージ保持）
- Lambda 関数（`package_type = "Image"`）
- IAM ロール・ポリシー：CloudWatch Logs、DynamoDB アクセス、ECR pull
- Lambda Function URL（パブリックアクセス）- **Poller には不要**

**重要な詳細**:
- `image_uri` が指定されていない場合、ECR リポジトリ URL + image_tag で自動生成
- ECR pull パーミッション自動付与
- IAM DynamoDB ポリシー：`GetItem`, `Query`, `Scan` のみ（Poller は PutItem が必要）

**Poller への影響**:
- DynamoDB ポリシーを拡張する必要（PutItem 追加）
- Lambda Function URL は Poller には不要（EventBridge トリガーを使用）

#### `terraform/modules/lambda-container/variables.tf`

**重要な変数**:
- `function_name`: "poller" に変更
- `timeout`: 30 秒（現在の設定と同じ）
- `memory_size`: 128 MB（現在の設定と同じ）
- `create_ecr_repository`: true（デフォルト）
- `ecr_repository_name`: "smarthome-sensor-poller" など明示指定可
- `image_tag`: "latest"（デフォルト）
- `environment_variables`: DEVICE_ID, TABLE_NAME, SWITCHBOT_TOKEN, SWITCHBOT_SECRET
- `dynamodb_table_arn`: DynamoDB テーブルの ARN

**`schedule_expression` は lambda-container モジュールにない**:
- Poller 用に EventBridge スケジュール機能を追加する必要あり
- または、lambda-container モジュールを拡張する

#### `terraform/modules/lambda-container/outputs.tf`

**出力値**:
- `function_name`: Lambda 関数名
- `function_arn`: Lambda 関数 ARN
- `function_url`: Lambda Function URL
- `ecr_repository_url`: Docker push に使用する URL
- `ecr_repository_arn`: ECR リポジトリ ARN
- `ecr_registry_id`: AWS アカウント ID

---

### 2.4 既存パターンと実装方法

#### 1. ZIP モジュール（現在の Poller）での EventBridge 統合
**`terraform/modules/lambda/main.tf` より**:
```hcl
resource "aws_cloudwatch_event_rule" "schedule" {
  count               = var.schedule_expression != "" ? 1 : 0
  name                = "${var.project_name}-${var.environment}-${var.function_name}-schedule"
  schedule_expression = var.schedule_expression
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

**lambda-container モジュールにはこれがない**:
- EventBridge リソースが定義されていない
- Lambda Function URL のみ定義

---

### 2.5 CI/CD ワークフローの現状

#### `.github/workflows/terraform-apply.yml` での Lambda API ビルド・プッシュ

**Phase 1：ECR リポジトリ先行作成** （行 86-96）:
```yaml
- name: Apply Phase 1 - Create ECR repository
  if: (inputs.environment == 'all' || inputs.environment == 'lambda-api') && inputs.dry_run == false
  working-directory: terraform/environments/prod/lambda-api
  run: |
    terragrunt apply \
      -lock-timeout=5m \
      -no-color \
      -auto-approve \
      -target=aws_ecr_repository.this[0]
```

**Docker ビルド・プッシュ** （行 107-135）:
```yaml
- name: Build and push Docker image
  if: (inputs.environment == 'all' || inputs.environment == 'lambda-api') && inputs.dry_run == false
  env:
    ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com
    ECR_REPOSITORY: smarthome-sensor-api
    IMAGE_TAG: sha-${{ github.sha }}
  run: |
    SHORT_TAG=${IMAGE_TAG:0:11}
    aws ecr get-login-password --region ap-northeast-1 | \
      docker login --username AWS --password-stdin "${ECR_REGISTRY}"
    docker build \
      --platform linux/amd64 \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest" \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}" \
      lambda/api/
    docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}"
```

**既知の TODO**:
- Poller のビルドを同様に追加する必要
- ECR_REPOSITORY を動的に変更（api → poller）
- 条件判定を拡張（all / lambda-api 選択時 → all / lambda-api / lambda-poller 選択時）
- Apply Phase 1 の -target に poller ECR リポジトリを追加

---

## 3. 技術的背景

### 3.1 Docker コンテナ化の理由（Lambda の観点）

**ZIP デプロイの制約**:
- インストール済みパッケージサイズは 250 MB まで（解凍後 500 MB）
- Lambda レイヤー使用の複雑さ

**コンテナイメージの利点**:
- 最大 10 GB までのイメージサイズ対応
- Dockerfile で環境構築が明確
- ローカル開発環境との一貫性向上
- 将来のパッケージ拡張に対応しやすい

**現状**:
- Poller は依存パッケージが少ない（2 個）ため、コンテナ化は主に一貫性・保守性向上が目的

### 3.2 Lambda イメージの実行フロー

**非 HTTP イベント処理型（Poller）**:
```
EventBridge トリガー → Lambda エントリーポイント → lambda_handler(event, context) → 処理 → ロギング
```

**Lambda Web Adapter 不要**:
- Poller はイベント型ハンドラーなので、Lambda Web Adapter は不要
- Dockerfile で `CMD` に Python ハンドラーを直接指定可

### 3.3 Dockerfile 作成のガイドライン

#### AWS Lambda Python イメージベース
```dockerfile
FROM public.ecr.aws/lambda/python:3.11
```

- Lambda の実行環境に最適化
- AWS Lambda Runtime Interface Emulator（RIE）組込
- `/var/task` が LAMBDA_TASK_ROOT

#### Poller の Dockerfile（仮案）
```dockerfile
FROM public.ecr.aws/lambda/python:3.11

WORKDIR ${LAMBDA_TASK_ROOT}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Lambda イベントハンドラー指定
CMD ["lambda_function.lambda_handler"]
```

**Lambda Web Adapter 不要**:
- HTTP サーバーが不要なため、Lambda Web Adapter のマルチステージビルドは不要
- ビルドが簡潔

---

## 4. 制約と考慮事項

### 4.1 パフォーマンス・リソース

**Lambda Poller の特性**:
- 実行時間：通常 2-10 秒（Switchbot API リトライ含む）
- メモリ：現在 128 MB（適切と思われる）
- タイムアウト：30 秒（十分な余裕）
- 冷開始時間：コンテナイメージは ZIP より若干遅い（1-2 秒増）

**Docker イメージサイズ**:
- Lambda Python 3.11 ベースイメージ：～ 300 MB
- requirements.txt インストール後：～ 350 MB
- Poller コード：< 1 MB
- 総計：< 400 MB（Lambda コンテナイメージの 10 GB 制限内）

### 4.2 セキュリティ

**環境変数**:
- SWITCHBOT_TOKEN、SWITCHBOT_SECRET は GitHub Secrets から注入（Dockerfile に含まれない）
- ECR イメージスキャン：有効（API と同様、Trivy ベース）

**IAM パーミッション**:
- DynamoDB ポリシーに PutItem 追加が必須
- ECR pull パーミッション自動付与（lambda-container モジュール）

### 4.3 信頼性

**EventBridge トリガー**:
- EventBridge リソースを lambda-container モジュールに追加する必要
- または別の方法で EventBridge ルール・パーミッションを定義

**テスト**:
- 既存の pytest テスト（100% カバレッジ）は Docker イメージ内で実行可能
- Dockerfile に `CMD` を上書きして test 実行可能

---

## 5. 参考資料と設定値

### 5.1 重要なファイルパス

```
lambda/poller/lambda_function.py          # Poller 実装
lambda/poller/requirements.txt            # 依存パッケージ
lambda/poller/requirements-dev.txt        # 開発用パッケージ
lambda/poller/tests/                      # pytest テスト（100% カバレッジ）

terraform/modules/lambda/                 # 現在の ZIP モジュール
terraform/modules/lambda-container/       # コンテナモジュール（参考）
terraform/environments/prod/lambda-poller/terragrunt.hcl  # 修正対象
terraform/environments/prod/lambda-api/terragrunt.hcl     # 参考

.github/workflows/terraform-apply.yml     # CI/CD 修正対象
lambda/api/Dockerfile                     # 参考（API のコンテナ化済み）
```

### 5.2 Terraform 設定値（参考）

**lambda-api（既存）**:
- `ecr_repository_name`: `"smarthome-sensor-api"`
- `image_tag`: `"latest"`
- `memory_size`: 512 MB
- `timeout`: 30 秒
- `scan_on_push`: true

**lambda-poller（計画値）**:
- `ecr_repository_name`: `"smarthome-sensor-poller"`（仮）
- `image_tag`: `"latest"`
- `memory_size`: 128 MB（現在と同じ）
- `timeout`: 30 秒（現在と同じ）
- `scan_on_push`: true（API と統一）

### 5.3 環境変数

**Lambda 実行時環境変数**:
```
TABLE_NAME = <dynamodb-table-name>
DEVICE_ID = <switchbot-device-id>
SWITCHBOT_TOKEN = <switchbot-api-token>
SWITCHBOT_SECRET = <switchbot-api-secret>
SWITCHBOT_TIMEOUT_SECONDS = 5（オプション、デフォルト）
```

**CI/CD ワークフロー環境変数**:
```
AWS_ACCOUNT_ID = <from-secrets>
AWS_ROLE_ARN = <from-secrets>
SWITCHBOT_DEVICE_ID = <from-secrets>（未使用のため削除可）
```

---

## 6. 実装上の課題と決定ポイント

### 課題 1：EventBridge トリガーの管理

**問題**：lambda-container モジュールに EventBridge リソースがない

**選択肢**:
- **A) lambda-container モジュールを拡張する**（推奨）
  - `schedule_expression` 変数を追加
  - EventBridge Rule、Target、Permission を追加
  - poller・future Lambda にも対応可
  - 利点：モジュール側で完全に管理、再利用性高い
  - 欠点：モジュール修正が必要、API には不要なリソース

- **B) 別モジュール (eventbridge) を作成する**
  - Lambda 関数と EventBridge を疎結合に
  - 利点：関心事分離
  - 欠点：導入複雑度増加

- **C) terragrunt.hcl で EventBridge リソースを別途定義する**
  - lambda-container と別に eventbridge.tf を作成
  - 利点：既存 lambda-container に修正不要
  - 欠点：設定が分散

**推奨**：選択肢 A（lambda-container 拡張）
- 既存の「スケジュール式ハンドラー」パターンが明確
- 将来の複数 Lambda トリガー対応に対応可
- Terraform コード再利用性向上

### 課題 2：DynamoDB IAM ポリシーの権限

**問題**：lambda-container の DynamoDB ポリシーは GetItem/Query/Scan のみ

**現在の lambda/main.tf（ZIP）**:
```hcl
"dynamodb:PutItem",
"dynamodb:GetItem",
"dynamodb:Query",
"dynamodb:Scan"
```

**lambda-container/main.tf（コンテナ）**:
```hcl
"dynamodb:GetItem",
"dynamodb:Query",
"dynamodb:Scan"
```

**解決策**:
- lambda-container モジュール内で PutItem を追加（API は不要だが、Poller には必須）
- または、`allow_dynamodb_write` 変数を追加して条件付け

**推奨**：モジュール側で PutItem を常に許可
- Poller が必要なため
- 権限過剰は最小限、不必要に参照可能なデータなし

### 課題 3：Dockerfile で Lambda Web Adapter を含めるかどうか

**問題**：Poller は HTTP サーバー不要、API は必須

**選択肢**:
- **A) Poller 専用 Dockerfile を作成**（推奨）
  - Lambda Web Adapter なし
  - ビルド時間短縮
  - イメージサイズ削減

- **B) 統一 Dockerfile（Lambda Web Adapter 含む）**
  - API との一貫性
  - 将来 Poller を HTTP 化する場合に対応
  - イメージサイズわずか増加

**推奨**：選択肢 A（Poller 専用 Dockerfile）
- 現在のアーキテクチャでは不要
- YAGNI 原則に従う

### 課題 4：ECR リポジトリ名の決定

**選択肢**:
- `smarthome-sensor-poller`
- `smarthome-poller`
- `poller`（AWS アカウント内で一意なら可）

**推奨**：`smarthome-sensor-poller`
- API の `smarthome-sensor-api` と命名規則統一
- プロジェクト内で一意で検索性向上

---

## 7. 推奨される実装方針

### 7.1 全体フロー

```
1. lambda/poller/Dockerfile 作成
   - Lambda Web Adapter なし
   - CMD でイベントハンドラーを指定

2. lambda-container モジュールを拡張
   - schedule_expression 変数追加
   - EventBridge Rule、Target、Permission 追加
   - DynamoDB ポリシーに PutItem 追加（全 Lambda 向け）

3. terraform/environments/prod/lambda-poller/terragrunt.hcl 修正
   - terraform source を lambda-container に変更
   - ECR リポジトリ設定追加
   - schedule_expression を inputs に追加

4. .github/workflows/terraform-apply.yml 拡張
   - Apply Phase 1 に lambda-poller ECR リポジトリ先行作成
   - Docker ビルド・プッシュステップに poller 追加
   - 条件判定を拡張（environment 判定ロジック変更）
```

### 7.2 Dockerfile（Poller 専用）

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

WORKDIR ${LAMBDA_TASK_ROOT}

# 依存パッケージをインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコードをコピー
COPY . .

# Lambda イベントハンドラー
CMD ["lambda_function.lambda_handler"]
```

### 7.3 lambda-container モジュール拡張案

**variables.tf に追加**:
```hcl
variable "schedule_expression" {
  description = "EventBridge スケジュール式（例：rate(2 minutes)）"
  type        = string
  default     = ""
}
```

**main.tf に追加**:
```hcl
# EventBridge (CloudWatch Events) スケジュール
resource "aws_cloudwatch_event_rule" "schedule" {
  count               = var.schedule_expression != "" ? 1 : 0
  name                = "${var.project_name}-${var.environment}-${var.function_name}-schedule"
  schedule_expression = var.schedule_expression
  description         = "Trigger ${var.function_name} Lambda function"
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

**DynamoDB ポリシー修正**:
```hcl
resource "aws_iam_role_policy" "lambda_dynamodb" {
  count = var.dynamodb_table_arn != "" ? 1 : 0
  role  = aws_iam_role.lambda_role.id
  name  = "dynamodb-access"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",    # ← 追加（Poller 向け）
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = var.dynamodb_table_arn
    }]
  })
}
```

### 7.4 terraform/environments/prod/lambda-poller/terragrunt.hcl 修正案

```hcl
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/lambda-container"  # ← 変更
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

  # EventBridge スケジュール（新規）
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

### 7.5 .github/workflows/terraform-apply.yml 拡張案

**環境選択肢に lambda-poller を追加** (行 14):
```yaml
options:
  - all
  - dynamodb
  - lambda-api
  - lambda-poller  # ← 追加
  - cloudfront
```

**Apply Phase 1 拡張** (行 86-96):
```yaml
- name: Apply Phase 1 - Create ECR repositories
  if: (inputs.environment == 'all' || inputs.environment == 'lambda-api' || inputs.environment == 'lambda-poller') && inputs.dry_run == false
  working-directory: terraform/environments/prod
  run: |
    # lambda-api の ECR リポジトリ
    if [[ "${{ inputs.environment }}" == "all" || "${{ inputs.environment }}" == "lambda-api" ]]; then
      (cd lambda-api && terragrunt apply \
        -lock-timeout=5m \
        -no-color \
        -auto-approve \
        -target=aws_ecr_repository.this[0])
    fi

    # lambda-poller の ECR リポジトリ
    if [[ "${{ inputs.environment }}" == "all" || "${{ inputs.environment }}" == "lambda-poller" ]]; then
      (cd lambda-poller && terragrunt apply \
        -lock-timeout=5m \
        -no-color \
        -auto-approve \
        -target=aws_ecr_repository.this[0])
    fi
```

**Docker ビルド・プッシュステップの拡張案** (行 107-135):

```yaml
# lambda-api イメージビルド・プッシュ
- name: Build and push Docker image (lambda-api)
  if: (inputs.environment == 'all' || inputs.environment == 'lambda-api') && inputs.dry_run == false
  env:
    ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com
    ECR_REPOSITORY: smarthome-sensor-api
    IMAGE_TAG: sha-${{ github.sha }}
  run: |
    SHORT_TAG=${IMAGE_TAG:0:11}
    aws ecr get-login-password --region ap-northeast-1 | \
      docker login --username AWS --password-stdin "${ECR_REGISTRY}"
    docker build \
      --platform linux/amd64 \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest" \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}" \
      lambda/api/
    docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}"
    echo "Pushed: ${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    echo "Pushed: ${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}"

# lambda-poller イメージビルド・プッシュ（新規）
- name: Build and push Docker image (lambda-poller)
  if: (inputs.environment == 'all' || inputs.environment == 'lambda-poller') && inputs.dry_run == false
  env:
    ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com
    ECR_REPOSITORY: smarthome-sensor-poller
    IMAGE_TAG: sha-${{ github.sha }}
  run: |
    SHORT_TAG=${IMAGE_TAG:0:11}
    aws ecr get-login-password --region ap-northeast-1 | \
      docker login --username AWS --password-stdin "${ECR_REGISTRY}"
    docker build \
      --platform linux/amd64 \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest" \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}" \
      lambda/poller/
    docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}"
    echo "Pushed: ${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    echo "Pushed: ${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_TAG}"
```

---

## 8. 既知の制限と将来の拡張

### 現在の制限
1. **EventBridge トリガー**：lambda-container モジュールに未実装、拡張が必要
2. **DynamoDB PutItem**：lambda-container に追加の修正が必要
3. **タグ戦略**：`latest` 固定（commit hash タグも併用可）
4. **マルチプラットフォーム**：Linux/x86_64（Lambda 環境）に限定

### 将来の拡張
1. **より多くの Lambda のコンテナ化**：将来の新規 Lambda はコンテナベースに
2. **イメージ署名**：Cosign による署名・検証
3. **タグ戦略の高度化**：semantic version の自動付与
4. **ECR イメージキャッシュ**：GitHub Actions での層キャッシュ活用

---

## 9. 質問・決定が必要な事項

1. **lambda-container モジュール拡張の承認**：EventBridge と DynamoDB PutItem をモジュールに追加することで、他の Lambda にも対応可能な設計にするか？

2. **ECR リポジトリ名**：`smarthome-sensor-poller` で確定か、別の命名規則を優先するか？

3. **イメージタグ戦略**：`latest` で固定か、commit hash タグ（`sha-XXXXXXX`）も併用するか？

4. **DynamoDB ポリシー**：lambda-container の DynamoDB アクション一覧に PutItem を常に含める（他の読み取り専用 Lambda には不要でも）か？

5. **Dockerfile での .dockerignore**：lambda/poller/.dockerignore を新規作成するか、API と共通化するか？

---

## 10. 重要な発見と要約

### 主な発見

1. **lambda-poller は HTTP サーバー不要**
   - Lambda Web Adapter を含める必要がない
   - Dockerfile がシンプル（API 比較で 3 行削減）

2. **lambda-container モジュールは不完全**
   - EventBridge トリガーがない（Poller 専用機能）
   - DynamoDB 書き込み権限がない（Poller 専用）
   - Lambda Function URL は Poller には不要

3. **既知の TODO が実装計画を示唆**
   - `.github/workflows/terraform-apply.yml` 行 100-105 に TODO コメント
   - Phase 1 ECR リポジトリ先行作成、Docker ビルド・プッシュ、Apply フェーズの構成

4. **CI/CD 側での複雑度**
   - 環境選択によって条件分岐が増加
   - `all` 選択時の並列実行制御が必須

5. **テストの継続性**
   - 既存の pytest 100% カバレッジテストがそのまま利用可
   - Dockerfile でテスト実行可能

### 推奨アプローチのまとめ

| 項目 | 推奨 | 理由 |
|------|------|------|
| Dockerfile | Poller 専用（Lambda Web Adapter 除外） | シンプル化、不要機能排除 |
| lambda-container 拡張 | EventBridge + PutItem 追加 | 将来の Lambda 対応、再利用性 |
| ECR リポジトリ名 | `smarthome-sensor-poller` | API との命名規則統一 |
| タグ戦略 | `latest` 固定（commit タグ併用可） | シンプル、拡張性 |
| ワークフロー構成 | Phase 1（ECR）→ ビルド・プッシュ → Phase 2（apply）| 依存関係の明確化 |

---

## 参考

### 重要なファイルパス（絶対パス）
- `/Users/riku/Work/smarthome/lambda/poller/lambda_function.py`
- `/Users/riku/Work/smarthome/lambda/poller/requirements.txt`
- `/Users/riku/Work/smarthome/lambda/api/Dockerfile`
- `/Users/riku/Work/smarthome/terraform/modules/lambda-container/main.tf`
- `/Users/riku/Work/smarthome/terraform/modules/lambda-container/variables.tf`
- `/Users/riku/Work/smarthome/terraform/environments/prod/lambda-poller/terragrunt.hcl`
- `/Users/riku/Work/smarthome/terraform/environments/prod/lambda-api/terragrunt.hcl`
- `/Users/riku/Work/smarthome/.github/workflows/terraform-apply.yml`

### 関連ドキュメント
- `/Users/riku/Work/smarthome/docs/exec-plans/active/docker-build-research.md` - Docker ビルド・ECR 統合の詳細
- `/Users/riku/Work/smarthome/ARCHITECTURE.md` - Lambda アーキテクチャ詳細（行 189-224）
