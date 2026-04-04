# Lambda Function URL IAM 認証移行 実装計画（選択肢 B）

## 目標と成功基準

**目標**: POST /data 専用の IAM 認証 Lambda Function URL を新規作成し、Raspberry Pi のデータ送信を X-Api-Key ヘッダーから SigV4 署名に移行する。GET エンドポイントはパブリックのまま維持し、フロントエンドへの影響をゼロにする。

**成功基準**:
- [ ] IAM 認証 Function URL への署名なしリクエストが 403 を返す
- [ ] Raspberry Pi からの SigV4 署名付きリクエストが POST /data に成功する（201 Created）
- [ ] フロントエンドの GET /data、GET /latest、GET /health が引き続き正常に動作する
- [ ] Lambda API から `_verify_api_key()` 関数および `API_KEY` 環境変数への依存が削除される
- [ ] Lambda API のテストカバレッジが 80% 以上を維持する
- [ ] `terraform plan` がエラーなく完了する

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

### Step 1: Terraform — `create_iam_function_url` 変数を追加

**目的**: IAM Function URL 作成を制御するフラグ変数を定義する。既存の Terraform 設計パターン（`create_function_url` 変数）に倣う。

**アクション**:
1. `terraform/modules/lambda-container/variables.tf` に以下の変数を追記する:
   ```hcl
   variable "create_iam_function_url" {
     description = "IAM 認証付き Lambda Function URL を作成するかどうか（Raspberry Pi 用 POST エンドポイント向け）"
     type        = bool
     default     = false
   }
   ```

**完了基準**:
- [ ] `variables.tf` に `create_iam_function_url` 変数が追加されている
- [ ] デフォルト値が `false`（既存環境への影響なし）

**影響ファイル**:
- `terraform/modules/lambda-container/variables.tf`（変更）

---

### Step 2: Terraform — IAM Function URL リソースを追加

**目的**: POST /data 専用の `authorization_type = "AWS_IAM"` Function URL を追加する。既存のパブリック URL とは別リソースとして管理し、独立して参照できるようにする。

**アクション**:
1. `terraform/modules/lambda-container/main.tf` の既存 `aws_lambda_function_url.this[0]` リソースの直後（スケジュール関連リソースの前）に以下を追加する:
   ```hcl
   # IAM 認証 Lambda Function URL（Raspberry Pi 専用 POST エンドポイント）
   resource "aws_lambda_function_url" "iam" {
     count              = var.create_iam_function_url ? 1 : 0
     function_name      = aws_lambda_function.this.function_name
     authorization_type = "AWS_IAM"
   
     cors {
       allow_credentials = false
       allow_origins     = ["*"]
       allow_methods     = ["POST"]
       allow_headers     = ["*"]
       max_age           = 86400
     }
   }
   ```
   - CORS の `allow_methods` を `["POST"]` に絞ることで、POST 専用であることを明示する

**完了基準**:
- [ ] `aws_lambda_function_url.iam` リソースが追加されている
- [ ] `count = var.create_iam_function_url ? 1 : 0` で条件作成されている
- [ ] `authorization_type = "AWS_IAM"` が設定されている

**影響ファイル**:
- `terraform/modules/lambda-container/main.tf`（変更）

---

### Step 3: Terraform — Raspberry Pi 用 IAM User / ポリシー / アクセスキーを追加

**目的**: Raspberry Pi が IAM Function URL を呼び出せるよう、最小権限の IAM User を作成する。

