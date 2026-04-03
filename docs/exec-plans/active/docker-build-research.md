# Docker イメージビルド・ECR プッシュの統合調査

**作成日**: 2026-03-31
**対象**: `.github/workflows/terraform-apply.yml` への Docker ビルド・ECR プッシュ機能統合

---

## 1. タスク理解

### 目標
Terraform Apply ワークフロー内で、Lambda API のコンテナイメージをビルドし ECR にプッシュする機能を実装する

### 現状の問題
- `terraform apply` でコンテナイメージベースの Lambda (`lambda-api`) を作成しようとするが、ECR に存在するべきイメージが無いと失敗
- 現在、`terragrunt run-all -- apply` は全環境を並列実行するため、イメージプッシュが Lambda apply の前に完了していることが必須
- ワークフロー上でイメージビルド・プッシュが存在せず、手動対応が必要な状態

### 成功基準
1. `environment: all` 選択時：DynamoDB → イメージビルド・プッシュ → Lambda apply（依存関係が適切に解決）
2. `environment: lambda-api` 選択時：イメージビルド・プッシュが自動的に実行される
3. `dry_run: true` 時：イメージビルド・プッシュはスキップ
4. イメージ既存時の上書き動作が定義されている
5. `environment: lambda-poller` など他モジュール選択時は不要なビルドが実行されない

---

## 2. 現状分析

### 関連コード

#### GitHub Actions ワークフロー
- **`.github/workflows/terraform-apply.yml`** （行 1-111）
  - 入力: `environment` （all/dynamodb/lambda-api/lambda-poller/cloudfront）
  - 入力: `dry_run` （デフォルト false）
  - 現在の構成：
    - AWS OIDC 認証設定
    - Terraform / Terragrunt セットアップ
    - `environment: all` 時：`terragrunt run --all -- plan` → `terragrunt run --all -- apply`
    - `environment: (single)` 時：該当モジュール配下で `terragrunt plan` → `terragrunt apply`
  - Docker / ECR 関連のステップは存在しない

#### Lambda API コンテナ設定
- **`lambda/api/Dockerfile`** （行 1-22）
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
  - FastAPI + Lambda Web Adapter
  - ビルド時に `requirements.txt` をインストール
  - `.dockerignore` で Python キャッシュ、pytest キャッシュ等を除外

- **`lambda/api/requirements.txt`**
  ```
  fastapi>=0.104.0
  mangum>=0.17.0
  boto3>=1.34.0
  uvicorn>=0.24.0
  pydantic>=2.0.0
  ```

#### ECR リポジトリ設定
- **`terraform/modules/lambda-container/main.tf`** （行 1-153）
  - `aws_ecr_repository` リソース：リポジトリ作成、ライフサイクルポリシー（最新 10 イメージ保持）
  - `aws_lambda_function`：`package_type = "Image"` で `image_uri` を指定
  - IAM ポリシー：ECR pull 権限を Lambda に付与

- **`terraform/modules/lambda-container/variables.tf`**
  - `create_ecr_repository`：ECR リポジトリ自動作成（デフォルト true）
  - `ecr_repository_name`：リポジトリ名（デフォルト `{project_name}-{function_name}`）
  - `image_uri`：明示指定があれば優先（デフォルト空）
  - `image_tag`：イメージタグ（デフォルト "latest"）
  - `image_tag_mutability`：MUTABLE / IMMUTABLE（デフォルト MUTABLE）
  - `scan_on_push`：プッシュ時スキャン有効（デフォルト true）

- **`terraform/modules/lambda-container/outputs.tf`**
  - `ecr_repository_url`：Docker push に使用する URL
  - `ecr_registry_id`：AWS アカウント ID

