# Lambda Function URL IAM 認証移行リサーチ

## タスク理解

**要望**: Lambda Function URL を `authorization_type = "NONE"` (パブリック) から `authorization_type = "AWS_IAM"` に移行し、リクエストに対して IAM 認証を導入する。

**背景**: 
- 現在は POST /data のみ X-Api-Key ヘッダーで認証
- GET /data, /latest はパブリックアクセス
- フロントエンドとRaspberry Piの両方が同じFunction URLにアクセス
- セキュリティを向上させるためにIAM認証へ移行したい

**成功基準**:
- Function URL へのアクセスが IAM 認証で保護される
- フロントエンド (ブラウザ) がクライアント証明書なしでアクセス可能
- Raspberry Pi が SigV4 署名付きリクエストで認証
- 既存の機能が正常に動作

---

## 現状分析

### 現在の構成

#### Lambda Function URL設定
**ファイル**: `terraform/modules/lambda-container/main.tf` (L148-160)
```
- authorization_type = "NONE" (パブリック)
- CORS: allow_origins = ["*"]
- create_function_url = true (デフォルト)
```

#### Lambda の環境変数（prod設定）
**ファイル**: `terraform/environments/prod/lambda-api/terragrunt.hcl`
```
- DEVICE_ID: GET /data, /latest の照会対象
- TABLE_NAME: DynamoDB テーブル名
- API_KEY: POST /data 用 X-Api-Key 値
```

#### バックエンド認証ロジック
**ファイル**: `lambda/api/main.py`
- `_verify_api_key()`: POST /data のみで X-Api-Key ヘッダーを検証
- 他のエンドポイント (GET /data, /latest, /health) は無認証でアクセス可能
- タイムスタンプはサーバー側で生成（POST時）

#### フロントエンド API アクセス
**ファイル**: `src/domains/sensor/repository/SensorRepository.ts`
- `baseUrl` は `VITE_API_BASE_URL` 環境変数から取得
- `fetch()` で HTTP リクエスト実行
- GET /data, /latest のみ使用（POST は使用しない）

**ファイル**: `.env.example`
```
VITE_API_BASE_URL=https://your-lambda-function-url.lambda-url.ap-northeast-1.on.aws
```

#### Raspberry Pi クライアント
**ファイル**: `pi-client/ble_scanner.py`
- `httpx.AsyncClient` で非同期HTTP通信
- `API_URL`, `API_KEY`, `DEVICE_ID` を環境変数から取得
- POST /data を `X-Api-Key` ヘッダー付きで呼び出し

**ファイル**: `pi-client/pyproject.toml`
```
dependencies:
  - bleak>=0.22
  - httpx>=0.27
(aws-sdk 未導入)
```

#### CloudFront設定
**ファイル**: `terraform/modules/cloudfront/main.tf`
- S3 OAC (Origin Access Control) を使用
- Origin: S3 バケット（Lambda ではない）
- Lambda Function URL に CloudFront 経由でのアクセス設定なし

#### アーキテクチャ全体
```
ブラウザ (フロントエンド)
  ↓ HTTPS (CloudFront経由はしていない)
  └→ Lambda Function URL (パブリック)
    GET /data, /latest

Raspberry Pi
  ↓ HTTPS (X-Api-Key ヘッダー)
  └→ Lambda Function URL (パブリック)
    POST /data
```

---

## アーキテクチャ選択肢の詳細

### 選択肢 A: CloudFront OAC + AWS_IAM (推奨の候補)

**概要**: CloudFront を Lambda Function URL の前に配置し、OAC + SigV4 署名でセキュアなアクセス。

#### アーキテクチャ
```
ブラウザ
  ↓ HTTPS
  CloudFront (OAC, SigV4署名)
  ↓ HTTPS (署名付き)
  Lambda Function URL (AWS_IAM)
    GET /data, /latest

Raspberry Pi
  ↓ HTTPS (SigV4署名)
  Lambda Function URL (AWS_IAM)
    POST /data
```

