# Technical Debt Tracker

このファイルは、プロジェクトの技術的負債を追跡します。

## 優先度の定義

- **高**: すぐに対処すべき。セキュリティ、パフォーマンス、保守性に大きな影響
- **中**: 近い将来対処すべき。影響は限定的だが放置すると悪化
- **低**: 時間があるときに対処。改善だが緊急性なし

## アクティブな技術的負債

現在、技術的負債はありません。

## 解決済みの技術的負債

---

### 2026-04-04 - POST /data 認証を X-Api-Key から IAM 認証へ移行

**場所**: `terraform/modules/lambda-container/main.tf`、`lambda/api/main.py`、`pi-client/ble_scanner.py`

**問題**:
X-Api-Key ヘッダーによるアプリケーションレベル認証は、シークレット管理や鍵漏洩リスクがあった。

**推奨アクション（実施済み）**:
- Raspberry Pi 専用の IAM 認証 Lambda Function URL を追加（`authorization_type = "AWS_IAM"`）
- Raspberry Pi クライアントを SigV4 署名（botocore）に移行
- パブリック URL の POST /data は X-Api-Key による二重防御を維持
- Terraform で Raspberry Pi 用 IAM User/Policy/AccessKey を自動作成

**優先度**: 高

**ステータス**: Resolved

---

### 2026-04-04 - API_KEY 環境変数が Terraform・CI に未設定

**場所**: `terraform/environments/prod/lambda-api/terragrunt.hcl`

**問題**:
`POST /data` に X-Api-Key 認証を追加したが、Lambda に渡す `API_KEY` 環境変数が Terraform と CI ワークフローに設定されていなかった。本番環境で `POST /data` を呼ぶと 500 エラーになる状態だった。

**推奨アクション（実施済み）**:
- `terragrunt.hcl` に `API_KEY = get_env("API_KEY", "")` を追加
- `.github/workflows/terraform-apply.yml` に `API_KEY: ${{ secrets.API_KEY }}` を追加
- GitHub リポジトリの Settings → Secrets and variables → Actions に `API_KEY` を登録

**優先度**: 高

**ステータス**: Resolved

実装中に発見した技術的負債は以下の形式で記録してください：

---

### [日付] - [問題の概要]

**場所**: `src/path/to/file.ts:123`

**問題**:
現在の実装では...

**影響**:
- パフォーマンス: 高/中/低
- 保守性: 高/中/低
- セキュリティ: 高/中/低

**推奨アクション**:
...

**優先度**: 高/中/低

**ステータス**: Open | In Progress | Resolved

---

## 解決済みの技術的負債

解決済みの項目は以下に移動し、学びを記録します。

## ガベージコレクション

定期的（週次または隔週）に以下を実行：

1. 優先度「高」の項目を1つ選ぶ
2. 修正計画を作成
3. エージェントに実装させる
4. 完了したら「解決済み」セクションに移動

## 変更履歴

- 2026-03-28: 初期作成
