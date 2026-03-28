# Infrastructure IaC Implementation Plan

**日付**: 2026-03-28
**ステータス**: Plan - Awaiting Approval
**前提**: [infrastructure-iac-research.md](./infrastructure-iac-research.md) のリサーチ完了

## 目標

Terraform + Terragruntを使用して、以下のインフラをIaC化する：

- Lambda (Poller) - Switchbot API定期ポーリング（Python）
- DynamoDB - センサーデータ蓄積
- Lambda (API) + Function URL - データ取得API（FastAPI + Lambda Web Adapter）
- S3 + CloudFront - フロントエンド配信

**主要な変更点**:
1. ~~API Gateway削除~~ → Lambda Function URL使用（シンプル化、コスト削減）
2. **FastAPI + Lambda Web Adapter採用** → ローカル開発容易、移植性向上
3. Lambda APIはDockerイメージでデプロイ（ECR経由）

## 前提条件

### ツール

- [x] Terraform 1.5+ インストール済み
- [x] Terragrunt 0.50+ インストール済み
- [x] AWS CLI v2 インストール済み
- [x] AWS アカウント
- [x] IAM ユーザー（AdministratorAccess権限）

### リポジトリ構造

```
smarthome-sensor-dashboard/
├── terraform/
│   ├── modules/           # 再利用可能なTerraformモジュール
│   │   ├── lambda/
│   │   ├── dynamodb/
│   │   └── cloudfront/
│   └── environments/      # 環境別設定
│       └── prod/
│           ├── terragrunt.hcl
│           ├── lambda-poller/
│           ├── dynamodb/
│           ├── lambda-api/
│           └── cloudfront/
├── lambda/               # Lambda関数コード
│   ├── poller/
│   │   ├── lambda_function.py
│   │   └── requirements.txt
│   └── api/
│       ├── Dockerfile
│       ├── main.py           # FastAPI アプリ
│       ├── requirements.txt
│       └── models/
│           └── sensor.py
└── src/                 # フロントエンドコード（既存）
```

## 実装ステップ

### Phase 1: プロジェクトセットアップ

#### ステップ1.1: ディレクトリ構造作成

```bash
mkdir -p terraform/{modules,environments/prod}
mkdir -p terraform/modules/{lambda,dynamodb,cloudfront}
mkdir -p terraform/environments/prod/{lambda-poller,dynamodb,lambda-api,cloudfront}
mkdir -p lambda/{poller,api}
```

**完了条件**: ディレクトリ構造が作成される

#### ステップ1.2: Terragrunt共通設定

`terraform/terragrunt.hcl` を作成:

```hcl
# リモートStateの設定
remote_state {
  backend = "s3"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite"
  }
  config = {
    bucket         = "smarthome-terraform-state-${get_aws_account_id()}"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = "ap-northeast-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}

# プロバイダー設定
generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite"
  contents  = <<EOF
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
EOF
}

# 共通変数
inputs = {
  aws_region = "ap-northeast-1"
  project_name = "smarthome-sensor"
  environment = "prod"
}
```

**完了条件**: Terragrunt共通設定ファイルが作成される

#### ステップ1.3: Terraform State用S3バケット作成

```bash
# 手動作成（初回のみ）
aws s3 mb s3://smarthome-terraform-state-$(aws sts get-caller-identity --query Account --output text)
aws s3api put-bucket-versioning --bucket smarthome-terraform-state-$(aws sts get-caller-identity --query Account --output text) --versioning-configuration Status=Enabled

# DynamoDBテーブル作成（ロック用）
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-northeast-1
```

**完了条件**: S3バケットとDynamoDBテーブルが作成される

### Phase 2: DynamoDBモジュール

#### ステップ2.1: DynamoDBモジュール作成

`terraform/modules/dynamodb/main.tf`:

```hcl
resource "aws_dynamodb_table" "sensor_data" {
  name           = "${var.project_name}-${var.environment}-sensor-data"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "deviceId"
  range_key      = "timestamp"

  attribute {
    name = "deviceId"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "N"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = var.enable_ttl
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-sensor-data"
    Project     = var.project_name
    Environment = var.environment
  }
}
```

`terraform/modules/dynamodb/variables.tf`:

```hcl
variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "enable_ttl" {
  type    = bool
  default = true
}

variable "ttl_days" {
  type    = number
  default = 30
}
```

`terraform/modules/dynamodb/outputs.tf`:

```hcl
output "table_name" {
  value = aws_dynamodb_table.sensor_data.name
}

output "table_arn" {
  value = aws_dynamodb_table.sensor_data.arn
}
```

**完了条件**: DynamoDBモジュールが作成される

#### ステップ2.2: DynamoDB環境設定

`terraform/environments/prod/dynamodb/terragrunt.hcl`:

```hcl
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/dynamodb"
}

inputs = {
  enable_ttl = true
  ttl_days   = 30
}
```

**完了条件**: DynamoDB環境設定が作成される

### Phase 3: Lambda Pollerモジュール

#### ステップ3.1: Lambda Poller コード作成

`lambda/poller/requirements.txt`:

```txt
boto3>=1.34.0
requests>=2.31.0
```

`lambda/poller/lambda_function.py`:

```python
import os
import time
import hashlib
import hmac
import base64
import uuid
import json
import requests
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')

def lambda_handler(event, context):
    """
    Switchbot APIからセンサーデータを取得し、DynamoDBに保存
    """
    token = os.environ['SWITCHBOT_TOKEN']
    secret = os.environ['SWITCHBOT_SECRET']
    device_id = os.environ['DEVICE_ID']
    table_name = os.environ['TABLE_NAME']

    # Switchbot API認証
    timestamp = str(int(time.time() * 1000))
    nonce = str(uuid.uuid4())
    string_to_sign = f"{token}{timestamp}{nonce}"

    sign = base64.b64encode(
        hmac.new(
            secret.encode('utf-8'),
            string_to_sign.encode('utf-8'),
            digestmod=hashlib.sha256
        ).digest()
    ).decode('utf-8')

    # Switchbot API呼び出し
    url = f"https://api.switch-bot.com/v1.1/devices/{device_id}/status"
    headers = {
        'Authorization': token,
        't': timestamp,
        'sign': sign,
        'nonce': nonce
    }

    response = requests.get(url, headers=headers)
    data = response.json()

    if data.get('statusCode') != 100:
        raise Exception(f"Switchbot API error: {data.get('message')}")

    body = data['body']

    # DynamoDBに保存
    table = dynamodb.Table(table_name)
    current_time = int(time.time() * 1000)
    expires_at = int(time.time()) + 30 * 24 * 60 * 60  # 30日後

    table.put_item(
        Item={
            'deviceId': device_id,
            'timestamp': current_time,
            'temperature': Decimal(str(body['temperature'])),
            'humidity': Decimal(str(body['humidity'])),
            'co2': body.get('CO2', 0),
            'expiresAt': expires_at
        }
    )

    return {
        'statusCode': 200,
        'body': json.dumps({'message': 'Data saved successfully'})
    }
```

**完了条件**: Lambda Pollerコードが作成される

#### ステップ3.2: Lambda Pollerモジュール作成

`terraform/modules/lambda/main.tf`:

```hcl
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/function.zip"
}

resource "aws_lambda_function" "this" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = "${var.project_name}-${var.environment}-${var.function_name}"
  role            = aws_iam_role.lambda_role.arn
  handler         = var.handler
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  runtime         = "nodejs20.x"
  timeout         = var.timeout
  memory_size     = var.memory_size

  environment {
    variables = var.environment_variables
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.function_name}"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-${var.environment}-${var.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  count = var.dynamodb_table_arn != "" ? 1 : 0
  role  = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = var.dynamodb_table_arn
    }]
  })
}

# EventBridge (CloudWatch Events) スケジュール
resource "aws_cloudwatch_event_rule" "schedule" {
  count               = var.schedule_expression != "" ? 1 : 0
  name                = "${var.project_name}-${var.environment}-${var.function_name}-schedule"
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "lambda" {
  count = var.schedule_expression != "" ? 1 : 0
  rule  = aws_cloudwatch_event_rule.schedule[0].name
  arn   = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  count         = var.schedule_expression != "" ? 1 : 0
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule[0].arn
}

# Lambda Function URL（API用）
resource "aws_lambda_function_url" "this" {
  count              = var.enable_function_url ? 1 : 0
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "NONE"  # 公開アクセス

  cors {
    allow_credentials = false
    allow_origins     = ["*"]
    allow_methods     = ["GET", "POST"]
    allow_headers     = ["content-type", "x-amz-date", "authorization"]
    max_age           = 86400
  }
}
```

`terraform/modules/lambda/variables.tf` に追加:

```hcl
variable "enable_function_url" {
  type    = bool
  default = false
}
```

`terraform/modules/lambda/outputs.tf` に追加:

```hcl
output "function_url" {
  value = var.enable_function_url ? aws_lambda_function_url.this[0].function_url : null
}
```

**完了条件**: Lambda Pollerモジュールが作成される

### Phase 4: Lambda APIモジュール

#### ステップ4.1: Lambda API コード作成（FastAPI + Lambda Web Adapter）

`lambda/api/requirements.txt`:

```txt
fastapi>=0.104.0
mangum>=0.17.0
boto3>=1.34.0
uvicorn>=0.24.0
```

`lambda/api/models/sensor.py`:

```python
from pydantic import BaseModel
from typing import List
from decimal import Decimal

class SensorData(BaseModel):
    deviceId: str
    timestamp: int
    temperature: float
    humidity: float
    co2: int

    class Config:
        # DecimalをfloatとしてシリアライズNumbering
        json_encoders = {
            Decimal: float
        }

class SensorDataResponse(BaseModel):
    data: List[SensorData]
    count: int
```

`lambda/api/main.py`:

```python
import os
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import boto3
from decimal import Decimal
from typing import List
import time

from models.sensor import SensorData, SensorDataResponse

app = FastAPI(
    title="Smarthome Sensor API",
    description="Switchbot温湿度CO2センサーデータAPI",
    version="1.0.0"
)

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

dynamodb = boto3.resource('dynamodb')

def decimal_to_float(obj):
    """Decimal を float に変換"""
    if isinstance(obj, Decimal):
        return float(obj)
    return obj

@app.get("/")
async def root():
    """ヘルスチェック"""
    return {"status": "ok", "message": "Smarthome Sensor API"}

@app.get("/data", response_model=SensorDataResponse)
async def get_sensor_data(
    hours: int = Query(default=24, ge=1, le=168, description="取得する時間範囲（時間）")
):
    """
    センサーデータを取得

    - **hours**: 取得する時間範囲（1-168時間、デフォルト24時間）
    """
    device_id = os.environ['DEVICE_ID']
    table_name = os.environ['TABLE_NAME']

    # 開始時刻の計算
    start_time = int((time.time() - hours * 3600) * 1000)

    # DynamoDBクエリ
    table = dynamodb.Table(table_name)
    response = table.query(
        KeyConditionExpression='deviceId = :deviceId AND #ts >= :startTime',
        ExpressionAttributeNames={
            '#ts': 'timestamp'
        },
        ExpressionAttributeValues={
            ':deviceId': device_id,
            ':startTime': start_time
        },
        ScanIndexForward=True  # 古い順
    )

    items = response.get('Items', [])

    # Decimalをfloatに変換
    converted_items = []
    for item in items:
        converted_item = {
            'deviceId': item['deviceId'],
            'timestamp': item['timestamp'],
            'temperature': decimal_to_float(item['temperature']),
            'humidity': decimal_to_float(item['humidity']),
            'co2': item['co2']
        }
        converted_items.append(converted_item)

    return SensorDataResponse(
        data=converted_items,
        count=len(converted_items)
    )

@app.get("/latest")
async def get_latest_data():
    """最新のセンサーデータを1件取得"""
    device_id = os.environ['DEVICE_ID']
    table_name = os.environ['TABLE_NAME']

    table = dynamodb.Table(table_name)
    response = table.query(
        KeyConditionExpression='deviceId = :deviceId',
        ExpressionAttributeValues={
            ':deviceId': device_id
        },
        ScanIndexForward=False,  # 新しい順
        Limit=1
    )

    items = response.get('Items', [])
    if not items:
        return JSONResponse(status_code=404, content={"message": "No data found"})

    item = items[0]
    return {
        'deviceId': item['deviceId'],
        'timestamp': item['timestamp'],
        'temperature': decimal_to_float(item['temperature']),
        'humidity': decimal_to_float(item['humidity']),
        'co2': item['co2']
    }

# Lambda Web Adapter用（ローカル実行時はuvicornを使用）
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

`lambda/api/Dockerfile`:

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

# Lambda Web Adapterをインストール
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.7.1 /lambda-adapter /opt/extensions/lambda-adapter

# 作業ディレクトリ
WORKDIR ${LAMBDA_TASK_ROOT}

# 依存関係をインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコードをコピー
COPY . .

# 環境変数設定
ENV PORT=8000
ENV AWS_LWA_INVOKE_MODE=response_stream

# FastAPIアプリを起動するコマンド
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**完了条件**: FastAPI + Lambda Web Adapter コードが作成される

### Phase 5: Lambda API Function URL設定

#### ステップ5.1: Lambda APIをECRにプッシュ

Lambda APIはDockerイメージとしてビルドし、ECRにプッシュします。

```bash
# ECRリポジトリ作成
aws ecr create-repository --repository-name smarthome-sensor-api --region ap-northeast-1

# Dockerイメージをビルド
cd lambda/api
docker build --platform linux/amd64 -t smarthome-sensor-api:latest .

# ECRにプッシュ
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com

docker tag smarthome-sensor-api:latest ${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest
```

#### ステップ5.2: Terraform Lambda APIモジュール設定

`terraform/modules/lambda-container/main.tf`（新規作成）:

```hcl
resource "aws_lambda_function" "this" {
  function_name = "${var.project_name}-${var.environment}-${var.function_name}"
  role          = aws_iam_role.lambda_role.arn
  package_type  = "Image"
  image_uri     = var.image_uri
  timeout       = var.timeout
  memory_size   = var.memory_size

  environment {
    variables = var.environment_variables
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.function_name}"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-${var.environment}-${var.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  count = var.dynamodb_table_arn != "" ? 1 : 0
  role  = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = var.dynamodb_table_arn
    }]
  })
}