- **`terraform/environments/prod/lambda-api/terragrunt.hcl`** （行 1-38）
  ```hcl
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

#### Terragrunt ルート設定
- **`terraform/terragrunt.hcl`** （行 1-55）
  - リモートステート：S3 バケット `smarthome-terraform-state-${AWS_ACCOUNT_ID}`
  - AWS プロバイダー自動生成
  - リージョン：`ap-northeast-1`

### 既存パターン

#### GitHub Actions での AWS リソース操作
- `terraform-apply.yml`: AWS OIDC 認証で `aws-actions/configure-aws-credentials@v4` を使用
- `terraform-ci.yml`: 同様に OIDC 認証をセットアップ
- 環境変数：`AWS_ACCOUNT_ID`、`SWITCHBOT_DEVICE_ID` を secrets から取得

#### ワークフロー設計のパターン
- **段階分離**：フォーマットチェック → バリデーション → プラン → セキュリティスキャン → 実装
- **条件付き実行**：`if:` で environment 選択、dry_run フラグに応じて処理分岐
- **環境変数の設定**：`env:` セクションで ワークフロー全体で利用可能な変数を定義

---

## 3. 技術的背景

### Docker イメージビルド・プッシュのフロー

**標準的な GitHub Actions での手順**:
1. AWS OIDC 認証 → AWS 認証情報を環境に設定
2. AWS CLI で ECR ログイン：`aws ecr get-login-password | docker login`
3. Docker イメージビルド：`docker build -t <repository-url>:latest .`
4. ECR へプッシュ：`docker push <repository-url>:latest`

**AWS 公式アクション活用法**:
- `aws-actions/configure-aws-credentials@v4` で認証後、`aws ecr` コマンド直接実行
- または `docker/build-push-action@v5` + `docker/login-action@v3` を使用（マトリックス対応、キャッシュ機能あり）

### Terragrunt での依存関係管理

**課題**：`terragrunt run-all` は全モジュールを並列実行するため、明示的な依存関係ステップが必須
- DynamoDB 作成完了 → ECR リポジトリ作成完了 → イメージプッシュ完了 → Lambda apply

**解決策**：ワークフロー側で段階を分けるのが確実
- **段階 1**：DynamoDB + ECR リポジトリ作成のみ
- **段階 2**：Docker ビルド・プッシュ
- **段階 3**：Lambda（API / Poller）apply

### ECR リポジトリの出力値取得

Terragrunt では `run-all` 後に出力値を取得しにくい設計のため、単一モジュール apply 時は以下の方法で ECR URL を取得可能：

```bash
cd terraform/environments/prod/lambda-api
terragrunt output ecr_repository_url
```

また、Terragrunt が生成する `terraform.tfstate` から読み込む方法もあるが、複雑。

---

## 4. 制約と考慮事項

### パフォーマンス
- Docker ビルド：`lambda/api/` は小規模（`main.py` ～ 7KB、requirements ～ 5 パッケージ）なため 1-2 分程度で完了
- `docker/build-push-action` の層キャッシュ機能を活用すれば、再度のプッシュ時は 30 秒程度に短縮可能

### セキュリティ
- ECR ログイン認証：AWS OIDC トークンから取得、GitHub secrets 不要（現在、`AWS_ACCOUNT_ID` は secrets から取得）
- Docker イメージ署名：現在設定なし（オプション）
- ECR Scan on Push：有効（`scan_on_push: true`）

### 信頼性
- **イメージキャッシング**：タグ MUTABLE なため上書き可能、再デプロイ時は同じタグで置き換え
- **ビルド失敗時の処理**：Docker ビルド失敗 → apply スキップ、明確なエラーメッセージ表示
- **環境変数の可用性**：`lambda/api` ビルド時に `SWITCHBOT_DEVICE_ID` 不要（実行時環境変数）

### テスト
- Lambda コードには pytest で 93% のカバレッジあり（`lambda/api/tests/`）
- ワークフロー上では、ビルド成功 + プッシュ成功のみ確認可能

---

## 5. 参考資料

### GitHub Actions と Docker
- `docker/build-push-action` v5：マルチプラットフォーム対応、層キャッシュ、構文シンプル
- `docker/login-action` v3：ECR / DockerHub / その他レジストリに対応
- AWS CLI `ecr get-login-password`：OIDC トークン統合対応

### AWS と ECR
- `aws ecr describe-repositories --repository-names` で存在確認
- `aws ecr batch-delete-image` で古いイメージ削除（ライフサイクルポリシーが自動実行）

### Terragrunt
- `run-all --no-dependency-graph`：依存関係無視の完全並列実行（非推奨）
- `dependency` ブロック内の `mock_outputs`：plan時のダミー値

---

## 6. 実装上の課題と決定ポイント

### 課題 1：`environment: all` での実行順序
**問題**：`terragrunt run-all` は依存関係を自動解析するが、外部ステップ（Docker ビルド）は認識しない

**選択肢**:
- **A) Terraform apply を 2 段階に分割する**（推奨）
  - Step 1: `terragrunt run-all -- apply` で DynamoDB + ECR リポジトリ作成
  - Step 2: Docker ビルド・プッシュ
  - Step 3: `terragrunt apply` で Lambda apply（ECR を明示指定）
  - 利点：依存関係が明確、制御可能
  - 欠点：apply ステップが増える

- **B) Single module 実行に限定する**
  - `environment: all` を廃止、個別選択のみ
  - 利点：シンプル
  - 欠点：全環境一括デプロイユースケースが失われる

### 課題 2：`environment: lambda-api` 個別選択時のビルド
**問題**：個別選択時も ECR リポジトリが既に存在するなら、イメージビルド・プッシュが必要

**解決策**：
- ワークフローで `environment` を判定、`lambda-api` または `all` の場合のみビルドを実行
- `if: contains(fromJSON('["all", "lambda-api"]'), inputs.environment)`

### 課題 3：`dry_run: true` 時の処理
**問題**：`dry_run: true` なら apply はスキップされるべき

**解決策**：
- ビルド・プッシュも同様にスキップ
- `if: inputs.dry_run == false` で guard する

### 課題 4：イメージが既に存在する場合
**問題**：再デプロイ時、同じタグ `latest` で上書きすべき

**現状**：
- `image_tag_mutability: MUTABLE` なので上書き可能
- `docker push` で同じタグを再プッシュすれば置き換わる
- ワークフロー上で特別な処理不要

### 課題 5：イメージタグの決定方法
**選択肢**:
- **A) `latest` で固定**（現在設定）
  - 利点：シンプル、常に最新がデプロイ
  - 欠点：イメージ履歴追跡が難しい

- **B) Git commit hash を使用**（例：`sha-abc1234`）
  - 利点：イメージ履歴が git コミットと紐付く
  - 欠点：複雑度増加、Terraform で commit hash を知る必要

- **C) Semantic version + short hash**（例：`1.0.0-abc1234`）
  - 利点：バージョニング + 細粒度追跡
  - 欠点：実装複雑

**推奨**：A（`latest` 固定）で開始、後で拡張可能

---

## 7. 推奨される実装方針

### 全体フロー（`environment: all` の場合）

```
1. [AWS 認証] AWS OIDC トークン取得
2. [Terraform Setup] Terraform / Terragrunt インストール
3. [ECR リポジトリ作成] terragrunt run-all -- apply で dynamodb + ecr リポジトリのみ作成
   - 現在の設定では、dynamodb.tf と lambda-container/main.tf (ecr部分) を selectする工夫が必要
   - または、独立した ecr-repo モジュールを作成する
