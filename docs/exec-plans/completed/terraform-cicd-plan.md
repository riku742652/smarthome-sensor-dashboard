# Terraform/Terragrunt CI/CD Implementation Plan

**日付**: 2026-03-28
**ステータス**: Plan - Awaiting Approval
**前提**: [terraform-cicd-research.md](./terraform-cicd-research.md) のリサーチ完了

## 目標

Terraform/TerragruntのフォーマットチェックとCI/CD自動テストを構築し、インフラコードの品質を保証する。

### 成功基準

- ✅ PR時にTerraformフォーマットチェックが自動実行される
- ✅ PR時にTerragrunt HCLフォーマットチェックが自動実行される
- ✅ PR時にTerraform構文検証が自動実行される
- ✅ フォーマットエラーまたは構文エラーでCIが失敗する
- ✅ すべてのワークフローが10分以内に完了する

## 前提条件

### ツール（ローカル）

- [x] Terraform >= 1.14.3
- [x] Terragrunt >= 0.96.1
- [x] Git

### リポジトリ

- [x] GitHub Actionsが有効
- [x] mainブランチ保護ルール設定（推奨）

## 実装範囲

### Phase 1: フォーマット・検証（本計画）

**含まれるもの**:
- Terraformフォーマットチェック
- Terragrunt HCLフォーマットチェック
- Terraform構文検証（validate）
- GitHub Actionsワークフロー

**含まれないもの**:
- terraform plan実行（AWS認証必要、Phase 2）
- セキュリティスキャン（Phase 2）
- コスト見積もり（Phase 2）

## 実装ステップ

### ステップ1: ディレクトリ構造作成

#### ステップ1.1: GitHub Actionsディレクトリ作成

```bash
mkdir -p .github/workflows
```

**完了条件**: `.github/workflows/`ディレクトリが作成される

### ステップ2: Terraformフォーマット・検証ワークフロー作成

#### ステップ2.1: terraform-ci.ymlワークフロー作成

`.github/workflows/terraform-ci.yml`:

```yaml
name: Terraform CI

on:
  pull_request:
    paths:
      - 'terraform/**/*.tf'
      - 'terraform/**/*.hcl'
      - 'lambda/**/*.py'
      - 'lambda/**/requirements.txt'
      - 'lambda/**/Dockerfile'
      - '.github/workflows/terraform-ci.yml'
  push:
    branches:
      - main
    paths:
      - 'terraform/**/*.tf'
      - 'terraform/**/*.hcl'

permissions:
  contents: read
  pull-requests: write  # For commenting on PRs (future)

jobs:
  terraform-format:
    name: Terraform Format Check
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.14.8

      - name: Terraform Format Check
        id: fmt
        run: |
          echo "Checking Terraform formatting..."
          if terraform fmt -check -recursive -diff terraform/; then
            echo "✅ All Terraform files are formatted correctly"
            exit 0
          else
            echo "❌ Some Terraform files need formatting"
            echo "Run: terraform fmt -recursive terraform/"
            exit 1
          fi

  terraform-validate:
    name: Terraform Validate
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        module:
          - terraform/modules/dynamodb
          - terraform/modules/lambda
          - terraform/modules/lambda-container
          - terraform/modules/cloudfront
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.14.8

      - name: Terraform Init
        run: terraform init -backend=false
        working-directory: ${{ matrix.module }}

      - name: Terraform Validate
        run: terraform validate
        working-directory: ${{ matrix.module }}

  terragrunt-format:
    name: Terragrunt HCL Format Check
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.14.8

      - name: Setup Terragrunt
        run: |
          TERRAGRUNT_VERSION=0.96.1
          wget -q https://github.com/gruntwork-io/terragrunt/releases/download/v${TERRAGRUNT_VERSION}/terragrunt_linux_amd64
          chmod +x terragrunt_linux_amd64
          sudo mv terragrunt_linux_amd64 /usr/local/bin/terragrunt
          terragrunt --version

      - name: Terragrunt HCL Format Check
        run: |
          echo "Checking Terragrunt HCL formatting..."
          if terragrunt hclfmt --terragrunt-check --terragrunt-working-dir terraform; then
            echo "✅ All Terragrunt HCL files are formatted correctly"
            exit 0
          else
            echo "❌ Some Terragrunt HCL files need formatting"
            echo "Run: terragrunt hclfmt --terragrunt-working-dir terraform"
            exit 1
          fi

  summary:
    name: CI Summary
    runs-on: ubuntu-latest
    needs: [terraform-format, terraform-validate, terragrunt-format]
    if: always()
    steps:
      - name: Check CI Status
        run: |
          if [ "${{ needs.terraform-format.result }}" != "success" ] || \
             [ "${{ needs.terraform-validate.result }}" != "success" ] || \
             [ "${{ needs.terragrunt-format.result }}" != "success" ]; then
            echo "❌ Terraform CI failed"
            echo ""
            echo "terraform-format: ${{ needs.terraform-format.result }}"
            echo "terraform-validate: ${{ needs.terraform-validate.result }}"
            echo "terragrunt-format: ${{ needs.terragrunt-format.result }}"
            exit 1
          else
            echo "✅ All Terraform CI checks passed!"
            exit 0
          fi
```

