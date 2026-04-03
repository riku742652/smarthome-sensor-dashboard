# 実装計画: Terraform Apply ワークフローへの Docker ビルド・ECR プッシュ統合

**作成日**: 2026-03-31
**対象ファイル**: `.github/workflows/terraform-apply.yml`
**参照リサーチ**: `docs/exec-plans/active/docker-build-research.md`

---

## Goal and Success Criteria

**Goal**: `terraform-apply.yml` ワークフローに Docker ビルド・ECR プッシュのステップを統合し、Lambda API のコンテナイメージが自動的にビルド・プッシュされるようにする。`environment: all` および `environment: lambda-api` 選択時に、ECR リポジトリ作成 → Docker ビルド・プッシュ → Lambda apply という正しい順序で実行されることを保証する。

**Success Criteria**:
- [ ] `environment: all` 選択時に、ECR リポジトリ作成 → Docker ビルド・プッシュ → 全環境 apply の順で実行される
- [ ] `environment: lambda-api` 選択時に、ECR リポジトリ作成 → Docker ビルド・プッシュ → Lambda apply の順で実行される
- [ ] `dry_run: true` の場合、Docker ビルド・プッシュがスキップされ、plan のみ実行される
- [ ] `environment: dynamodb`、`lambda-poller`、`cloudfront` 選択時は Docker ビルドが実行されない
- [ ] イメージに `latest` と `sha-<7文字>` の両方のタグが付与される
- [ ] ビルド失敗時にわかりやすいエラーメッセージが表示され、後続の apply がスキップされる
- [ ] 将来の `lambda-poller` コンテナ化に備えたコメントが残されている

---

## Architectural Changes

### 変更ファイル
- `.github/workflows/terraform-apply.yml` — Docker ビルド・ECR プッシュのステップ追加、`environment: all` の apply を 2 フェーズに分割

### 新規ファイル
なし（変更対象は workflow ファイルのみ）

### 依存関係
- **追加なし**: 既存の AWS OIDC 認証を使用するため、新たな GitHub Actions シークレットは不要
- `AWS_ACCOUNT_ID`、`AWS_ROLE_ARN`、`SWITCHBOT_DEVICE_ID` は既存 secrets を流用

---

## Implementation Steps

### Step 1: `-target` オプションによる ECR リポジトリ先行作成の検討

**目的**: `terragrunt run-all` の前に ECR リポジトリのみを先に作成する方法を確定する

**背景と制約分析**:

Terragrunt 0.96.1 は Terraform の `-target` オプションをサポートしています。
`terragrunt apply -- -target=aws_ecr_repository.this` という構文で ECR リポジトリリソースのみを先行作成できます。

ただし、`run-all` と `-target` の組み合わせには制限があります：
- `terragrunt run-all -- apply -target=aws_ecr_repository.this` は構文としては有効ですが、**全モジュール**に対してそのターゲット指定が適用されるため、DynamoDB など関係のないモジュールも `-target` で絞り込まれてしまいます
- 結果として、`lambda-api` モジュールの ECR リポジトリのみを狙い打ちにすることが `run-all` では困難

**採用する解決策（2フェーズ apply）**:

`environment: all` の場合：
1. `lambda-api` モジュール配下で `terragrunt apply -- -target=aws_ecr_repository.this` を実行し ECR リポジトリのみ作成
2. Docker ビルド・プッシュ
3. `terragrunt run --all -- apply` で全環境を apply（Lambda も含む）

この方式のメリット：
- `-target` を単一モジュール（`lambda-api`）配下で実行するため、他モジュールに影響しない
- `run-all` の依存関係グラフ（dynamodb → lambda-api）が最終 apply では正常に機能する
- DynamoDB は Step 3 の `run-all` で作成されるが、`lambda-api` は DynamoDB への `dependency` ブロックを持つため、Terragrunt が自動で依存順序を解決する

**注意事項**:
- Terraform は `-target` 使用時に「This targeted apply may taint other resources」という警告を出すが、ECR リポジトリは他リソースへの依存がないため安全
- `lambda-api` の apply で Lambda 本体は作成されない（`-target` で ECR のみ指定するため）