4. [Docker ビルド・プッシュ] lambda/api/Dockerfile ビルド → ECR プッシュ
   - ecr_repository_url を Terraform output から取得
   - 環境変数設定：ECR_REPOSITORY_URL, IMAGE_TAG, AWS_ACCOUNT_ID
5. [Lambda Apply] terragrunt run-all -- apply で Lambda（API / Poller）を作成
   - image_uri は ECR リポジトリ URL と tag の組み合わせ（既にプッシュ済み）
```

### 個別実行時（`environment: lambda-api` の場合）

```
1. [AWS 認証]
2. [Terraform Setup]
3. [ECR リポジトリ作成] terragrunt apply で ecr リポジトリ作成（既存なら skip）
4. [Docker ビルド・プッシュ]
5. [Lambda API Apply] terragrunt apply
```

### 実装上の詳細

**イメージビルド・プッシュのステップ案**:

```yaml
- name: Get ECR Repository URL
  id: ecr
  working-directory: terraform/environments/prod/lambda-api
  run: |
    terragrunt output -raw ecr_repository_url > /tmp/ecr_url.txt
    ECR_URL=$(cat /tmp/ecr_url.txt)
    echo "url=$ECR_URL" >> $GITHUB_OUTPUT
    echo "ECR Repository URL: $ECR_URL"