#### 実装に必要な変更

**1. Lambda (Terraform)**
- `terraform/modules/lambda-container/main.tf` (L151)
  ```terraform
  authorization_type = "AWS_IAM"  # NONE から変更
  ```
- `terraform/modules/lambda-container/variables.tf`
  - 新規変数 `enable_iam_authorization` (デフォルト: true)

**2. CloudFront (Terraform)**
- `terraform/modules/cloudfront/main.tf`
  - 既存のS3オリジンに加えて、Lambda Function URLを新規オリジンとして追加
  - 新規 `aws_cloudfront_origin_access_control` リソース（Lambda用、SigV4署名）
  - キャッシュ動作の追加（API パスのキャッシュルール）
  - OAC署名後のリクエストをLambdaに転送

- `terraform/modules/cloudfront/variables.tf`
  - 新規変数 `lambda_function_url` (Lambda Function URLのエンドポイント)
  - 新規変数 `enable_lambda_origin` (デフォルト: true)

- `terraform/modules/cloudfront/outputs.tf`
  - Lambda オリジン用の出力値追加（不要かもしれない）

**3. CloudFront設定 (prod)**
- `terraform/environments/prod/cloudfront/terragrunt.hcl`
  - `lambda_function_url` 入力を `lambda-api` モジュール出力から参照
  - `enable_lambda_origin = true`
  - キャッシュTTL設定（API用）

**4. Lambda 環境変数**
- POST /data の認証ロジック（`lambda/api/main.py` の `_verify_api_key()`）を削除
  - IAM認証で保護されているため不要
  - または、IAM + X-Api-Key の二重認証として保持（より安全）

**5. Raspberry Pi クライアント**
- `pi-client/ble_scanner.py`
  - boto3/botocore で SigV4 署名を追加
  - `X-Api-Key` ヘッダーを削除（IAM認証に統一）
  - AWS IAM User の認証情報 (Access Key ID, Secret Access Key) を環境変数から取得

- `pi-client/pyproject.toml`
  - `boto3>=1.34.0` を依存関係に追加
  - またはより軽量な `botocore>=1.34.0`

**6. フロントエンド**
- `src/domains/sensor/config/api.ts`
  - `baseUrl` を CloudFront ドメイン名に変更
  - または環境変数で CloudFront URL を指定

- `.env.example`
  ```
  VITE_API_BASE_URL=https://your-cloudfront-domain.cloudfront.net
  ```

- フロントエンド自体は変更不要（ブラウザから CloudFront にアクセス、CloudFront が署名）

#### メリット
- セキュリティ: IAM ベースの認証で、APIキーをコード・環境変数から排除
- 統一: CloudFront を API ゲートウェイとして機能
- キャッシング: CloudFront でAPI応答をキャッシュ可能（GET系）
- Raspberry Pi: AWS IAM User の認証情報でセキュアに認証

#### デメリット
- 複雑性: CloudFront 設定が増加
- コスト: CloudFront の料金が発生（データ転送料金）
- キャッシング問題: DynamoDB データが更新されてもキャッシュが保持される可能性
- CloudFront と Lambda Function URL の両者が SigV4 署名に対応していることを確認が必要

#### 実装の複雑さ
**中程度** - CloudFront への新規オリジン追加、SigV4署名設定、Raspberry Pi の SigV4 実装

---

### 選択肢 B: POST用に別Function URL (AWS_IAM)

**概要**: GET用の公開URLは維持し、POST用のみ新規 AWS_IAM Function URL を作成。

#### アーキテクチャ
```
GET /data, /latest
  ↓ HTTPS
  Lambda Function URL (パブリック、現在の設定維持)

POST /data
  ↓ HTTPS (SigV4署名)
  Lambda Function URL (AWS_IAM, 新規)
    Raspberry Pi 専用
```

#### 実装に必要な変更

**1. Lambda (Terraform)**
- `terraform/modules/lambda-container/main.tf`
  - 既存の `aws_lambda_function_url.this[0]` に新規フラグ `create_iam_function_url` を追加
  - または、2つのリソース定義を分離: `aws_lambda_function_url.public` と `aws_lambda_function_url.iam`