**アクション**:
1. `terraform/modules/lambda-container/main.tf` に、IAM Function URL リソースの直後に以下を追加する:

   ```hcl
   # Raspberry Pi 用 IAM User（create_iam_function_url = true のときのみ作成）
   resource "aws_iam_user" "raspberry_pi" {
     count = var.create_iam_function_url ? 1 : 0
     name  = "${var.project_name}-${var.environment}-raspberry-pi"
   
     tags = {
       Name        = "${var.project_name}-${var.environment}-raspberry-pi"
       Project     = var.project_name
       Environment = var.environment
     }
   }
   
   # Raspberry Pi 用 IAM ポリシー（lambda:InvokeFunctionUrl のみ許可）
   resource "aws_iam_user_policy" "raspberry_pi" {
     count = var.create_iam_function_url ? 1 : 0
     name  = "invoke-lambda-function-url"
     user  = aws_iam_user.raspberry_pi[0].name
   
     policy = jsonencode({
       Version = "2012-10-17"
       Statement = [
         {
           Effect   = "Allow"
           Action   = "lambda:InvokeFunctionUrl"
           Resource = "${aws_lambda_function.this.arn}"
           Condition = {
             StringEquals = {
               "lambda:FunctionUrlAuthType" = "AWS_IAM"
             }
           }
         }
       ]
     })
   }
   
   # Raspberry Pi 用 IAM アクセスキー（sensitive 出力）
   resource "aws_iam_access_key" "raspberry_pi" {
     count = var.create_iam_function_url ? 1 : 0
     user  = aws_iam_user.raspberry_pi[0].name
   }
   ```

**完了基準**:
- [ ] `aws_iam_user.raspberry_pi`、`aws_iam_user_policy.raspberry_pi`、`aws_iam_access_key.raspberry_pi` が追加されている
- [ ] ポリシーが `lambda:InvokeFunctionUrl` アクションのみに絞られている
- [ ] すべてのリソースに `count = var.create_iam_function_url ? 1 : 0` が設定されている

**影響ファイル**:
- `terraform/modules/lambda-container/main.tf`（変更）

---

### Step 4: Terraform — outputs.tf に IAM 関連の出力を追加

**目的**: IAM Function URL と IAM アクセスキーを Terraform 出力として公開し、Raspberry Pi の設定に使用できるようにする。アクセスキーは `sensitive = true` でログ漏洩を防ぐ。

**アクション**:
1. `terraform/modules/lambda-container/outputs.tf` に以下を追記する:

   ```hcl
   output "iam_function_url" {
     description = "IAM 認証 Lambda Function URL（Raspberry Pi 専用 POST エンドポイント）。create_iam_function_url = false の場合は null"
     value       = var.create_iam_function_url ? aws_lambda_function_url.iam[0].function_url : null
   }
   
   output "raspberry_pi_access_key_id" {
     description = "Raspberry Pi 用 IAM アクセスキー ID"
     value       = var.create_iam_function_url ? aws_iam_access_key.raspberry_pi[0].id : null
   }
   
   output "raspberry_pi_secret_access_key" {
     description = "Raspberry Pi 用 IAM シークレットアクセスキー（機密情報）"
     value       = var.create_iam_function_url ? aws_iam_access_key.raspberry_pi[0].secret : null
     sensitive   = true
   }
   ```

**完了基準**:
- [ ] `iam_function_url` 出力が追加されている
- [ ] `raspberry_pi_access_key_id` 出力が追加されている
- [ ] `raspberry_pi_secret_access_key` 出力が `sensitive = true` で追加されている

**影響ファイル**:
- `terraform/modules/lambda-container/outputs.tf`（変更）

---

### Step 5: Terragrunt — prod 環境で IAM Function URL を有効化

**目的**: `terraform/environments/prod/lambda-api/terragrunt.hcl` を更新し、IAM Function URL を有効化する。同時に不要になった `API_KEY` 環境変数も削除する。