**ポイント**:
- **fail-fast: false**: すべてのモジュールを検証（1つ失敗しても続行）
- **matrix**: 各モジュールを並列検証
- **backend=false**: S3バックエンド初期化をスキップ（AWS認証不要）
- **summary job**: 全体の成功/失敗を集約

**完了条件**: `.github/workflows/terraform-ci.yml`が作成される

### ステップ3: .gitignoreの更新

#### ステップ3.1: Terraform関連を.gitignoreに追加

`.gitignore`に以下を追加（既に存在する場合はスキップ）:

```gitignore
# Terraform
**/.terraform/*
*.tfstate
*.tfstate.*
crash.log
crash.*.log
*.tfvars
*.tfvars.json
override.tf
override.tf.json
*_override.tf
*_override.tf.json
.terraformrc
terraform.rc

# Terragrunt
**/.terragrunt-cache/*

# Lambda
lambda/**/__pycache__/
lambda/**/.pytest_cache/
lambda/**/*.pyc
```

**完了条件**: .gitignoreが更新される

### ステップ4: ローカルテスト

#### ステップ4.1: フォーマットチェック実行

```bash
# Terraform
terraform fmt -check -recursive -diff terraform/

# Terragrunt
terragrunt hclfmt --terragrunt-check --terragrunt-working-dir terraform
```

**期待される結果**: すべてフォーマット済み（出力なし）

**完了条件**: フォーマットチェックがパス

#### ステップ4.2: 検証実行

```bash
# DynamoDB module
cd terraform/modules/dynamodb
terraform init -backend=false
terraform validate

# Lambda module
cd ../lambda
terraform init -backend=false
terraform validate

# Lambda Container module
cd ../lambda-container
terraform init -backend=false
terraform validate

# CloudFront module
cd ../cloudfront
terraform init -backend=false
terraform validate
```

**期待される結果**: すべてのモジュールが検証パス

**完了条件**: すべてのモジュールが検証成功

### ステップ5: GitHub Actionsテスト

#### ステップ5.1: ブランチ作成とコミット

```bash
git checkout -b feature/terraform-ci
git add .github/workflows/terraform-ci.yml
git add .gitignore  # 変更がある場合のみ
git commit -m "ci: Add Terraform/Terragrunt CI workflow"
git push origin feature/terraform-ci
```

**完了条件**: ブランチがpushされる

#### ステップ5.2: Pull Request作成

GitHub UIまたはghコマンドでPR作成:

```bash
gh pr create \
  --title "ci: Add Terraform/Terragrunt CI workflow" \
  --body "## Summary

Add GitHub Actions workflow for Terraform/Terragrunt CI.

## Changes

- ✅ Terraform format check
- ✅ Terragrunt HCL format check
- ✅ Terraform validate for all modules
- ✅ .gitignore updates

## Test Plan

- [ ] CI runs successfully on PR
- [ ] Format check detects unformatted files
- [ ] Validate check detects syntax errors
- [ ] All jobs complete in < 10 minutes

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>" \
  --base main
```

**完了条件**: PRが作成され、GitHub Actionsが実行される

#### ステップ5.3: CI結果確認

GitHub ActionsのワークフローをUI上で確認:

- [ ] `terraform-format` job成功
- [ ] `terraform-validate` job成功（全モジュール）
- [ ] `terragrunt-format` job成功
- [ ] `summary` job成功

**完了条件**: すべてのジョブが成功

### ステップ6: エラーケーステスト

#### ステップ6.1: 意図的にフォーマットエラーを作成

テスト用に一時的にフォーマットを崩す:

```bash
# テスト用ブランチ
git checkout -b test/format-error

# フォーマットを崩す（例）
echo 'resource "aws_s3_bucket" "test" { bucket="test" }' >> terraform/modules/dynamodb/main.tf

git add terraform/modules/dynamodb/main.tf
git commit -m "test: Intentional format error"
git push origin test/format-error
```

PRを作成し、CIが**失敗**することを確認。