**2. Lambda IAM ポリシー**
- POST /data へのアクセスのみに限定するために、Raspberry Pi 用 IAM User のポリシーを適切に設定
  - ただし、Lambda Function URL のレベルでは パス指定ができないため、バックエンド（FastAPI）で認証継続

**3. Raspberry Pi クライアント**
- `pi-client/ble_scanner.py`
  - POST /data の URL を新規 IAM Function URL に変更
  - SigV4 署名を実装
  - GET は引き続きパブリックURL から取得（必要に応じて）

- `pi-client/pyproject.toml`
  - `boto3>=1.34.0` 追加

**4. フロントエンド**
- 変更なし（公開URLを使用継続）

**5. バックエンド認証ロジック**
- `lambda/api/main.py` の `_verify_api_key()`
  - POST /data の認証を IAM 認証に変更、または削除
  - ただし、IAM User が複数ある場合、追加の認証層が必要（X-Api-Key 保持）

#### メリット
- 段階的: GET 系は そのまま、POST のみ保護
- シンプル: CloudFront 設定の変更不要
- コスト: CloudFront の料金不要

#### デメリット
- セキュリティ: GET /data, /latest はパブリックのままで、機密データ漏洩の可能性
- 複雑性: 2つのFunction URL を管理する必要
- バックエンド: POST /data の認証ロジック（`_verify_api_key()`）が引き続き必要な可能性
  - IAM User が1つのRaspberry Piであれば不要、複数であれば必要

#### 実装の複雑さ
**低程度** - Lambda Function URL の追加作成、Raspberry Pi の SigV4 実装のみ

---

### 選択肢 C: X-Api-Key 方式の継続

**概要**: 現在の X-Api-Key ベースの認証を継続し、IAM認証は導入しない。

#### メリット
- シンプル: 現在の実装をそのまま使用
- 実装コスト: ゼロ

#### デメリット
- セキュリティ: APIキーをコード・環境変数で管理するため、漏洩リスク高
- スケーラビリティ: Raspberry Pi が増える場合、APIキーも増加
- 最小権限: 認証層が粗い（コード内で十分な権限チェック不可）

#### 推奨: 選択肢A または B を推奨

---

## Raspberry Pi IAM認証の実装方法

### SigV4署名の実装

#### 方法1: boto3/botocore を使用 (推奨)

```python
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
import boto3

# AWS認証情報を environment variables から取得
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY は自動的に読み込まれる

session = boto3.Session()
credentials = session.get_credentials()

# SigV4署名の準備
url = "https://xxxxx.lambda-url.ap-northeast-1.on.aws/data"
request = AWSRequest(method="POST", url=url, data=json.dumps(payload))

# SigV4署名を追加
SigV4Auth(credentials, 'lambda', 'ap-northeast-1').add_auth(request)

#署名済みのヘッダーを抽出
signed_headers = dict(request.headers)

# httpx で署名済みヘッダーを使用
response = await http_client.post(url, json=payload, headers=signed_headers)
```

#### 方法2: AWS Signature Version 4 の手動実装
- 複雑（推奨しない）

### IAM User vs IAM Role (AWS IoT)

#### IAM User (現在推奨)
- Access Key ID, Secret Access Key を使用
- Raspberry Pi の環境変数に保存
- セキュリティ: キーの定期的なローテーション必須
- インフラストラクチャ: IAM ポリシーで `lambda:InvokeFunctionUrl` アクション許可

#### IAM Role (AWS IoT) - 将来の検討
- より安全（一時的な認証情報を STS から取得）
- Raspberry Pi を AWS IoT Device として登録する必要
- 複雑な設定