**完了条件**:
- [ ] 採用方式をこのステップで確定（2フェーズ apply + `-target`）

---

### Step 2: `environment: all` 用の apply フローを 2 フェーズに分割

**目的**: 既存の "Apply (run-all)" ステップを廃止し、ECR 先行作成フェーズを挿入する

**変更前の構造**:
```yaml
- name: Apply (run-all)
  if: inputs.environment == 'all' && inputs.dry_run == false
  working-directory: terraform/environments/prod
  run: |
    terragrunt run --all -- apply \
      -lock-timeout=5m \
      -no-color \
      -auto-approve
```

**変更後の構造**（3ステップに分割）:

```yaml
# フェーズ 1: ECR リポジトリを先に作成（lambda-api モジュール配下で -target 使用）
- name: Apply Phase 1 - Create ECR Repository (run-all)
  if: inputs.environment == 'all' && inputs.dry_run == false
  working-directory: terraform/environments/prod/lambda-api
  run: |
    terragrunt apply \
      -lock-timeout=5m \
      -no-color \
      -auto-approve \
      -target=aws_ecr_repository.this

# フェーズ 2 はステップ 3（Docker ビルド・プッシュ）で実施

# フェーズ 3: 全環境を apply
- name: Apply Phase 3 - Full Apply (run-all)
  if: inputs.environment == 'all' && inputs.dry_run == false
  working-directory: terraform/environments/prod
  run: |
    terragrunt run --all -- apply \
      -lock-timeout=5m \
      -no-color \
      -auto-approve
```

**完了条件**:
- [ ] "Apply (run-all)" ステップが "Apply Phase 1" と "Apply Phase 3" に分割されている
- [ ] "Apply Phase 1" は `terraform/environments/prod/lambda-api` 配下で `-target=aws_ecr_repository.this` 付きで実行される
- [ ] "Apply Phase 3" は `terraform/environments/prod` 配下で `run --all` で実行される

---

### Step 3: Docker ビルド・ECR プッシュのステップを追加

**目的**: ECR リポジトリ作成後、Lambda apply 前にイメージをビルド・プッシュする

**ECR URL の取得方法**:

ECR URL は `<AWS_ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api` という固定パターンになるため、`terragrunt output` を実行して動的取得するより、secrets から組み立てる方が堅牢かつシンプルです。

```yaml
- name: Build and Push Docker Image (lambda-api)
  if: >-
    inputs.dry_run == false &&
    (inputs.environment == 'all' || inputs.environment == 'lambda-api')
  env:
    ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com
    ECR_REPOSITORY: smarthome-sensor-api
    IMAGE_TAG: sha-${{ github.sha[:7] }}
  run: |
    # ECR ログイン
    aws ecr get-login-password --region ap-northeast-1 \
      | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

    # Docker イメージビルド（linux/amd64 を明示）
    docker build \
      --platform linux/amd64 \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest" \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:sha-${{ github.sha }}" \
      lambda/api

    # ECR へプッシュ（latest タグ）
    docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"

    # ECR へプッシュ（commit hash タグ: sha-<7文字>）
    docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:sha-${{ github.sha }}"
```

**注意**:
- `github.sha` は GitHub Actions の組み込み変数（40文字の SHA）
- 7文字に切り詰めるために `${{ github.sha }}` の先頭 7 文字を使う。YAML 内での文字列スライスは直接できないため、`run:` ブロック内で `${GITHUB_SHA:0:7}` を使用する
- `--platform linux/amd64` は Lambda の実行環境（x86_64）に合わせるため必須（GitHub Actions ランナーが ARM の場合も考慮）

**修正後の正確な YAML スニペット**:

```yaml
- name: Build and Push Docker Image (lambda-api)
  if: >-
    inputs.dry_run == false &&
    (inputs.environment == 'all' || inputs.environment == 'lambda-api')
  run: |
    ECR_REGISTRY="${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com"
    ECR_REPOSITORY="smarthome-sensor-api"
    SHORT_SHA="${GITHUB_SHA:0:7}"

    # ECR ログイン
    aws ecr get-login-password --region ap-northeast-1 \
      | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

    # Docker イメージビルド（linux/amd64 を明示指定）
    docker build \
      --platform linux/amd64 \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest" \
      -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:sha-${SHORT_SHA}" \
      lambda/api

    # ECR へプッシュ
    docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:sha-${SHORT_SHA}"

    echo "Pushed images:"
    echo "  ${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    echo "  ${ECR_REGISTRY}/${ECR_REPOSITORY}:sha-${SHORT_SHA}"
```

**完了条件**:
- [ ] `environment: all` または `environment: lambda-api` かつ `dry_run == false` の場合のみ実行される
- [ ] `latest` と `sha-<7文字>` の両タグでプッシュされる
- [ ] `--platform linux/amd64` が指定されている
- [ ] ビルドコンテキストが `lambda/api` ディレクトリになっている

---

### Step 4: `environment: lambda-api` 個別実行時の apply フローを修正

**目的**: `environment: lambda-api` 選択時も ECR 先行作成 → Docker ビルド・プッシュ → Lambda apply の正しい順序を保証する

**既存の "Apply (single)" ステップの課題**:

現在は単一ステップで `terragrunt apply` を実行しているため、ECR リポジトリと Lambda が同時に作成されようとする。Lambda の `image_uri` に存在しないイメージが指定されるため失敗する。

**修正後の構造**:

```yaml
# lambda-api 個別実行時: フェーズ 1（ECR リポジトリ作成）
- name: Apply Phase 1 - Create ECR Repository (lambda-api)
  if: inputs.environment == 'lambda-api' && inputs.dry_run == false
  working-directory: terraform/environments/prod/lambda-api
  run: |
    terragrunt apply \
      -lock-timeout=5m \
      -no-color \
      -auto-approve \
      -target=aws_ecr_repository.this

# フェーズ 2: Docker ビルド・プッシュ（Step 3 のステップで実行）

# lambda-api 個別実行時: フェーズ 3（Lambda 含む全リソース作成）
- name: Apply Phase 3 - Full Lambda Apply (lambda-api)
  if: inputs.environment == 'lambda-api' && inputs.dry_run == false
  working-directory: terraform/environments/prod/lambda-api
  run: |
    terragrunt apply \
      -lock-timeout=5m \
      -no-color \
      -auto-approve

# その他の単一環境（dynamodb, lambda-poller, cloudfront）
- name: Apply (single - non-container)
  if: >-
    inputs.environment != 'all' &&
    inputs.environment != 'lambda-api' &&
    inputs.dry_run == false
  working-directory: terraform/environments/prod/${{ inputs.environment }}
  run: |
    terragrunt apply \
      -lock-timeout=5m \
      -no-color \
      -auto-approve
```

**完了条件**:
- [ ] `lambda-api` 選択時に ECR リポジトリが先に作成される
- [ ] `dynamodb`、`lambda-poller`、`cloudfront` 選択時は従来通りの単一 apply が実行される
- [ ] Docker ビルドが不要な環境でビルドが実行されない

---

### Step 5: Plan ステップの整理

**目的**: Plan ステップは変更不要だが、ステップ順序を整理して可読性を高める

**現状**:
- "Plan (run-all)": `environment: all` 時に全モジュールの plan を実行
- "Plan (single)": `environment: (single)` 時に該当モジュールの plan を実行

Plan ステップは変更なし。ただし、`dry_run: true` 時には Plan のみ実行されることを明確にするため、ステップ名にコメントを追加することを検討する。

**完了条件**:
- [ ] Plan ステップが既存通りに機能している
- [ ] `dry_run: true` 時に Docker ビルド・プッシュがスキップされることを確認

---

### Step 6: Summary ステップの更新

**目的**: Docker ビルド・プッシュの情報を Summary に追加する

