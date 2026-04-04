# Lambda Function URL IAM 認証移行リサーチ

**完了: 2026-04-04 — PR #20 でマージ済み**

## タスク理解

**要望**: Lambda Function URL を `authorization_type = "NONE"` (パブリック) から `authorization_type = "AWS_IAM"` に移行し、リクエストに対して IAM 認証を導入する。

**背景**: 
- 現在は POST /data のみ X-Api-Key ヘッダーで認証
- GET /data, /latest はパブリックアクセス
- フロントエンドとRaspberry Piの両方が同じFunction URLにアクセス
- セキュリティを向上させるためにIAM認証へ移行したい

**成功基準**:
- [x] Function URL へのアクセスが IAM 認証で保護される
- [x] フロントエンド (ブラウザ) がクライアント証明書なしでアクセス可能
- [x] Raspberry Pi が SigV4 署名付きリクエストで認証
- [x] 既存の機能が正常に動作

---

## 現状分析（実装時点での状態）

### Lambda Function URL設定

**ファイル**: `terraform/modules/lambda-container/main.tf`
- `authorization_type = "NONE"` (パブリック)
- CORS: `allow_origins = ["*"]`
- `create_function_url = true` (デフォルト)

### Lambda の環境変数（prod設定）

**ファイル**: `terraform/environments/prod/lambda-api/terragrunt.hcl`
- `DEVICE_ID`: GET /data, /latest の照会対象
- `TABLE_NAME`: DynamoDB テーブル名
- `API_KEY`: POST /data 用 X-Api-Key 値（実装後削除）

### バックエンド認証ロジック

**ファイル**: `lambda/api/main.py`
- `_verify_api_key()`: POST /data のみで X-Api-Key ヘッダーを検証（実装後削除）
- 他のエンドポイント (GET /data, /latest, /health) は無認証でアクセス可能
- タイムスタンプはサーバー側で生成（POST時）

---

## アーキテクチャ選択肢の詳細

### 選択肢 A: CloudFront OAC + AWS_IAM

**概要**: CloudFront を Lambda Function URL の前に配置し、OAC + SigV4 署名でセキュアなアクセス。

**複雑さ**: 中程度

**メリット**:
- セキュリティ: IAM ベースの認証で、APIキーをコード・環境変数から排除
- キャッシング: CloudFront でAPI応答をキャッシュ可能（GET系）

**デメリット**:
- 実装複雑性が高い
- コスト増加: CloudFront の料金が発生

---

### 選択肢 B: POST用に別Function URL (AWS_IAM) ← 採用

**概要**: GET用の公開URLは維持し、POST用のみ新規 AWS_IAM Function URL を作成。

**複雑さ**: 低程度（実装済み）

**メリット**:
- 段階的: GET 系はそのまま、POST のみ保護
- シンプル: CloudFront 設定の変更不要
- コスト効率的: CloudFront の料金不要

**デメリット**:
- GET /data, /latest はパブリックのままで、機密データ漏洩の可能性
- 2つの Function URL を管理

---

### 選択肢 C: X-Api-Key 方式の継続

**概要**: 現在の X-Api-Key ベースの認証を継続し、IAM認証は導入しない。

**決定**: 不採用

---

## Raspberry Pi IAM認証の実装方法

### SigV4署名の実装

**採用方法**: `botocore.auth.SigV4Auth` を直接使用

```python
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

# AWS認証情報を environment variables から取得
access_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
credentials = Credentials(access_key, secret_key)

# SigV4署名の準備
url = "https://xxxxx.lambda-url.ap-northeast-1.on.aws/data"
request = AWSRequest(method="POST", url=url, data=json.dumps(payload))

# SigV4署名を追加
SigV4Auth(credentials, 'lambda', 'ap-northeast-1').add_auth(request)
signed_headers = dict(request.headers)

# httpx で署名済みヘッダーを使用
response = await http_client.post(url, content=payload, headers=signed_headers)
```

### IAM User の設定

**ポリシー**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunctionUrl",
      "Resource": "arn:aws:lambda:ap-northeast-1:ACCOUNT_ID:function:smarthome-prod-api:url",
      "Condition": {
        "StringEquals": {
          "lambda:FunctionUrlAuthType": "AWS_IAM"
        }
      }
    }
  ]
}
```

---

## リスクと制約（実装完了時の状態）

### セキュリティ上の考慮

| 項目 | 選択肢A | 選択肢B（採用） | 選択肢C |
|------|--------|--------|--------|
| GET データ保護 | ○ (IAM) | ✗ (パブリック) | ✗ (APIキー) |
| POST 認証 | ○ (IAM) | ○ (IAM) | ○ (APIキー) |
| APIキー不要 | ○ | ○ | ✗ |
| キャッシング | ○ | ✗ | ✗ |

### 技術的リスク（実装後の状態）

**リスク**: SigV4 署名で使用する `botocore.Credentials` を直接生成
- **影響**: 低（botocore の Credentials API は安定している）
- **対策**: 実装済み。運用を通じて検証

**リスク**: IAM アクセスキーの漏洩
- **影響**: 高
- **対策**: 定期的なキーローテーション（3ヶ月ごと推奨）

### 制約

**移行順序**: Terraform Apply → Lambda デプロイ → Raspberry Pi 設定変更、の順序を厳守（実装済み）

---

## 参考資料

### AWS 公式ドキュメント
- Lambda Function URL: https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html
- SigV4 署名: https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html
- IAM Policy for Lambda: https://docs.aws.amazon.com/lambda/latest/dg/API_InvokeFunctionUrl.html

### boto3 リソース
- botocore.auth (SigV4): https://botocore.amazonaws.com/

---

## 実装結論

**選択肢B（POST用に別Function URL）を採用し、PR #20 で実装完了**

- Raspberry Pi 専用の IAM 認証 Function URL を作成
- SigV4 署名で Raspberry Pi を認証
- GET エンドポイントはパブリック URL のまま維持
- X-Api-Key からIAM 認証へ完全移行