### 必要な IAM ポリシー

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunctionUrl",
      "Resource": "arn:aws:lambda:ap-northeast-1:ACCOUNT_ID:function:smarthome-prod-api:url"
    }
  ]
}
```

---

## リスクと制約

### セキュリティ上の考慮

| 項目 | 選択肢A (CloudFront + IAM) | 選択肢B (POST のみIAM) | 選択肢C (X-Api-Key) |
|------|---------------------------|----------------------|------------------|
| GET データ保護 | ○ (IAM) | ✗ (パブリック) | ✗ (APIキー) |
| POST 認証 | ○ (IAM + X-Api-Key可) | ○ (IAM) | ○ (APIキー) |
| APIキー不要 | ○ | ▲ (オプション) | ✗ |
| キャッシング | ○ (CloudFront) | ✗ | ✗ |

### 実装の複雑さ

| 項目 | 選択肢A | 選択肢B | 選択肢C |
|------|--------|--------|--------|
| CloudFront 設定 | 中 | - | - |
| Lambda 設定 | 中 | 低 | - |
| Raspberry Pi | 中 (SigV4) | 低 (SigV4) | - |
| フロントエンド | 中 | - | - |

### コスト影響

- 選択肢A: CloudFront 月額 + データ転送料金（月数千円〜万円程度、トラフィックに依存）
- 選択肢B: ほぼ無料（新規Function URL作成のコスト = 0）
- 選択肢C: ほぼ無料

### パフォーマンス

- 選択肢A: CloudFront キャッシュにより高速化（初回リクエスト後）
- 選択肢B: キャッシュなし、現在と同等
- 選択肢C: キャッシュなし、現在と同等

### フロントエンドへの影響

- 選択肢A: 
  - CloudFront URL を使用（環境変数変更）
  - コード変更なし
  - ただし、ブラウザからの直接的な Lambda URL へのアクセスが不可になる（CloudFront を経由する必要）

- 選択肢B:
  - 変更なし（GET は現在のFunction URLを使用）

- 選択肢C:
  - 変更なし

### CloudFront + Lambda Function URL の互換性

**注意**: AWS CloudFront が Lambda Function URL の SigV4 署名に対応しているか確認が必要
- CloudFront は S3 OAC で SigV4 署名に対応 ✓
- CloudFront は Lambda Function URL のSigV4署名に対応しているか？
  - 確認が必要（AWS Documentation 参照）
  - 可能性: CloudFront Origin が Lambda Function URL をサポートしていない場合、API Gateway を検討

---

## 既存パターンと参考実装

### Terraform 既存パターン

**Lambda Function URL の作成** (L148-160 in main.tf)
```terraform
resource "aws_lambda_function_url" "this" {
  count              = var.create_function_url ? 1 : 0
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "NONE"
  cors { ... }
}
```

**CloudFront OAC の実装** (L23-29 in cloudfront/main.tf)
```terraform
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project_name}-${var.environment}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
```

### バックエンド認証パターン

**FastAPI 認証ミドルウェア** (L98-114 in lambda/api/main.py)
```python
def _verify_api_key(request: Request) -> None:
  api_key = os.environ.get('API_KEY')
  if not api_key:
    raise HTTPException(status_code=500, detail="...")
  provided = request.headers.get('X-Api-Key', '')
  if not secrets.compare_digest(provided, api_key):
    raise HTTPException(status_code=401, detail="Unauthorized")
```

### フロントエンド API アクセスパターン

**Repository パターン** (src/domains/sensor/repository/SensorRepository.ts)
```typescript
constructor(baseUrl: string = API_CONFIG.baseUrl) {
  this.baseUrl = baseUrl
}