# Lambda Function URL
resource "aws_lambda_function_url" "this" {
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "NONE"  # 公開アクセス

  cors {
    allow_credentials = false
    allow_origins     = ["*"]
    allow_methods     = ["*"]
    allow_headers     = ["*"]
    max_age           = 86400
  }
}
```

`terraform/environments/prod/lambda-api/terragrunt.hcl`:

```hcl
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/lambda-container"
}

dependency "dynamodb" {
  config_path = "../dynamodb"
}

inputs = {
  function_name = "api"
  image_uri     = "${get_env("AWS_ACCOUNT_ID")}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest"
  timeout       = 30
  memory_size   = 512  # FastAPIは少し多めに

  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn

  environment_variables = {
    TABLE_NAME = dependency.dynamodb.outputs.table_name
    DEVICE_ID  = get_env("SWITCHBOT_DEVICE_ID")
  }
}
```

**完了条件**: Lambda Function URLが有効化され、HTTPSエンドポイントが生成される

### Phase 6: S3 + CloudFrontモジュール

（省略 - 詳細はステップごとに実装）

### Phase 7: デプロイとテスト

#### ステップ7.1: Terragrunt初期化

```bash
cd terraform/environments/prod/dynamodb
terragrunt init
terragrunt plan
terragrunt apply
```

#### ステップ7.2: 各コンポーネントのデプロイ

```bash
# Lambda Poller
cd ../lambda-poller
terragrunt init
terragrunt apply

# Lambda API
cd ../lambda-api
terragrunt apply

# API Gateway
cd ../api-gateway
terragrunt apply

# CloudFront
cd ../cloudfront
terragrunt apply
```

**完了条件**: すべてのリソースがデプロイされる

#### ステップ7.3: 動作確認

```bash
# Lambda Poller手動実行
aws lambda invoke --function-name smarthome-sensor-prod-poller response.json

# Lambda Function URLテスト
FUNCTION_URL=$(aws lambda get-function-url-config --function-name smarthome-sensor-prod-api --query 'FunctionUrl' --output text)
curl "${FUNCTION_URL}?hours=24"
```

**完了条件**: すべてのコンポーネントが正常に動作する

## 成功基準

- [ ] Terraformコードが適切に構造化されている
- [ ] TerragruntでリモートStateが管理されている
- [ ] Lambda Pollerが1分間隔で正常に実行される
- [ ] DynamoDBにデータが蓄積される
- [ ] Lambda Function URLからデータ取得できる
- [ ] FastAPI自動ドキュメント（/docs）にアクセスできる
- [ ] ローカルでFastAPIアプリが実行できる（uvicorn）
- [ ] フロントエンドがCloudFrontで配信される
- [ ] すべてのリソースがタグ付けされている
- [ ] IAMロールが最小権限の原則に従っている

## リスクと緩和策

### リスク1: Terraform State破損
- **緩和**: S3バージョニング有効化、定期バックアップ

### リスク2: Lambda コールドスタート
- **緩和**: Provisioned Concurrency（Phase 2）

### リスク3: Lambda Function URL公開アクセス
- **緩和**: Phase 2で認証追加、現状はデータのみで機密情報なし

## 解決済みの設計判断

1. ~~API Gateway必要か？~~ → **解決: Lambda Function URL使用**
2. ~~1つのLambda vs 2つのLambda?~~ → **解決: 2つのLambda（責任分離）**
3. ~~Lambda APIの実装方法？~~ → **解決: FastAPI + Lambda Web Adapter**
4. ~~Lambda APIのランタイム？~~ → **解決: Pythonコンテナイメージ（ECR）**

## 未解決の質問

1. DynamoDB TTLは30日で良いか？ → **デフォルト30日で進めます（変更可能）**
2. Lambda Pollerのメモリサイズは？ → **デフォルト128MBで進めます（調整可能）**
3. Lambda APIのメモリサイズは？ → **512MB（FastAPI用、調整可能）**
4. CloudFrontのキャッシュTTLは？ → **デフォルト値で進めます（変更可能）**
5. モニタリング・アラートはどこまで設定するか？ → **Phase 2で実装**

## 次のステップ

1. **レビュー**: この計画をレビューし、フィードバックをもらう
2. **承認**: 計画が承認されたら実装開始
3. **実装**: 各ステップを順番に実装
4. **テスト**: 各コンポーネントの動作確認
5. **ドキュメント**: インフラ構成図の更新

---

**前**: [infrastructure-iac-research.md](./infrastructure-iac-research.md)
**次**: 実装開始（承認後）
