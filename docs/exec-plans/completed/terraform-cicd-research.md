# Terraform/Terragrunt CI/CD - Research

**日付**: 2026-03-28
**ステータス**: Research Complete
**目的**: Terraform/TerragruntのフォーマットチェックとCI/CD自動テストの構築に必要な情報を収集

## 現状分析

### インフラコード

#### ファイル構成

```
terraform/
├── terragrunt.hcl                    # Root configuration
├── modules/                          # Terraform modules
│   ├── dynamodb/                    # 3 files (.tf)
│   ├── lambda/                      # 3 files (.tf)
│   ├── lambda-container/            # 3 files (.tf)
│   └── cloudfront/                  # 3 files (.tf)
└── environments/
    └── prod/                        # Production environment
        ├── dynamodb/                # terragrunt.hcl
        ├── lambda-poller/           # terragrunt.hcl
        ├── lambda-api/              # terragrunt.hcl
        └── cloudfront/              # terragrunt.hcl
```

**統計**:
- Terraformファイル (.tf): 12ファイル
- Terragruntファイル (.hcl): 5ファイル

#### ツールバージョン

- **Terraform**: v1.14.3 (ローカル)
  - 要件: >= 1.5
  - 最新: v1.14.8
- **Terragrunt**: v0.96.1 (ローカル)
  - 要件: >= 0.50

#### 現在のフォーマット状態

```bash
$ terraform fmt -check -diff
# 出力なし → すべてフォーマット済み
```

すべてのTerraformファイルは既にフォーマット済み。

### CI/CD状況

#### ✅ 既存

- なし（.githubディレクトリなし）

#### ❌ 不足

1. **GitHub Actions ワークフロー**
2. **Terraformフォーマットチェック**
3. **Terraform検証（validate）**
4. **Terragrunt検証**
5. **セキュリティスキャン（tfsec, checkov等）**
6. **コスト見積もり（Infracost等）**

## 要件定義

### 必須要件

1. **フォーマットチェック**
   - `terraform fmt -check` ですべての.tfファイルを検証
   - `terragrunt hclfmt --terragrunt-check` ですべての.hclファイルを検証
   - PR時に自動実行
   - フォーマットエラーがあればCI失敗

2. **構文検証**
   - `terraform validate` で構文をチェック
   - すべてのモジュールとenvironmentsをチェック
   - PR時に自動実行

3. **Terragrunt検証**
   - `terragrunt validate-all` で全環境の設定を検証
   - 依存関係の検証
   - PR時に自動実行

4. **Planプレビュー（将来）**
   - `terraform plan` の結果をPRコメントに表示
   - 変更内容の可視化
   - **Phase 2で実装**（AWS認証情報が必要）

### オプション要件

1. **セキュリティスキャン**
   - tfsec または Trivy でセキュリティ脆弱性をチェック
   - PR時に自動実行
   - **Phase 2で実装**

2. **コスト見積もり**
   - Infracost でコスト変動を表示
   - PRコメントに表示
   - **Phase 2で実装**（Infracost APIキーが必要）

3. **ドキュメント自動生成**
   - terraform-docs でREADME更新
   - **Phase 3で実装**

## CI/CDパイプライン設計

### ワークフロー構成

#### 1. Terraform Format & Validate (必須)

**トリガー**:
- Pull Requestの作成・更新
- mainブランチへのpush
- terraformディレクトリの変更のみ

**ジョブ**:

1. **Format Check**
   - すべての.tfファイルでterraform fmtチェック
   - すべての.hclファイルでterragrunt hclfmtチェック

2. **Validate**
   - 各モジュールでterraform init + validate
   - 各environmentでterragrunt validate-inputs

3. **Security Scan (Phase 2)**
   - tfsec または Trivy でスキャン
   - 重大な問題があれば失敗

**成功条件**:
- すべてのファイルがフォーマット済み
- すべての構文検証がパス
- セキュリティスキャンがパス（Phase 2）

