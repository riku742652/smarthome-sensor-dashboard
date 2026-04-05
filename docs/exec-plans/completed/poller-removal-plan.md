# Lambda Poller 削除 実装計画

**作成日**: 2026-04-05
**リサーチ元**: `docs/exec-plans/completed/poller-removal-research.md`

---

## Goal and Success Criteria

**Goal**: Lambda Poller に関連するすべてのコード・Terraform リソース・CI/CD ステップ・ドキュメントを削除し、システムから完全に除去する。Terraform destroy は GitHub Actions 経由で実施する。

**Success Criteria**:
- [x] `lambda/poller/` ディレクトリ（全ファイル）が削除されている
- [x] `terraform/environments/prod/lambda-poller/terragrunt.hcl` が削除されている
- [x] `terraform-ci.yml` から lambda-poller 関連のステップがすべて除去されている
- [x] `terraform-apply.yml` から lambda-poller 関連のステップと入力選択肢がすべて除去されている
- [x] PR の CI（`terraform-ci.yml`）が通過する（lambda-poller の plan ステップが消えたことで plan 数が 3 つに減る）
- [x] PR マージ後、GitHub Actions（Terraform Apply ワークフロー）経由で `environment: all` を実行し、AWS 上の lambda-poller リソース 10 個が destroy される
- [x] `ARCHITECTURE.md` から Poller Lambda 関連の記述が削除されている
- [x] `lambda/README.md` から Poller Lambda 関連の記述が削除されている
- [x] ECR リポジトリ `smarthome-sensor-poller` が AWS コンソール上で存在しないことを確認済み
- [x] コード・Terraform・主要運用ドキュメント（`ARCHITECTURE.md`、`lambda/README.md`）から `poller`・`ポーリング`・`polling` の文字列が削除されていることを確認（`docs/exec-plans/` 配下の履歴ドキュメントは除く）

---

## Architectural Changes

### 削除するファイル

- `lambda/poller/lambda_function.py` - Poller Lambda 本体（171行）
- `lambda/poller/pyproject.toml` - Python 依存定義（boto3, requests）
- `lambda/poller/uv.lock` - 依存ロックファイル
- `lambda/poller/Dockerfile` - ECR 向けコンテナイメージビルド定義
- `lambda/poller/.dockerignore` - Docker ビルド除外定義
- `lambda/poller/tests/__init__.py` - テストパッケージ初期化
- `lambda/poller/tests/test_lambda_function.py` - テストコード（300行、26ケース）
- `terraform/environments/prod/lambda-poller/terragrunt.hcl` - Terraform 設定（46行）
- `docs/exec-plans/active/poller-containerize-research.md` - 旧リサーチ（役割終了）
- `docs/exec-plans/archived/poller-containerize-plan.md` - 旧計画（役割終了）

### 修正するファイル

- `.github/workflows/terraform-apply.yml` - lambda-poller 関連ステップを 5 か所削除・修正
- `.github/workflows/terraform-ci.yml` - lambda-poller 関連ステップを 3 か所削除・修正（`pr-comment` ジョブのループも含む）
- `ARCHITECTURE.md` - Poller 関連記述を 5 か所削除
- `lambda/README.md` - Poller 関連セクションを全面削除し API のみ残す

### 削除される AWS リソース（Terraform destroy 対象）

| リソース | リソース ID |
|---------|-----------|
| `aws_ecr_repository` | `smarthome-sensor-poller` |
| `aws_ecr_lifecycle_policy` | smarthome-sensor-poller 向けポリシー |
| `aws_lambda_function` | `smarthome-prod-poller` |
| `aws_iam_role` | `smarthome-prod-poller-role` |
| `aws_iam_role_policy_attachment` | AWSLambdaBasicExecutionRole（Poller）|
| `aws_iam_role_policy` | `dynamodb-access`（Poller）|
| `aws_iam_role_policy` | `ecr-pull`（Poller）|
| `aws_cloudwatch_event_rule` | `smarthome-prod-poller-schedule` |
| `aws_cloudwatch_event_target` | 上記ルールのターゲット |
| `aws_lambda_permission` | `allow_eventbridge`（Poller）|

### GitHub Secrets の扱い

- `SWITCHBOT_TOKEN`: lambda-poller のみ参照 → Poller 削除後は参照されなくなる。GitHub Secrets から手動削除してよい（本計画の必須作業には含めない）
- `SWITCHBOT_SECRET`: 同上
- `SWITCHBOT_DEVICE_ID`: lambda-api でも参照しているため**削除しない**

---

## Test Strategy

### CI での検証（自動）

- **Terraform Format Check**: `terraform fmt -check -recursive terraform/`
- **Terraform Validate**: `lambda-container` モジュール（lambda-api で引き続き使用）を含む 4 モジュールを検証
- **Terragrunt HCL Format Check**: `lambda-poller/` ディレクトリが消えた状態で整合性確認
- **Terraform Plan（3環境）**:
  - `dynamodb`: No changes. 期待
  - `lambda-api`: No changes. 期待
  - `cloudfront`: No changes. 期待