**アクション**:
1. `terraform/environments/prod/lambda-api/terragrunt.hcl` の `inputs` ブロックを以下のように変更する:
   - `create_iam_function_url = true` を追加する
   - `environment_variables` ブロックから `API_KEY = get_env("API_KEY", "")` を削除する

   変更後のイメージ:
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
   
     # Lambda Function URL 設定
     create_function_url     = true   # パブリック URL（フロントエンド・GET 用）
     create_iam_function_url = true   # IAM 認証 URL（Raspberry Pi 専用 POST 用）
   
     dynamodb_table_arn = dependency.dynamodb.outputs.table_arn
   
     environment_variables = {
       TABLE_NAME = dependency.dynamodb.outputs.table_name
       DEVICE_ID  = get_env("SWITCHBOT_DEVICE_ID", "")
       # API_KEY は IAM 認証に移行したため不要
     }
   }
   ```

**完了基準**:
- [ ] `create_iam_function_url = true` が追加されている
- [ ] `API_KEY` 環境変数の行が削除されている

**影響ファイル**:
- `terraform/environments/prod/lambda-api/terragrunt.hcl`（変更）

---

### Step 6: Lambda API — `_verify_api_key()` を削除

**目的**: IAM 認証は Lambda Function URL レベルで処理されるため、FastAPI レベルの `_verify_api_key()` 関数は不要になる。コードを簡素化し、`API_KEY` 環境変数への依存をなくす。

**アクション**:
1. `lambda/api/main.py` から以下を削除する:
   - `import secrets`（9行目）
   - `_verify_api_key()` 関数全体（98〜114行目）
2. `POST /data` エンドポイント（`create_sensor_data` 関数）を変更する:
   - 関数シグネチャから `request: Request` パラメータを削除する
   - 関数本体から `_verify_api_key(request)` の呼び出し行を削除する
   - `Request` が不要になる場合、`from fastapi import FastAPI, Query, HTTPException, Request` から `Request` を削除する

   変更後の関数シグネチャ:
   ```python
   @app.post("/data", response_model=SensorData, status_code=201)
   async def create_sensor_data(data: SensorDataCreate):
   ```

   変更後のエンドポイント冒頭:
   ```python
   # POST /data は deviceId をリクエストから受け取るため TABLE_NAME のみ必要
   table_name = os.environ.get('TABLE_NAME')
   ```

**完了基準**:
- [ ] `import secrets` が削除されている
- [ ] `_verify_api_key()` 関数が削除されている
- [ ] `create_sensor_data()` の `request: Request` パラメータが削除されている
- [ ] `_verify_api_key(request)` の呼び出しが削除されている
- [ ] ファイルが文法エラーなく `uv run python -c "import main"` で読み込めること

**影響ファイル**:
- `lambda/api/main.py`（変更）

---

### Step 7: Lambda API テスト — API キー関連テストを削除・更新

**目的**: `_verify_api_key()` の削除に伴い、APIキー認証に関連するテストを削除し、テストスイートが引き続き正常に動作するようにする。

**アクション**:
1. `lambda/api/tests/test_main.py` から以下を削除する:
   - ファイル上部の定数: `TEST_API_KEY = 'test-api-key'`（37行目）および `POST_HEADERS = {'X-Api-Key': TEST_API_KEY}`（38行目）
   - `client` フィクスチャの `mocker.patch.dict` から `'API_KEY': TEST_API_KEY` の行を削除する
2. `TestCreateDataEndpoint` クラスのテストを変更する:
   - `headers=POST_HEADERS` を使用している全テストから `headers=POST_HEADERS` 引数を削除する
   - 以下の API キー認証専用テスト3件を削除する:
     - `test_post_data_missing_api_key_returns_401`
     - `test_post_data_wrong_api_key_returns_401`
     - `test_post_data_missing_api_key_env_returns_500`
3. `test_post_data_missing_table_name_returns_500` テストの `mocker.patch.dict` から `'API_KEY': TEST_API_KEY` を削除する

**完了基準**:
- [ ] API キー関連テスト3件が削除されている
- [ ] `POST_HEADERS` / `TEST_API_KEY` の定数が削除されている
- [ ] 残りのテストが `uv run pytest tests/` でパスする
- [ ] テストカバレッジが 80% 以上を維持している

**影響ファイル**:
- `lambda/api/tests/test_main.py`（変更）

---

### Step 8: Raspberry Pi — `botocore` を依存関係に追加

**目的**: SigV4 署名に必要な `botocore` ライブラリを pi-client に追加する。`boto3` より軽量であり、署名機能（`botocore.auth.SigV4Auth`）は `botocore` に含まれている。

**アクション**:
1. `pi-client/pyproject.toml` の `dependencies` に `botocore>=1.34.0` を追加する:
   ```toml
   dependencies = [
       "bleak>=0.22",
       "botocore>=1.34.0",
       "httpx>=0.27",
   ]
   ```
2. `pi-client/` ディレクトリで `uv lock` を実行して `uv.lock` を更新する（uv.lock がある場合。なければ作成される）

**完了基準**:
- [ ] `pyproject.toml` に `botocore>=1.34.0` が追加されている
- [ ] `uv sync` が正常に完了する

**影響ファイル**:
- `pi-client/pyproject.toml`（変更）

---

### Step 9: Raspberry Pi — `post_sensor_data()` を SigV4 署名に変更

**目的**: `pi-client/ble_scanner.py` の `post_sensor_data()` 関数を、`X-Api-Key` ヘッダーの代わりに SigV4 署名を付与するよう変更する。

**アクション**:
1. `pi-client/ble_scanner.py` の先頭に以下のインポートを追加する:
   ```python
   import json
   from botocore.auth import SigV4Auth
   from botocore.awsrequest import AWSRequest
   from botocore.credentials import Credentials
   ```
2. `post_sensor_data()` 関数のシグネチャから `api_key: str` パラメータを削除し、代わりに `aws_region: str` を追加する:
   ```python
   async def post_sensor_data(
       client: httpx.AsyncClient,
       api_url: str,
       aws_region: str,
       device_id: str,
       data: dict,
   ) -> None:
   ```
3. 関数本体を SigV4 署名を使うよう変更する:
   ```python
   async def post_sensor_data(
       client: httpx.AsyncClient,
       api_url: str,
       aws_region: str,
       device_id: str,
       data: dict,
   ) -> None:
       """センサーデータを Lambda API に SigV4 署名付きで POST する"""
       url = f"{api_url}/data"
       payload = json.dumps({"deviceId": device_id, **data})
   
       # SigV4 署名を生成する
       # AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY は環境変数から自動的に読み込まれる
       access_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
       secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
       credentials = Credentials(access_key, secret_key)
   
       aws_request = AWSRequest(
           method="POST",
           url=url,
           data=payload,
           headers={"Content-Type": "application/json"},
       )
       SigV4Auth(credentials, "lambda", aws_region).add_auth(aws_request)
       signed_headers = dict(aws_request.headers)
   
       resp = await client.post(
           url,
           content=payload,
           headers=signed_headers,
           timeout=10,
       )
       resp.raise_for_status()
       logger.info(
           "POST /data success: temp=%.1f hum=%d co2=%d",
           data["temperature"],
           data["humidity"],
           data["co2"],
       )
   ```

**完了基準**:
- [ ] `post_sensor_data()` のシグネチャから `api_key` が削除されている
- [ ] SigV4 署名ロジックが実装されている
- [ ] `botocore.auth.SigV4Auth` が使用されている

**影響ファイル**:
- `pi-client/ble_scanner.py`（変更）

---

### Step 10: Raspberry Pi — `main()` の環境変数バリデーションを変更

**目的**: `main()` 関数の環境変数読み込みを変更し、`API_KEY` の代わりに `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_DEFAULT_REGION` を使用するようにする。

**アクション**:
1. `main()` 関数内の環境変数読み込みを変更する:
   - `api_key = os.environ.get("API_KEY", "")` を削除する
   - 以下を追加する:
     ```python
     aws_region = os.environ.get("AWS_DEFAULT_REGION", "ap-northeast-1")
     ```
2. バリデーションチェックを更新する:
   ```python
   # 変更前
   if not all([api_url, api_key, device_id]):
       logger.error(
           "Missing required environment variables: API_URL, API_KEY, or DEVICE_ID"
       )
       sys.exit(1)
   
   # 変更後
   aws_access_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
   aws_secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
   if not all([api_url, device_id, aws_access_key, aws_secret_key]):
       logger.error(
           "Missing required environment variables: API_URL, DEVICE_ID,"
           " AWS_ACCESS_KEY_ID, or AWS_SECRET_ACCESS_KEY"
       )
       sys.exit(1)
   ```
3. `post_sensor_data()` 呼び出し箇所を更新する:
   ```python
   # 変更前
   await post_sensor_data(http_client, api_url, api_key, device_id, data)
   
   # 変更後
   await post_sensor_data(http_client, api_url, aws_region, device_id, data)
   ```

**完了基準**:
- [ ] `api_key` 変数の読み込みが削除されている
- [ ] `aws_region` が `AWS_DEFAULT_REGION` 環境変数から読み込まれている（デフォルト: `ap-northeast-1`）
- [ ] バリデーションチェックが `AWS_ACCESS_KEY_ID` と `AWS_SECRET_ACCESS_KEY` を確認している
- [ ] `post_sensor_data()` 呼び出しが新しいシグネチャに合わせて更新されている

**影響ファイル**:
- `pi-client/ble_scanner.py`（変更）

---

### Step 11: .env.example の更新

**目的**: Raspberry Pi の `.env.example` を更新し、新しい認証情報の設定方法を示す。

**アクション**:
1. `pi-client/` ディレクトリに `.env.example` が存在するか確認する。存在する場合、以下のように変更する:
   ```bash
   # Lambda Function URL (IAM 認証 URL に変更)
   API_URL=https://xxxxxxxxxx.lambda-url.ap-northeast-1.on.aws
   
   # AWS IAM 認証情報 (Terraform output から取得)
   # terraform output raspberry_pi_access_key_id
   # terraform output raspberry_pi_secret_access_key
   AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
   AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   AWS_DEFAULT_REGION=ap-northeast-1
   
   # デバイス設定
   DEVICE_ID=your-device-id
   
   # BLE 設定（任意）
   # DEVICE_MAC=XX:XX:XX:XX:XX:XX
   SCAN_INTERVAL=60
   SCAN_DURATION=5
   ```
2. `pi-client/` に `.env.example` が存在しない場合は上記内容で新規作成する。

**完了基準**:
- [ ] `API_KEY` が `.env.example` から削除されている
- [ ] `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_DEFAULT_REGION` が追加されている
- [ ] Terraform output からの取得方法がコメントで示されている

**影響ファイル**:
- `pi-client/.env.example`（新規または変更）

---

### Step 12: ARCHITECTURE.md の更新

**目的**: BLE センサーデータフローのセクションに POST /data の認証方法の変更を反映する。

**アクション**:
1. `ARCHITECTURE.md` の「BLE センサーデータフロー（Raspberry Pi 経由）」セクションにある POST /data の記述に認証方法を追記する:
   - 変更前: `Raspberry Pi --HTTP POST--> Lambda API`
   - 変更後: `Raspberry Pi --HTTP POST (SigV4署名)--> Lambda API (IAM認証)`
2. 「API Lambda」の `POST /data` エンドポイント説明から「X-Api-Key ヘッダーによる認証が必要」を「IAM 認証（Lambda Function URL レベル）が必要」に変更する。

**完了基準**:
- [ ] POST /data の認証方法が IAM 認証に更新されている
- [ ] SigV4 署名の記述が追加されている

**影響ファイル**:
- `ARCHITECTURE.md`（変更）

---

## テスト戦略

### ユニットテスト（Lambda API）

**ファイル**: `lambda/api/tests/test_main.py`
**カバレッジ目標**: 80% 以上（現在 93%、テスト削除後も維持）

**削除するテスト**（3件）:
1. `test_post_data_missing_api_key_returns_401` — API キーなしで 401
2. `test_post_data_wrong_api_key_returns_401` — 不正な API キーで 401
3. `test_post_data_missing_api_key_env_returns_500` — `API_KEY` 環境変数未設定で 500

**変更するテスト**:
- `client` フィクスチャから `API_KEY` 環境変数の設定を削除
- 全 POST リクエストから `headers=POST_HEADERS` 引数を削除
- `test_post_data_missing_table_name_returns_500` の `mocker.patch.dict` から `API_KEY` を削除

**維持するテスト**（既存の全 POST /data テスト、うち上記3件を除く）:
- `test_post_data_returns_201`
- `test_post_data_response_contains_sensor_fields`
- `test_post_data_timestamp_is_integer`
- `test_post_data_calls_put_item`
- `test_post_data_put_item_contains_expires_at`
- `test_post_data_missing_device_id_returns_422`
- `test_post_data_missing_temperature_returns_422`
- `test_post_data_missing_co2_returns_422`
- `test_post_data_invalid_temperature_type_returns_422`
- `test_post_data_dynamodb_error_returns_500`
- `test_post_data_missing_table_name_returns_500`
- `test_post_data_negative_temperature`

### 手動テスト（本番デプロイ後）

- [ ] パブリック Function URL への GET /data が 200 を返すことを確認
- [ ] IAM Function URL への署名なし POST が 403 を返すことを確認:
  ```bash
  curl -X POST https://<iam-function-url>/data \
    -H "Content-Type: application/json" \
    -d '{"deviceId":"test","temperature":22.5,"humidity":45,"co2":800}'
  # 期待: HTTP 403
  ```
- [ ] Raspberry Pi から SigV4 署名付き POST が 201 を返すことを確認
- [ ] フロントエンドの動作が変わらないことを確認

### Terraform の確認

- [ ] `terragrunt plan` がエラーなく完了する
- [ ] `terragrunt apply` 後に `terragrunt output iam_function_url` が URL を返す
- [ ] `terragrunt output raspberry_pi_secret_access_key` が `sensitive` 出力を返す

---

## 既知のリスクと制約

### 技術的リスク

**リスク**: Raspberry Pi の既存 `uv.lock` がない場合、`botocore` の追加で依存解決に時間がかかる可能性がある
- **影響**: 低
- **対策**: `uv lock` の実行のみで自動解決される

**リスク**: SigV4 署名で使用する `botocore.Credentials` を直接生成しているため、将来の botocore API 変更で動作しなくなる可能性がある
- **影響**: 低（botocore の Credentials API は安定している）
- **対策**: `boto3.Session().get_credentials()` でも同等の機能が得られる（boto3 を追加依存にしたくない場合は現状維持）

**リスク**: 本番環境で `API_KEY` 環境変数をシークレットマネージャーや CI/CD で管理している場合、削除後に設定の不整合が発生する可能性がある
- **影響**: 中
- **対策**: Step 5 の Terragrunt 変更で `API_KEY` を環境変数から削除するのと同時に、CI/CD のシークレット設定も更新する必要がある

**リスク**: IAM Function URL の CORS 設定で `allow_methods = ["POST"]` に絞っているが、Lambda Function URL のプリフライト（OPTIONS）リクエストとの互換性に注意が必要
- **影響**: 低（Raspberry Pi はブラウザではないため OPTIONS プリフライトを送信しない）
- **対策**: 問題が発生した場合は `["POST", "OPTIONS"]` または `["*"]` に変更する

### 制約

**移行順序**: Terraform Apply → Lambda デプロイ → Raspberry Pi 設定変更、の順序を厳守する必要がある。Lambda デプロイ前に Raspberry Pi を新 URL に切り替えると、`API_KEY` が設定されていない状態で旧ロジックが実行され 500 エラーになる可能性がある。

**本番への影響**: IAM Function URL の新規追加は既存パブリック URL に影響を与えない。ただし Lambda API から `_verify_api_key()` を削除した後のデプロイ前は、旧 X-Api-Key によるリクエストも認証なしで通過してしまう状態になる。Raspberry Pi を新 URL に切り替えてから Lambda を再デプロイすること。

---

## 代替アプローチの検討

### アプローチ A: botocore.Credentials を直接生成（採用）

- **メリット**: boto3 全体を依存に追加せず、軽量な botocore のみで済む
- **デメリット**: 低レベル API のため、将来の API 変更リスクがある
- **決定**: 採用。pi-client の依存を最小限に保つため

### アプローチ B: boto3.Session を使用

- **メリット**: 高レベル API で安定性が高く、認証情報のプロバイダーチェーン（環境変数→インスタンスプロファイル等）が自動で機能する
- **デメリット**: boto3 全体（botocore の上位依存）を追加する必要があり、インストールサイズが増加する
- **決定**: 不採用。ただし今後デバイスが AWS IoT に移行する場合は boto3 の方が適切

---

## 実装後タスク

- [ ] `ARCHITECTURE.md` の更新（Step 12 で対応済み）
- [ ] `docs/exec-plans/active/iam-auth-research.md` を `docs/exec-plans/completed/` に移動
- [ ] 本計画書を `docs/exec-plans/completed/` に移動
- [ ] `docs/exec-plans/tech-debt-tracker.md` の `API_KEY` 関連タスクを確認・更新（API_KEY 不要になるため「解決済み」に変更）
- [ ] Raspberry Pi の実運用での認証情報管理手順を `pi-client/` の README または `.env.example` に記載（IAM アクセスキーのローテーション推奨: 3ヶ月ごと）