#### 2. Terraform Plan (Phase 2)

**トリガー**:
- Pull Requestの作成・更新（terraformディレクトリの変更）

**ジョブ**:

1. **Plan**
   - AWS認証情報を使用
   - 各environmentでterragrunt plan実行
   - Plan結果をPRコメントに投稿

**必要な設定**:
- AWS認証情報（GitHub Secrets）
- Terraform State S3バケットへのアクセス
- DynamoDB State Lockテーブルへのアクセス

**成功条件**:
- Planが成功（エラーなし）

### ディレクトリ構造

```
.github/
└── workflows/
    ├── terraform-format.yml      # フォーマット・検証
    └── terraform-plan.yml        # Plan（Phase 2）
```

## ツール選定

### 1. Terraform Format & Validate

**terraform fmt**
- 標準ツール
- フォーマットチェック: `terraform fmt -check -recursive`
- 差分表示: `terraform fmt -diff -check -recursive`

**terragrunt hclfmt**
- Terragrunt標準ツール
- フォーマットチェック: `terragrunt hclfmt --terragrunt-check`

**terraform validate**
- 構文検証
- モジュールごとに実行が必要
- terraform init後に実行

### 2. セキュリティスキャン（Phase 2）

**候補1: tfsec**
- Pros: 軽量、高速、無料
- Cons: ルールセットが限定的

**候補2: Trivy**
- Pros: 包括的、IaCスキャン対応、無料
- Cons: やや重い

**候補3: Checkov**
- Pros: 多数のルール、詳細なレポート
- Cons: 遅い

**推奨**: **Trivy**（包括的で、コンテナスキャンでも使用可能）

### 3. Plan可視化（Phase 2）

**terraform-plan-action**
- GitHub Action: `dflook/terraform-plan`
- PRコメントにPlan結果を表示
- 差分をマークダウンで表示

### 4. コスト見積もり（Phase 2）

**Infracost**
- コスト変動を計算
- PRコメントに表示
- 無料プラン: 個人プロジェクト向け
- API key必要

## 実装戦略

### Phase 1: フォーマット・検証（必須）

**目標**: 品質ゲートの確立

**実装内容**:
1. terraform fmt チェック
2. terragrunt hclfmt チェック
3. terraform validate
4. terragrunt validate-inputs

**成功基準**:
- PRでフォーマットチェック自動実行
- フォーマットエラーでCI失敗
- 構文エラーでCI失敗

### Phase 2: Plan & Security（オプション）

**目標**: セキュリティと変更内容の可視化

**実装内容**:
1. AWS認証情報の設定
2. terraform plan 実行
3. Plan結果のPRコメント表示
4. Trivyセキュリティスキャン

**必要な準備**:
- AWS IAMユーザー（ReadOnly権限）
- GitHub Secrets設定

### Phase 3: Cost & Docs（将来）

**目標**: コスト管理とドキュメント自動化

**実装内容**:
1. Infracost統合
2. terraform-docs自動生成

## ファイルパスパターン

### チェック対象

```yaml
paths:
  - 'terraform/**/*.tf'
  - 'terraform/**/*.hcl'
  - 'lambda/**/*.py'           # Lambda関数コード
  - 'lambda/**/requirements.txt'
  - 'lambda/**/Dockerfile'
```

### 除外パターン

```yaml
paths-ignore:
  - 'terraform/**/.terraform/**'
  - 'terraform/**/.terragrunt-cache/**'
  - 'terraform/**/*.tfstate'
  - 'terraform/**/*.tfstate.backup'
```

## GitHub Actionsワークフロー例

### terraform-format.yml（Phase 1）

