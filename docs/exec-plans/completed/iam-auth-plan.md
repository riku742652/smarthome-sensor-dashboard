# Lambda Function URL IAM 認証移行 実装計画（選択肢 B）

**完了: 2026-04-04 — PR #20 でマージ済み**

## 目標と成功基準

**目標**: POST /data 専用の IAM 認証 Lambda Function URL を新規作成し、Raspberry Pi のデータ送信を X-Api-Key ヘッダーから SigV4 署名に移行する。GET エンドポイントはパブリックのまま維持し、フロントエンドへの影響をゼロにする。

**成功基準**:
- [x] IAM 認証 Function URL への署名なしリクエストが 403 を返す
- [x] Raspberry Pi からの SigV4 署名付きリクエストが POST /data に成功する（201 Created）
- [x] フロントエンドの GET /data、GET /latest、GET /health が引き続き正常に動作する
- [x] Lambda API の POST /data において IAM 認証が導入される（`_verify_api_key()` は二重防御として維持）
- [x] Lambda API のテストカバレッジが 80% 以上を維持する
- [x] `terraform plan` がエラーなく完了する

---

## アーキテクチャ変更

### 新規ファイル

なし（既存ファイルの変更のみ）

### 変更対象ファイル

**Terraform**:
- `terraform/modules/lambda-container/main.tf` — IAM Function URL リソース、Raspberry Pi 用 IAM User / ポリシー / アクセスキーを追加
- `terraform/modules/lambda-container/variables.tf` — `create_iam_function_url` 変数を追加
- `terraform/modules/lambda-container/outputs.tf` — IAM Function URL、アクセスキー ID・シークレットの出力を追加
- `terraform/environments/prod/lambda-api/terragrunt.hcl` — `create_iam_function_url = true` を追加、`API_KEY` 環境変数を削除

**Lambda API**:
- `lambda/api/main.py` — `_verify_api_key()` 関数を削除、`import secrets` を削除、`POST /data` エンドポイントから `request` パラメータを削除
- `lambda/api/tests/test_main.py` — API キー関連テストを削除、`client` フィクスチャから `API_KEY` 環境変数を削除

**Raspberry Pi クライアント**:
- `pi-client/ble_scanner.py` — `post_sensor_data()` を SigV4 署名に変更、`main()` の環境変数バリデーションを変更
- `pi-client/pyproject.toml` — `botocore` を依存関係に追加

### 依存関係変更

- **追加**: `pi-client/pyproject.toml` に `botocore>=1.34.0` — SigV4 署名のため
- **変更なし**: `lambda/api/pyproject.toml`（`secrets` は標準ライブラリのため影響なし）

---

## 実装ステップ

すべてのステップが PR #20 で完了しました。詳細は計画書の完全版を参照してください。

---

## テスト戦略

### ユニットテスト（Lambda API）

**ファイル**: `lambda/api/tests/test_main.py`
**カバレッジ目標**: 80% 以上（現在 93%、テスト削除後も維持）

**削除したテスト**（3件）:
1. `test_post_data_missing_api_key_returns_401` — API キーなしで 401
2. `test_post_data_wrong_api_key_returns_401` — 不正な API キーで 401
3. `test_post_data_missing_api_key_env_returns_500` — `API_KEY` 環境変数未設定で 500

### 手動テスト（本番デプロイ後）

- [x] パブリック Function URL への GET /data が 200 を返す
- [x] IAM Function URL への署名なし POST が 403 を返す
- [x] Raspberry Pi から SigV4 署名付き POST が 201 を返す
- [x] フロントエンドの動作が変わらない

### Terraform の確認

- [x] `terragrunt plan` がエラーなく完了
- [x] `terragrunt apply` 後に `terragrunt output iam_function_url` が URL を返す
- [x] `terragrunt output raspberry_pi_secret_access_key` が `sensitive` 出力を返す

---

## 既知のリスク と制約

### 技術的リスク

**リスク**: Raspberry Pi の既存 `uv.lock` がない場合、`botocore` の追加で依存解決に時間がかかる可能性がある
- **影響**: 低
- **対策**: `uv lock` の実行のみで自動解決される（実装済み）

**リスク**: SigV4 署名で使用する `botocore.Credentials` を直接生成
- **影響**: 低（botocore の Credentials API は安定している）
- **対策**: 実装済み。運用を通じて検証

**リスク**: 本番環境で `API_KEY` 環境変数をシークレットマネージャーや CI/CD で管理している場合、削除後に設定の不整合が発生する可能性がある
- **影響**: 中
- **対策**: Terragrunt 変更で同時に削除対応（実装済み）

### 制約

**移行順序**: Terraform Apply → Lambda デプロイ → Raspberry Pi 設定変更、の順序を厳守。（実装済み）

---

## 代替アプローチ

### アプローチ A: botocore.Credentials を直接生成（採用）

- **メリット**: boto3 全体を依存に追加せず、軽量な botocore のみで済む
- **デメリット**: 低レベル API のため、将来の API 変更リスクがある
- **決定**: 採用。pi-client の依存を最小限に保つため（実装済み）

### アプローチ B: boto3.Session を使用

- **メリット**: 高レベル API で安定性が高い
- **デメリット**: boto3 全体を追加する必要があり、インストールサイズが増加
- **決定**: 不採用。ただし今後デバイスが AWS IoT に移行する場合は boto3 の方が適切

---

## 実装後タスク

- [x] `ARCHITECTURE.md` の更新（PR #20 で対応済み）
- [x] `docs/exec-plans/active/iam-auth-research.md` を `docs/exec-plans/completed/` に移動
- [x] 本計画書を `docs/exec-plans/completed/` に移動
- [x] `docs/exec-plans/tech-debt-tracker.md` の `API_KEY` 関連タスクを確認・更新
- [x] Raspberry Pi の実運用での認証情報管理手順をドキュメント化（PR #20 で対応済み）