**変更後**:

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
      # Docker ビルドが実行された場合のみ表示
      if [[ "${{ inputs.dry_run }}" == "false" ]] && \
         [[ "${{ inputs.environment }}" == "all" || "${{ inputs.environment }}" == "lambda-api" ]]; then
        ECR_REGISTRY="${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com"
        echo "### Docker Image"
        echo "- **Registry**: \`${ECR_REGISTRY}/smarthome-sensor-api\`"
        echo "- **Tags**: \`latest\`, \`sha-${GITHUB_SHA:0:7}\`"
      fi
    } >> $GITHUB_STEP_SUMMARY
```

**完了条件**:
- [ ] Summary に commit hash が表示される
- [ ] Docker ビルドが実行された場合のみ ECR 情報が表示される

---

### Step 7: lambda-poller コンテナ化への拡張コメントを追加

**目的**: 将来の `lambda-poller` コンテナ化に備えたコメントを残す

Docker ビルド・プッシュのステップ内に以下のコメントを追加する：

```yaml
# TODO: lambda-poller をコンテナ化する場合は、以下のパターンで追加する
#   1. terraform/environments/prod/lambda-poller/terragrunt.hcl の source を
#      lambda-zip モジュールから lambda-container モジュールに変更
#   2. 下記と同様のビルド・プッシュステップを追加（ECR_REPOSITORY を変更）
#   3. Apply Phase 1 の -target に aws_ecr_repository.this を追加
#
# 参考: リサーチドキュメント docs/exec-plans/active/docker-build-research.md
#       「8. 既知の制限と今後の拡張」
```

**完了条件**:
- [ ] Docker ビルドステップのそばに拡張コメントが追加されている

---

## 完成後のワークフロー全体構造

実装後の `.github/workflows/terraform-apply.yml` のステップ順序は以下のようになる：

```
1.  Checkout code
2.  Configure AWS credentials (OIDC)
3.  Verify AWS credentials
4.  Setup Terraform
5.  Setup Terragrunt
6.  Plan (run-all)                          ← environment == all
7.  Plan (single)                           ← environment != all
8.  Apply Phase 1 - Create ECR (run-all)   ← environment == all && !dry_run
9.  Apply Phase 1 - Create ECR (lambda-api) ← environment == lambda-api && !dry_run
10. Build and Push Docker Image             ← (all || lambda-api) && !dry_run
11. Apply Phase 3 - Full Apply (run-all)   ← environment == all && !dry_run
12. Apply Phase 3 - Full Apply (lambda-api) ← environment == lambda-api && !dry_run
13. Apply (single - non-container)          ← その他 && !dry_run
14. Write summary
```

---

## Test Strategy

### 手動テスト（GitHub Actions での実行）

ワークフローは GitHub Actions 上でのみテスト可能。以下のシナリオを手動で確認する：

#### シナリオ 1: `environment: all`, `dry_run: false`
- [ ] Phase 1 で ECR リポジトリが作成される（Lambda は作成されない）
- [ ] Docker イメージがビルドされ、`latest` と `sha-XXXXXXX` タグで ECR にプッシュされる
- [ ] Phase 3 で全環境（dynamodb, lambda-api, lambda-poller, cloudfront）が apply される
- [ ] Lambda API が正常に起動し、Function URL でレスポンスが返る

#### シナリオ 2: `environment: lambda-api`, `dry_run: false`
- [ ] Phase 1 で ECR リポジトリが作成される
- [ ] Docker イメージがビルド・プッシュされる
- [ ] Phase 3 で Lambda 含む lambda-api モジュール全体が apply される

#### シナリオ 3: `environment: all`, `dry_run: true`
- [ ] Plan のみ実行される
- [ ] Docker ビルド・プッシュが実行されない
- [ ] apply 系のステップが全てスキップされる

#### シナリオ 4: `environment: dynamodb`, `dry_run: false`
- [ ] Plan → Apply の従来通りの動作
- [ ] Docker ビルドが実行されない

#### シナリオ 5: 2 回目のデプロイ（イメージ既存）
- [ ] `latest` タグで上書きプッシュが成功する（MUTABLE のため）
- [ ] エラーなく完了する

### ローカル検証（YAML 構文チェック）

```bash
# YAML 構文チェック
python -c "import yaml; yaml.safe_load(open('.github/workflows/terraform-apply.yml'))"