### Terraform Plan の確認ポイント

PR の CI の Plan Summary に「No changes.」が3環境すべてで表示されることを確認する。lambda-poller リソースの削除は `terragrunt.hcl` を削除した後に `run-all apply` を実行することで初めて destroy が走る（CI の plan では表示されない点に注意）。

### 手動検証（AWS コンソール / CLI）

PR マージ後の Terraform Apply 実行後に以下をチェック:
- [x] Lambda 関数 `smarthome-prod-poller` が存在しない
- [x] ECR リポジトリ `smarthome-sensor-poller` が存在しない
- [x] IAM ロール `smarthome-prod-poller-role` が存在しない
- [x] EventBridge ルール `smarthome-prod-poller-schedule` が存在しない
- [x] CloudWatch Log Group `/aws/lambda/smarthome-prod-poller` の状態確認（Terraform 管理外のため自動削除されない。不要であれば手動削除）

---

## Known Risks and Constraints

### Technical Risks

- **Risk**: ECR リポジトリにイメージが残存している場合、`terraform destroy` が失敗する
  - **Impact**: High（destroy がブロックされる）
  - **Mitigation**: Step 1 で事前確認を実施する。イメージが存在する場合は手動で削除するか、`terragrunt.hcl` 削除前に一時的に `force_delete = true` を追加して apply → その後 hcl ごと削除する

- **Risk**: `terraform-ci.yml` の修正漏れにより CI が lambda-poller の存在しないディレクトリに plan を実行しようとして失敗する
  - **Impact**: High（CI がブロックされる）
  - **Mitigation**: Step 5 完了後に `grep -rn "lambda-poller" .github/` で残存チェックを必ず実施する

- **Risk**: `terragrunt run-all apply` 時に lambda-api や dynamodb が意図せず変更される
  - **Impact**: Medium（本番環境への影響）
  - **Mitigation**: Apply 前に Dry run（`dry_run: true`）を実施し、Plan Summary で lambda-poller のみが destroy 対象になっていることを確認する

- **Risk**: CloudWatch Log Group `/aws/lambda/smarthome-prod-poller` が Terraform 管理外のため destroy されずに残る
  - **Impact**: Low（コスト・整合性への軽微な影響）
  - **Mitigation**: 手動削除が必要な場合は Step 10 の後に実施する

### Constraints

- **実行順序の制約**: コード・ドキュメント削除 → PR → CI 通過 → マージ → GitHub Actions で terraform apply（destroy 実行）の順序を守ること。Terraform apply より先にファイルを削除しないと CI が失敗する。
- **DynamoDB の安全性**: `lambda-poller/terragrunt.hcl` のみ削除し、`dynamodb` モジュールは触れない。DynamoDB テーブルは lambda-api が引き続き使用するため削除しない。
- **GitHub Secrets の削除は任意**: `SWITCHBOT_TOKEN` と `SWITCHBOT_SECRET` は terraform-apply.yml から参照が消えた後に手動で削除できるが、本計画の必須作業には含めない。

---

## Post-Implementation Tasks

- [x] ARCHITECTURE.md の変更履歴に削除作業の記録が追記されている（Step 6 で実施）
- [ ] CloudWatch Log Group `/aws/lambda/smarthome-prod-poller` を必要に応じて手動削除する
- [ ] GitHub Secrets の `SWITCHBOT_TOKEN`、`SWITCHBOT_SECRET` を必要に応じて手動削除する
- [x] `docs/exec-plans/active/poller-removal-research.md` を `docs/exec-plans/completed/` に移動する
- [x] 本計画ファイルを `docs/exec-plans/completed/` に移動する

---

## 完了情報

**完了日**: 2026-04-05  
**完了PR**: #25  
**完了コミット**: 8cd7770 (chore: remove lambda-poller and all related resources)

**実装内容**:
- `lambda/poller/` ディレクトリ全体を削除
- `terraform/environments/prod/lambda-poller/` を削除
- `.github/workflows/terraform-apply.yml` から lambda-poller 関連ステップ（5か所）を削除
- `.github/workflows/terraform-ci.yml` から lambda-poller 関連ステップ（4か所）を削除
- `ARCHITECTURE.md` から Poller 関連記述（5か所）を削除
- `lambda/README.md` から Poller セクション全体を削除
- `docs/exec-plans/active/poller-containerize-research.md` を削除
- `docs/exec-plans/archived/poller-containerize-plan.md` を削除

**検証結果**:
- PR #25 マージ済み
- CI（terraform-ci.yml）通過確認済み
- Terraform plan で lambda-poller リソースの削除差分を確認
- GitHub Actions（Terraform Apply ワークフロー）経由の実行で lambda-poller リソースが destroy されたことを確認
- AWS 上の Poller リソース（Lambda、ECR、EventBridge など）が削除されたことを確認
