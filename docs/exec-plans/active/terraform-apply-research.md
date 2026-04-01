# Terragrunt 0.96.1 の run-all コマンド調査

## タスク理解

GitHub Actions ワークフローで `terragrunt run-all plan` と `terragrunt run-all apply` を正しく実行するための、0.96.1 版で正しく動作するフラグと使い方を調査する。

**要件**:
- 非インタラクティブモードの正しい指定方法を確認
- `run-all` コマンドのワーキングディレクトリ指定方法を確認
- `-auto-approve` フラグの扱いを確認
- GitHub Actions でのベストプラクティスを確認

## 現在の状態分析

### 既存実装

現在のプロジェクトでは以下のようにワークフローが実装されている：

#### terraform-apply.yml（本体のワークフロー）
```yaml
# Line 34: 環境変数で非インタラクティブモードを指定
env:
  TERRAGRUNT_NON_INTERACTIVE: "true"

# Line 65-69: run-all plan の実行例
working-directory: terraform/environments/prod
run: |
  terragrunt run-all plan \
    -lock-timeout=5m \
    -no-color

# Line 83-86: run-all apply の実行例
working-directory: terraform/environments/prod
run: |
  terragrunt run-all apply \
    -lock-timeout=5m \
    -no-color \
    -auto-approve
```

#### terraform-ci.yml（CI チェック）
```yaml
# Line 101: hcl fmt コマンドの使用例
terragrunt hcl fmt --check --working-dir terraform

# Line 157-166: 単一環境での plan の実行例
terragrunt plan \
  -lock-timeout=5m \
  -no-color \
  -out=/tmp/tfplan/dynamodb.tfplan
```

### Terragrunt プロジェクト構造

```
terraform/
├── terragrunt.hcl                    # ルートコンフィグ
├── environments/
│   └── prod/
│       ├── terragrunt.hcl (or implicit)
│       ├── dynamodb/
│       │   └── terragrunt.hcl
│       ├── cloudfront/
│       │   └── terragrunt.hcl
│       ├── lambda-api/
│       │   └── terragrunt.hcl
│       └── lambda-poller/
│           └── terragrunt.hcl
└── modules/
    ├── dynamodb/
    ├── cloudfront/
    ├── lambda/
    └── lambda-container/
```

### ルート設定の内容

`terraform/terragrunt.hcl` では以下が設定されている：

- **リモートステート**: S3 バックエット使用（動的キーの生成）
- **プロバイダー生成**: AWS プロバイダー設定を自動生成
- **共通入力値**: 環境 (prod)、プロジェクト名、リージョン (ap-northeast-1)

各環境の `terragrunt.hcl` では：
- ルート設定の include（`find_in_parent_folders()`）
- Terraform ソースのパス設定
- 環境固有の入力値

## 技術コンテキスト

### Terragrunt 0.96.1 の特徴

#### リリース内容（v0.96.0 → v0.96.1）
- **フィルターフラグの強化**: Git-based filter expressions でのデフォルトブランチ判定の堅牢化
- **OpenTelemetry トレース**: フィルター評価のパフォーマンス分析
- **バグ修正**:
  - パス基づきフィルタのパース問題（外部パスターゲット）
  - HTTPS Git URL での CAS 実験のサポート問題
  - ルート `terragrunt.hcl` サポートの後退

**重要**: v0.96.1 では CLI フラグに breaking change がない。既存の使用方法は継続可能。

### 正しいフラグ使用法

#### 1. 非インタラクティブモード

**方法**: 環境変数 `TERRAGRUNT_NON_INTERACTIVE=true`

```bash
export TERRAGRUNT_NON_INTERACTIVE=true
terragrunt run-all apply -auto-approve
```

**理由**:
- Terragrunt には `--terragrunt-non-interactive` フラグが存在しない（0.96.1 では定義されていない）
- 環境変数が唯一の標準的な方法
- GitHub Actions では `env` セクションで設定可能

**現在の実装**: ✅ 正しく実装されている

#### 2. run-all コマンド