```yaml
name: Terraform Format & Validate

on:
  pull_request:
    paths:
      - 'terraform/**/*.tf'
      - 'terraform/**/*.hcl'
  push:
    branches:
      - main
    paths:
      - 'terraform/**/*.tf'
      - 'terraform/**/*.hcl'

jobs:
  format:
    name: Terraform Format Check
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.14.8

      - name: Terraform Format Check
        run: terraform fmt -check -recursive -diff
        working-directory: terraform

  validate:
    name: Terraform Validate
    runs-on: ubuntu-latest
    strategy:
      matrix:
        module:
          - terraform/modules/dynamodb
          - terraform/modules/lambda
          - terraform/modules/lambda-container
          - terraform/modules/cloudfront
    steps:
      - name: Checkout
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
    name: Terragrunt Format Check
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Terragrunt
        run: |
          wget https://github.com/gruntwork-io/terragrunt/releases/download/v0.96.1/terragrunt_linux_amd64
          chmod +x terragrunt_linux_amd64
          sudo mv terragrunt_linux_amd64 /usr/local/bin/terragrunt

      - name: Terragrunt Format Check
        run: terragrunt hclfmt --terragrunt-check --terragrunt-working-dir terraform
```

## テスト戦略

### ローカルテスト

**1. フォーマットチェック**

```bash
# Terraform
terraform fmt -check -recursive -diff terraform/

# Terragrunt
terragrunt hclfmt --terragrunt-check --terragrunt-working-dir terraform
```

**2. 検証**

```bash
# 各モジュール
for module in terraform/modules/*; do
  cd "$module"
  terraform init -backend=false
  terraform validate
  cd -
done

# Terragrunt
cd terraform/environments/prod/dynamodb
terragrunt validate-inputs
```

### CI/CDテスト

**1. PRでテスト**
- フォーマットチェック自動実行
- 検証自動実行

**2. マージ後**
- mainブランチで再度実行

## リスクと緩和策

### リスク1: Terraform初期化の遅延

**影響**: 中
**確率**: 中

**緩和策**:
- terraform init -backend=false（バックエンド初期化スキップ）
- matrixで並列実行

### リスク2: Terragrunt検証の複雑さ

**影響**: 低
**確率**: 中

**緩和策**:
- validate-inputsのみ実行（planは不要）
- エラーハンドリング追加

### リスク3: AWS認証情報の管理（Phase 2）

**影響**: 高
**確率**: 低

**緩和策**:
- GitHub SecretsでIAM credentialsを管理
- ReadOnly権限のみ使用
- OIDC認証（推奨）

## ベストプラクティス

### 1. Terraform

- `terraform fmt -check` をPR前に実行
- `terraform validate` でローカル検証
- `.terraform/`を.gitignoreに追加

### 2. Terragrunt

- `terragrunt hclfmt` で自動フォーマット
- `terragrunt validate-all` で全環境検証
- `.terragrunt-cache/`を.gitignoreに追加

### 3. GitHub Actions

- Terraform/Terragruntバージョンを固定
- キャッシュを活用（setup-terraform）
- matrixで並列実行

## 参照資料

### 公式ドキュメント

- [Terraform CLI - Format](https://developer.hashicorp.com/terraform/cli/commands/fmt)
- [Terraform CLI - Validate](https://developer.hashicorp.com/terraform/cli/commands/validate)
- [Terragrunt - hclfmt](https://terragrunt.gruntwork.io/docs/reference/cli-options/#hclfmt)
- [HashiCorp Setup Terraform](https://github.com/hashicorp/setup-terraform)

### ツール

- [tfsec](https://github.com/aquasecurity/tfsec)
- [Trivy](https://github.com/aquasecurity/trivy)
- [Infracost](https://www.infracost.io/)
- [terraform-docs](https://terraform-docs.io/)

### GitHub Actions Examples

- [Terraform Validate Action](https://github.com/hashicorp/setup-terraform)
- [Terragrunt Examples](https://github.com/gruntwork-io/terragrunt-action)

## 次のステップ

1. このリサーチをレビュー
2. 実行計画（`terraform-cicd-plan.md`）を作成
3. 計画承認後、Phase 1実装開始

---

**調査者**: Claude Code
**完了日**: 2026-03-28