# または actionlint がある場合
actionlint .github/workflows/terraform-apply.yml
```

---

## Known Risks and Constraints

### 技術的リスク

- **リスク**: Terragrunt 0.96.1 で `-target` が `run-all` 以外（単一モジュール）でサポートされているか
  - **Impact**: High
  - **軽減策**: Terragrunt の CHANGELOG で確認済み。単一モジュール配下での `terragrunt apply -- -target=...` は Terraform の `-target` をそのまま渡すため、サポートされている。`--` 区切りで Terraform フラグを渡す構文は `run-all` でも単一実行でも共通。ただし Terragrunt 0.96.1 の構文が `terragrunt apply -target=...`（`--` なし）か `terragrunt apply -- -target=...`（`--` あり）かを確認する必要がある。

- **リスク**: `-target` で ECR だけ作成すると Terraform ステートが "tainted" になる可能性
  - **Impact**: Medium
  - **軽減策**: `-target` は Terraform の標準機能であり、ステートを taint することはない。ただし「部分 apply」として記録されるため、後続の `run-all` で残りリソースが正常に作成されることを確認する必要がある

- **リスク**: `docker build --platform linux/amd64` が GitHub Actions の ubuntu-latest ランナーで失敗する
  - **Impact**: Low
  - **軽減策**: ubuntu-latest は x86_64 ランナーのため `--platform linux/amd64` は常に成功する。将来 ARM ランナーに変更する場合は QEMU セットアップが必要

- **リスク**: ECR ログイン失敗（OIDC トークンの ECR push 権限不足）
  - **Impact**: High
  - **軽減策**: `AWS_ROLE_ARN` に紐付く IAM ロールに `ecr:GetAuthorizationToken`、`ecr:BatchCheckLayerAvailability`、`ecr:InitiateLayerUpload`、`ecr:UploadLayerPart`、`ecr:CompleteLayerUpload`、`ecr:PutImage` が付与されている必要がある。これは既存のインフラ設定（IAM ロール）側の問題であり、ワークフローの変更とは別

### 制約

- **スコープ外**: `lambda-poller` のコンテナ化は今回対象外。コメントで将来拡張の道を残す
- **ECR URL**: `smarthome-sensor-api` という名前は `terraform/environments/prod/lambda-api/terragrunt.hcl` で定義されており、ワークフロー内でハードコードする。将来変更時は両方を同期して更新する必要がある
- **リージョン固定**: `ap-northeast-1` を前提。マルチリージョン展開時は変更が必要

---

## Alternative Approaches Considered

### アプローチ A: `run-all` 実行前に独立した ECR モジュールを作成する

- **Pros**: モジュール構造が明確、依存関係がコードレベルで表現される
- **Cons**: 新規モジュール追加が必要、Terraform ステートが増える、今回のスコープを超える変更
- **Decision**: 採用しない。既存の `lambda-container` モジュールに ECR が含まれている設計を変更するリスクが大きい

### アプローチ B: `terragrunt run-all` の前に DynamoDB のみ apply し、その後 ECR を含む lambda-api を -target なしで apply する

- **Pros**: シンプルな apply 分割
- **Cons**: Lambda も一緒に apply されてしまうため、イメージが存在しない状態で Lambda 作成が失敗する
- **Decision**: 採用しない。`-target` で ECR のみ作成するアプローチの方が確実

### アプローチ C: `docker/build-push-action@v5` を使用する（選択しない）

- **Pros**: キャッシュ機能、マルチプラットフォーム対応、YAML がシンプル
- **Cons**: `aws-actions/amazon-ecr-login@v2` などの追加アクションも必要。AWS CLI の直接呼び出しの方が既存パターンと一致し、依存する外部アクション数を減らせる
- **Decision**: 採用しない。AWS CLI を直接使う方が既存ワークフローの `aws-actions/configure-aws-credentials@v4` との組み合わせで実績があり、シンプル

### アプローチ D: ECR URL を `terragrunt output` で動的取得する

- **Pros**: 設定の一元管理（terragrunt.hcl のみ）
- **Cons**: output 取得のために追加ステップが必要、失敗リスクがある
- **Decision**: 採用しない。ECR URL は `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPOSITORY_NAME>` という決定論的なパターンであるため、secrets と固定値から組み立てる方が堅牢

### アプローチ E: apply を `dynamodb` と `lambda-api` に分けて実行する（`run-all` を廃止）

- **Pros**: 各モジュールの実行制御が明確
- **Cons**: `environment: all` の意味が変わる。将来 `cloudfront` など依存モジュールが増えた場合の保守コストが高い
- **Decision**: 採用しない。`run-all` は依存関係グラフを自動解決するため、新モジュール追加時も自動で対応できる

---

## Post-Implementation Tasks

- [ ] GitHub Actions でシナリオ 1〜5 の手動テストを実行
- [ ] IAM ロールに ECR push 権限（`ecr:InitiateLayerUpload` 等）が付与されているか確認（インフラ側の確認）
- [ ] 実装完了後、計画書を `docs/exec-plans/completed/` に移動
- [ ] 振り返りドキュメント作成
- [ ] ARCHITECTURE.md への更新は不要（ワークフロー変更のみのため）

---

## 付録: 最終的なワークフロー YAML 全体イメージ

実装後の `.github/workflows/terraform-apply.yml` の完全な構造を示す：

```yaml
name: Terraform Apply

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'デプロイ対象の環境'
        required: true
        type: choice
        options:
          - all
          - dynamodb
          - lambda-api
          - lambda-poller
          - cloudfront
        default: all
      dry_run:
        description: 'Dry run (plan のみ、apply しない)'
        required: false
        type: boolean
        default: false