**構文**:
```bash
terragrunt run-all COMMAND [TERRAFORM_FLAGS]
```

**使用例**:
```bash
# Plan の実行
terragrunt run-all plan -lock-timeout=5m -no-color

# Apply の実行
terragrunt run-all apply -lock-timeout=5m -no-color -auto-approve
```

**フラグの説明**:
- `run-all`: 全てのモジュールに対してコマンドを実行
- `-lock-timeout=5m`: Terraform ロック取得のタイムアウト（5分）
- `-no-color`: カラー出力を無効化（ログ出力をクリーンに）
- `-auto-approve`: Terraform の apply/destroy で確認プロンプトをスキップ

#### 3. Working Directory の指定

**方法**: `working-directory` ステップキーを使用

```yaml
working-directory: terraform/environments/prod
run: terragrunt run-all plan
```

**重要な点**:
- Terragrunt は `working-directory` から上位ディレクトリの `terragrunt.hcl` を自動探索（`find_in_parent_folders()`）
- `--terragrunt-working-dir` フラグは 0.96.1 では定義されていない（GitHub Actions エラーの原因）
- 代わりに bash の `working-directory` キーを使用するのが標準

**現在の実装**: ✅ 正しく実装されている

#### 4. HCL フォーマットコマンド

```bash
# フォーマットチェック
terragrunt hcl fmt --check --working-dir terraform

# フォーマット実行
terragrunt hcl fmt --working-dir terraform
```

**フラグ**:
- `--check`: ドライラン（実際にフォーマットしない）
- `--working-dir PATH`: 操作対象ディレクトリを明示的に指定

## 既知の問題と解決策

### エラー: "flag provided but not defined"

**原因**: Terragrunt 0.96.1 では以下のフラグが存在しない

```bash
❌ terragrunt run-all plan --terragrunt-non-interactive
❌ terragrunt run-all plan --terragrunt-working-dir terraform
```

**解決策**:

| 目的 | ❌ 間違ったフラグ | ✅ 正しい方法 |
|------|----------------|----|
| 非インタラクティブ | `--terragrunt-non-interactive` | `TERRAGRUNT_NON_INTERACTIVE=true` 環境変数 |
| Working Dir 指定 | `--terragrunt-working-dir PATH` | GitHub Actions の `working-directory` キー |

### Terraform フラグのパススルー

Terraform のネイティブフラグ（`-auto-approve`, `-lock-timeout`, `-no-color` など）は、Terragrunt が自動的に Terraform に渡す。

```bash
terragrunt run-all apply -auto-approve
# ↓ Terragrunt が内部で以下を実行
# terraform apply -auto-approve
```

## 制約と考慮事項

### パフォーマンス
- `run-all` コマンドは全モジュールを並列実行できるが、状態ロック（DynamoDB）の競合に注意
- `-lock-timeout=5m` は十分だが、大規模環境では調整が必要な場合あり

### 信頼性
- リモートステート設定の確認が必須（S3 バケット + DynamoDB ロックテーブル）
- AWS 認証情報が正しく設定されていることを確認（GitHub Actions では OIDC 使用）

### セキュリティ
- `TERRAGRUNT_NON_INTERACTIVE=true` は認証情報漏洩防止に重要
- `-auto-approve` は本番環境では慎重に使用（人的レビュー後推奨）

### テスト戦略
- PR では `terraform-plan` ジョブで各環境を個別実行し、問題を素早く検出
- Main ブランチへのマージ後、`terraform-apply` で `run-all apply` を実行（手動トリガー）

## リファレンス

### プロジェクト内ファイル
- `/Users/riku/Work/smarthome/.github/workflows/terraform-apply.yml` - Apply ワークフロー本体
- `/Users/riku/Work/smarthome/.github/workflows/terraform-ci.yml` - CI チェック
- `/Users/riku/Work/smarthome/terraform/terragrunt.hcl` - ルート設定
- `/Users/riku/Work/smarthome/terraform/environments/prod/` - 環境設定