async fetchSensorData(hours: number): Promise<SensorDataResponse> {
  const url = `${this.baseUrl}${API_ENDPOINTS.data}?hours=${hours}`
  const response = await fetch(url)
  // ...
}
```

---

## 主な課題と検討事項

### 1. CloudFront + Lambda Function URL の互換性

**課題**: CloudFront が Lambda Function URL をオリジンとしてサポートしているか不明確
- S3 との互換性は確認済み
- Lambda Function URL との互換性は AWS Documentation で確認必須

**代替案**:
- API Gateway を使用（より成熟した設定オプション）
- CloudFront を経由せず、Lambda Function URL に直接アクセス（選択肢B）

### 2. パス指定の認可が難しい

**課題**: Lambda Function URL レベルで POST /data のみを認可することはできない
- AWS_IAM 認証はFunction全体を保護
- POST と GET に異なる認可を適用したい場合、バックエンドで追加認証が必要

**対策**: 
- 選択肢A: CloudFront + IAM で Function 全体を保護、バックエンドで追加ロジック（optional）
- 選択肢B: POST専用Function URL（IAM）を別途作成

### 3. Raspberry Pi の認証情報管理

**課題**: IAM User の Access Key ID / Secret Access Key を Raspberry Pi に保存する必要
- セキュリティリスク（鍵漏洩時の影響大）
- キーローテーションの手順が必要

**対策**:
- AWS IAM User のアクセス権限を制限（`lambda:InvokeFunctionUrl` のみ）
- 定期的な鍵ローテーション（3ヶ月ごと等）
- AWS Secrets Manager での将来的な管理検討

### 4. API レスポンスキャッシング

**課題** (選択肢A): CloudFront がAPI レスポンスをキャッシュした場合、リアルタイムデータが見えない
- DynamoDB データが更新されてもキャッシュが保持

**対策**:
- キャッシュTTLを短く設定（例：1分）
- または GET /data に `cache-control: no-cache` ヘッダーを設定

---

## 型定義と API 契約

### 現在のAPI契約

**GET /data**
```typescript
// Query: hours (1-168)
// Response:
{
  "data": [
    {
      "deviceId": string,
      "timestamp": number (ms),
      "temperature": number,
      "humidity": number,
      "co2": number
    }
  ],
  "count": number
}
```

**POST /data**
```typescript
// Headers: X-Api-Key
// Body:
{
  "deviceId": string,
  "temperature": number,
  "humidity": number,
  "co2": number
}
// Response: SensorData (201 Created)
```

### IAM認証への変更による影響

- API 契約自体は変わらない
- HTTP リクエストヘッダーのみ変更
  - 削除: `X-Api-Key`
  - 追加: `Authorization` (SigV4署名)

---

## 推奨事項

### 短期 (1-2周)

**選択肢B を推奨**: POST用に別Function URL (AWS_IAM) を作成
- 実装難度が低い
- GET データの保護は後続で検討可能
- Raspberry Pi のみに影響

### 中期 (1ヶ月)

**選択肢A への移行を検討**: CloudFront + IAM
- GET データも保護
- キャッシング により パフォーマンス向上
- ただし、AWS Documentation で互換性確認が必須

### 長期

- API Gateway への移行検討（より柔軟な認証・認可）
- AWS Secrets Manager での IAM 認証情報管理
- AWS IoT Device として Raspberry Pi を登録（一時的な認証情報を使用）

---

## 参考資料

### AWS 公式ドキュメント
- Lambda Function URL: https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html
- CloudFront OAC: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-origin.html
- SigV4 署名: https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html
- IAM Policy for Lambda: https://docs.aws.amazon.com/lambda/latest/dg/API_InvokeFunctionUrl.html

### boto3 リソース
- boto3 ドキュメント: https://boto3.amazonaws.com/v1/documentation/api/latest/index.html
- botocore.auth (SigV4): https://botocore.amazonaws.com/

---

## まとめ

| 側面 | 選択肢A | 選択肢B | 選択肢C |
|------|--------|--------|--------|
| セキュリティ | ★★★★★ | ★★★★☆ | ★★☆☆☆ |
| 実装難度 | ★★★☆☆ | ★★☆☆☆ | ☆☆☆☆☆ |
| コスト | ★★★☆☆ | ☆☆☆☆☆ | ☆☆☆☆☆ |
| パフォーマンス | ★★★★★ | ★★★☆☆ | ★★★☆☆ |

**推奨**: **選択肢B** を第一段階として実装し、後続で選択肢A への拡張を検討。