- name: Build and Push Docker Image
  uses: docker/build-push-action@v5
  if: inputs.dry_run == false && contains(fromJSON('["all", "lambda-api"]'), inputs.environment)
  with:
    context: lambda/api
    push: true
    tags: ${{ steps.ecr.outputs.url }}:latest
    cache-from: type=registry,ref=${{ steps.ecr.outputs.url }}:latest
    cache-to: type=inline
```

**または AWS CLI を使用する方法**:

```bash
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin $ECR_REPOSITORY_URL

docker build -t $ECR_REPOSITORY_URL:latest lambda/api
docker push $ECR_REPOSITORY_URL:latest
```

---

## 8. 既知の制限と今後の拡張

### 現在の制限
1. **単一 Lambda イメージ**：`lambda-api` のみ対応、`lambda-poller` は zip パッケージのため対象外
2. **タグ戦略が単純**：`latest` 固定、セマンティックバージョニングなし
3. **イメージスキャン**：ECR Scan on Push は有効だが、失敗時の処理がない（AWS側で自動スキップ）
4. **マルチプラットフォーム**：Linux/ARM64（Lambda 環境）に限定、Windows 等は対象外

### 将来の拡張
1. **複数 Lambda イメージ対応**：`lambda-poller` をコンテナ化する場合
2. **イメージ署名**：Cosign や Notary による署名・検証
3. **セマンティックバージョニング**：package.json や VERSION ファイルからバージョン取得
4. **キャッシュ最適化**：GitHub Container Registry キャッシュ活用

---

## 9. ファイルと参照

### 重要なファイルパス
```
.github/workflows/terraform-apply.yml        # 修正対象
lambda/api/Dockerfile                        # ビルド対象
lambda/api/requirements.txt
lambda/api/.dockerignore
terraform/modules/lambda-container/main.tf   # ECR リポジトリ定義
terraform/modules/lambda-container/variables.tf
terraform/modules/lambda-container/outputs.tf
terraform/environments/prod/lambda-api/terragrunt.hcl  # ECR 設定・出力取得源
```

### Terraform 変数確認
- `ecr_repository_name`: `"smarthome-sensor-api"`
- `image_tag`: `"latest"`
- `image_tag_mutability`: `"MUTABLE"`
- `scan_on_push`: `true`
- AWS_ACCOUNT_ID: `secrets.AWS_ACCOUNT_ID`
- リージョン: `ap-northeast-1`

### GitHub Secrets（利用可能）
- `AWS_ACCOUNT_ID` ✓
- `AWS_ROLE_ARN` ✓
- `SWITCHBOT_DEVICE_ID` ✓

---

## 10. 質問・決定が必要な事項

1. **実装アプローチ**：上記「課題 1」の選択肢 A（apply 2 段階分割）が推奨だが、確認が必要か？

2. **イメージタグ戦略**：`latest` 固定でよいか、または commit hash を含めたタグにするか？

3. **ECR 出力値の取得方法**：Terraform output コマンドで動的に取得するか、terragrunt.hcl に出力を追加するか？

4. **dry_run 時の ECR リポジトリ作成**：`dry_run: true` でも ECR リポジトリは作成すべきか、それともスキップするか？

5. **`lambda-poller` のコンテナ化計画**：近々実施予定があるか？（あれば、この機能を拡張可能な設計にする）

---

## 概要

このプロジェクトでは、Terraform Apply ワークフローに Docker ビルド・ECR プッシュを統合する必要があります。

**主な発見**：
- Lambda API は FastAPI + コンテナベース（Dockerfile 完備）、ECR リポジトリは Terraform で自動作成可能
- 現状、ワークフロー内に Docker ビルド・プッシュのステップがなく、手動対応が必要
- `terragrunt run-all` の並列実行と外部ステップ（Docker ビルド）の依存関係調整が主な課題

**推奨アプローチ**：
- apply を 2 段階に分割（ECR リポジトリ作成 → Docker ビルド・プッシュ → Lambda apply）
- `environment` フラグで条件付き実行（`all` または `lambda-api` 選択時のみビルド）
- `docker/build-push-action` または AWS CLI を使用して ECR にプッシュ
- イメージタグは `latest` で固定、将来の拡張が容易な設計

**実装時のポイント**：
- Terragrunt output で ECR リポジトリ URL を動的取得
- `dry_run: true` 時はビルド・プッシュをスキップ
- Docker ビルド失敗時に apply をスキップし、エラーを明確に表示