permissions:
  contents: read
  id-token: write

jobs:
  terraform-apply:
    name: Terraform Apply (${{ inputs.environment }})
    runs-on: ubuntu-latest
    env:
      AWS_ACCOUNT_ID: ${{ secrets.AWS_ACCOUNT_ID }}
      SWITCHBOT_DEVICE_ID: ${{ secrets.SWITCHBOT_DEVICE_ID }}
      TERRAGRUNT_NON_INTERACTIVE: "true"
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          role-session-name: github-actions-terraform-apply
          aws-region: ap-northeast-1

      - name: Verify AWS credentials
        run: aws sts get-caller-identity

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.14.8
          terraform_wrapper: false

      - name: Setup Terragrunt
        run: |
          TERRAGRUNT_VERSION=0.96.1
          wget -q https://github.com/gruntwork-io/terragrunt/releases/download/v${TERRAGRUNT_VERSION}/terragrunt_linux_amd64
          chmod +x terragrunt_linux_amd64
          sudo mv terragrunt_linux_amd64 /usr/local/bin/terragrunt
          terragrunt --version

      # ===== Plan ステップ（dry_run / apply 両方で実行）=====

      - name: Plan (run-all)
        if: inputs.environment == 'all'
        working-directory: terraform/environments/prod
        run: |
          terragrunt run --all -- plan \
            -lock-timeout=5m \
            -no-color

      - name: Plan (single)
        if: inputs.environment != 'all'
        working-directory: terraform/environments/prod/${{ inputs.environment }}
        run: |
          terragrunt plan \
            -lock-timeout=5m \
            -no-color

      # ===== Apply フェーズ 1: ECR リポジトリ先行作成 =====
      # Lambda コンテナイメージが存在しない状態で Lambda を apply しようとすると
      # 失敗するため、ECR リポジトリを先に作成し、その後 Docker イメージをプッシュしてから
      # Lambda を含む全リソースを apply する

      - name: Apply Phase 1 - Create ECR Repository (run-all)
        if: inputs.environment == 'all' && inputs.dry_run == false
        working-directory: terraform/environments/prod/lambda-api
        run: |
          # -target で ECR リポジトリのみを先行作成
          # Lambda 本体は Phase 3 の run-all で作成される
          terragrunt apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve \
            -target=aws_ecr_repository.this

      - name: Apply Phase 1 - Create ECR Repository (lambda-api)
        if: inputs.environment == 'lambda-api' && inputs.dry_run == false
        working-directory: terraform/environments/prod/lambda-api
        run: |
          terragrunt apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve \
            -target=aws_ecr_repository.this

      # ===== Apply フェーズ 2: Docker ビルド・ECR プッシュ =====
      # environment が 'all' または 'lambda-api' の場合のみ実行
      # TODO: lambda-poller をコンテナ化する場合は以下を参考に追加ステップを実装すること
      #   1. terraform/environments/prod/lambda-poller/terragrunt.hcl を
      #      lambda-container モジュールに変更
      #   2. 同様のビルド・プッシュステップを追加（ECR_REPOSITORY を変更）
      #   3. Apply Phase 1 の -target に aws_ecr_repository.this を追加
      #   参考: docs/exec-plans/active/docker-build-research.md「8. 既知の制限と今後の拡張」

      - name: Build and Push Docker Image (lambda-api)
        if: >-
          inputs.dry_run == false &&
          (inputs.environment == 'all' || inputs.environment == 'lambda-api')
        run: |
          ECR_REGISTRY="${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com"
          ECR_REPOSITORY="smarthome-sensor-api"
          SHORT_SHA="${GITHUB_SHA:0:7}"

          # ECR ログイン
          aws ecr get-login-password --region ap-northeast-1 \
            | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

          # Docker イメージビルド（linux/amd64 を明示指定: Lambda の実行環境は x86_64）
          docker build \
            --platform linux/amd64 \
            -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest" \
            -t "${ECR_REGISTRY}/${ECR_REPOSITORY}:sha-${SHORT_SHA}" \
            lambda/api

          # ECR へプッシュ（latest: 常に最新イメージを示す）
          docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"

          # ECR へプッシュ（sha-XXXXXXX: git コミットと紐付いたイメージ追跡用）
          docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:sha-${SHORT_SHA}"

          echo "Pushed images:"
          echo "  ${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
          echo "  ${ECR_REGISTRY}/${ECR_REPOSITORY}:sha-${SHORT_SHA}"

      # ===== Apply フェーズ 3: 全リソース apply =====

      - name: Apply Phase 3 - Full Apply (run-all)
        if: inputs.environment == 'all' && inputs.dry_run == false
        working-directory: terraform/environments/prod
        run: |
          terragrunt run --all -- apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve

      - name: Apply Phase 3 - Full Lambda Apply (lambda-api)
        if: inputs.environment == 'lambda-api' && inputs.dry_run == false
        working-directory: terraform/environments/prod/lambda-api
        run: |
          terragrunt apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve

      - name: Apply (single - non-container)
        if: >-
          inputs.environment != 'all' &&
          inputs.environment != 'lambda-api' &&
          inputs.dry_run == false
        working-directory: terraform/environments/prod/${{ inputs.environment }}
        run: |
          terragrunt apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve

      # ===== Summary =====

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
            if [[ "${{ inputs.dry_run }}" == "false" ]] && \
               [[ "${{ inputs.environment }}" == "all" || \
                  "${{ inputs.environment }}" == "lambda-api" ]]; then
              ECR_REGISTRY="${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.ap-northeast-1.amazonaws.com"
              echo "### Docker Image"
              echo "- **Registry**: \`${ECR_REGISTRY}/smarthome-sensor-api\`"
              echo "- **Tags**: \`latest\`, \`sha-${GITHUB_SHA:0:7}\`"
            fi
          } >> $GITHUB_STEP_SUMMARY
```

---

*このドキュメントはレビュー待ちです。インラインアノテーション（FEEDBACK / QUESTION / APPROVED / NOTE）を追加してください。*