### 外部リファレンス
- **Terragrunt CLI Options**: https://terragrunt.gruntwork.io/docs/reference/cli-options/
- **Terragrunt run-all**: https://terragrunt.gruntwork.io/docs/features/execute-terraform-commands-on-multiple-modules/
- **Terragrunt v0.96.1 Release**: https://github.com/gruntwork-io/terragrunt/releases/tag/v0.96.1

## 潜在的な課題と推奨事項

### 課題 1: DynamoDB ロックテーブルの存在確認
**状況**: Terraform ロック用 DynamoDB テーブルが存在しない場合、apply が失敗
**対策**:
- AWS マネコンソールで確認、または
- CloudFormation/Terraform で事前作成

### 課題 2: 並列実行時の依存性管理
**状況**: `run-all` は依存関係を考慮して実行されるが、循環依存があるとエラー
**対策**:
- 各モジュールの `terragrunt.hcl` で `dependency` ブロックが正しく定義されていることを確認
- 現在は `lambda-api` と `lambda-poller` が `dynamodb` に依存する設計が推奨

### 課題 3: GitHub Actions シークレット の管理
**状況**: AWS_ACCOUNT_ID, SWITCHBOT_DEVICE_ID など複数のシークレットが必要
**対策**:
- GitHub Organizations セクレットの使用を検討
- ローテーション戦略の策定

## 推奨される実装方法

### GitHub Actions での最適な使用法

```yaml
# ✅ 推奨される実装（現在のワークフロー）
jobs:
  terraform-apply:
    runs-on: ubuntu-latest
    env:
      TERRAGRUNT_NON_INTERACTIVE: "true"  # 非インタラクティブモード
    steps:
      - uses: actions/checkout@v4

      - name: Setup Terragrunt
        run: |
          TERRAGRUNT_VERSION=0.96.1
          wget -q https://github.com/gruntwork-io/terragrunt/releases/download/v${TERRAGRUNT_VERSION}/terragrunt_linux_amd64
          chmod +x terragrunt_linux_amd64
          sudo mv terragrunt_linux_amd64 /usr/local/bin/terragrunt

      - name: Terraform Apply (run-all)
        if: inputs.environment == 'all'
        working-directory: terraform/environments/prod
        run: |
          terragrunt run-all apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve

      - name: Terraform Apply (single environment)
        if: inputs.environment != 'all'
        working-directory: terraform/environments/prod/${{ inputs.environment }}
        run: |
          terragrunt apply \
            -lock-timeout=5m \
            -no-color \
            -auto-approve
```

### ローカル開発での使用法

```bash
# 非インタラクティブモードで実行
export TERRAGRUNT_NON_INTERACTIVE=true

# 全モジュールの plan 確認
cd terraform/environments/prod
terragrunt run-all plan

# 特定の環境のみ apply
cd terraform/environments/prod/dynamodb
terragrunt apply -lock-timeout=5m -auto-approve
```

## まとめ

### 0.96.1 で正しく動作するコマンド

✅ **推奨**:
```bash
export TERRAGRUNT_NON_INTERACTIVE=true
cd terraform/environments/prod
terragrunt run-all plan -lock-timeout=5m -no-color
terragrunt run-all apply -lock-timeout=5m -no-color -auto-approve
```

❌ **使用不可**:
```bash
terragrunt run-all plan --terragrunt-non-interactive
terragrunt run-all plan --terragrunt-working-dir terraform
```

### 主要な学習ポイント

1. **非インタラクティブモード**: フラグではなく、必ず `TERRAGRUNT_NON_INTERACTIVE=true` 環境変数を使用
2. **Working Directory**: `--terragrunt-working-dir` フラグは存在しない。bash の `working-directory` キーを使用
3. **Terraform フラグ**: `-auto-approve`, `-lock-timeout` などは直接 `terragrunt run-all` に渡される
4. **GitHub Actions**: 環境変数設定と `working-directory` ステップキーの組み合わせが最適

現在のプロジェクトの実装は正しい設計となっている。