**完了条件**: フォーマットエラーでCI失敗を確認

#### ステップ6.2: テストブランチ削除

```bash
git checkout main
git branch -D test/format-error
git push origin --delete test/format-error
```

**完了条件**: テストブランチが削除される

### ステップ7: ドキュメント更新

#### ステップ7.1: terraform/README.md更新

`terraform/README.md`の「CI/CD」セクションを追加:

```markdown
## CI/CD

### GitHub Actions

All Terraform and Terragrunt code is automatically checked on pull requests:

- **Format Check**: `terraform fmt -check -recursive`
- **HCL Format Check**: `terragrunt hclfmt --terragrunt-check`
- **Validate**: `terraform validate` for all modules

### Local Development

Before committing, run:

```bash
# Format all Terraform files
terraform fmt -recursive terraform/

# Format all Terragrunt HCL files
terragrunt hclfmt --terragrunt-working-dir terraform

# Validate all modules
for module in terraform/modules/*; do
  cd "$module"
  terraform init -backend=false
  terraform validate
  cd -
done
```

### CI Workflow

`.github/workflows/terraform-ci.yml` runs on:
- Pull requests that modify `terraform/**` or `lambda/**`
- Pushes to `main` branch

Jobs:
1. **terraform-format**: Check Terraform formatting
2. **terraform-validate**: Validate all modules
3. **terragrunt-format**: Check Terragrunt HCL formatting
4. **summary**: Aggregate results
```

**完了条件**: READMEが更新される

## タイムライン

| ステップ | タスク | 推定時間 |
|---------|--------|----------|
| 1 | ディレクトリ構造作成 | 5分 |
| 2 | ワークフロー作成 | 30分 |
| 3 | .gitignore更新 | 5分 |
| 4 | ローカルテスト | 15分 |
| 5 | GitHub Actionsテスト | 20分 |
| 6 | エラーケーステスト | 15分 |
| 7 | ドキュメント更新 | 10分 |

**合計**: 約1.5時間

## リスクと緩和策

### リスク1: Terragruntインストールの失敗

**影響**: 高
**確率**: 低

**緩和策**:
- バージョンを固定（v0.96.1）
- ダウンロードURLを明示
- エラーハンドリング追加

### リスク2: terraform init -backend=false が期待通りに動作しない

**影響**: 中
**確率**: 低

**緩和策**:
- ローカルで事前テスト
- バックエンド設定なしのモジュールなので問題なし

### リスク3: CI実行時間が長い

**影響**: 低
**確率**: 中

**緩和策**:
- matrixで並列実行
- Terraformキャッシュ活用（setup-terraformが対応）
- 目標: < 10分

## 成功基準の検証

### 自動検証（CI/CD）

- [ ] PR作成時にワークフローが自動実行される
- [ ] フォーマットエラーでCI失敗
- [ ] 構文エラーでCI失敗
- [ ] 正常なコードでCI成功
- [ ] 実行時間 < 10分

### 手動検証

- [ ] ローカルでフォーマットチェック成功
- [ ] ローカルで検証成功
- [ ] PRのCI結果が見やすい
- [ ] エラーメッセージが分かりやすい

## 未解決の質問

### 質問1: Branch protection rulesを設定するか？

**現状**: 未設定

**オプション**:
1. 設定する: CI成功を必須にする
2. 設定しない: 柔軟性を保つ

**推奨**: **設定する**（Phase 1完了後）

```yaml
# .github/branch-protection.yml (reference)
main:
  required_status_checks:
    - Terraform Format Check
    - Terraform Validate
    - Terragrunt HCL Format Check
```

### 質問2: pre-commit hookを追加するか？

**現状**: 未設定

**オプション**:
1. 追加: ローカルで自動フォーマット
2. 追加しない: 開発者に任せる

**推奨**: **Phase 2で検討**

## 次のステップ（Phase 2以降）

### Phase 2: Plan & Security

- [ ] AWS OIDC認証設定
- [ ] terraform plan実行
- [ ] Plan結果のPRコメント表示
- [ ] Trivyセキュリティスキャン

### Phase 3: Cost & Docs

- [ ] Infracost統合
- [ ] terraform-docs自動生成
- [ ] Dependency graph可視化

## 参照

- [リサーチドキュメント](./terraform-cicd-research.md)
- [Terraform CI/CD Best Practices](https://developer.hashicorp.com/terraform/tutorials/automation/automate-terraform)
- [GitHub Actions - Terraform](https://github.com/hashicorp/setup-terraform)

---

**前**: [terraform-cicd-research.md](./terraform-cicd-research.md)
**次**: 実装開始（承認後）
