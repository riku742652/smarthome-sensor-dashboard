# BLE センサーデータを Lambda API へ送信する実装リサーチ

**リサーチ日**: 2026-04-04  
**リサーチャー**: harness-researcher  
**対象タスク**: SwitchBot CO2 センサーの Raspberry Pi BLE スキャン → Lambda API 統合

---

## 1. タスク理解

### 背景
- 当初のアーキテクチャ：Lambda Poller が SwitchBot クラウド API をポーリング
- 問題：SwitchBot Hub Mini がないため、クラウド API でデバイスデータ取得不可
- 代替案：Raspberry Pi が BLE アドバタイズメントを直接スキャンし、HTTP POST で Lambda API へ送信

### 新データフロー
```
SwitchBot CO2 センサー
  ↓ (BLE アドバタイズメント)
Raspberry Pi (BLE スキャン + パーシング)
  ↓ (HTTP POST)
Lambda API (`lambda/api/main.py`)
  ↓ (put_item)
DynamoDB (既存スキーマ)
```

### 成功基準
- Lambda API に POST エンドポイント（`POST /data`）が実装される
- Pydantic で受け取るモデルが定義される
- DynamoDB に `put_item` する ロジックが追加される
- テストが追加される
- Terraform の IAM ポリシーが PutItem を許可している

---

## 2. 現状分析

### 2.1 既存 Lambda API の構造

**ファイル**: `/Users/riku/Work/smarthome/lambda/api/main.py`

**現在のエンドポイント**（すべて読み取り専用）:
- `GET /` - ヘルスチェック (status="ok")
- `GET /health` - ヘルスチェックエイリアス
- `GET /data?hours=24` - 指定時間範囲のセンサーデータ（デフォルト24時間、最大168時間）
- `GET /latest` - 最新のセンサーデータ1件

**重要な観察**:
- POST エンドポイント **なし** （Grep 確認済み）
- すべてのエンドポイントで DynamoDB Query を実行（読み取り専用）
- データは毎回新規取得で、キャッシング機構なし

### 2.2 DynamoDB スキーマ

**テーブル名**: 環境変数 `TABLE_NAME` から取得（prod では `smarthome-prod-sensor-data`）  
**パーティションキー**: `deviceId` (String)  
**ソートキー**: `timestamp` (Number, ミリ秒単位)

**属性**:
```python
{
    'deviceId': str,      # パーティションキー（デバイス ID）
    'timestamp': int,     # ソートキー（Unix timestamp ms）
    'temperature': Decimal,  # 温度 (°C)
    'humidity': Decimal,     # 湿度 (%)
    'co2': int,          # CO2 (ppm)
    'expiresAt': int     # TTL 属性（30日後、Unix timestamp s）
}
```

**ファイル**: `lambda/poller/lambda_function.py` (L212-230, `save_to_dynamodb`)  
Poller が書き込む際の参考実装：
```python
item = {
    'deviceId': device_id,
    'timestamp': current_time,  # int(time.time() * 1000)
    'temperature': Decimal(str(sensor_data['temperature'])),
    'humidity': Decimal(str(sensor_data['humidity'])),
    'co2': int(sensor_data['CO2']),
    'expiresAt': expires_at  # int(time.time()) + 30 * 24 * 60 * 60
}
table.put_item(Item=item)
```

### 2.3 Pydantic モデルの現状

**ファイル**: `lambda/api/models/sensor.py`

```python
class SensorData(BaseModel):
    deviceId: str
    timestamp: int
    temperature: float
    humidity: float
    co2: int

class SensorDataResponse(BaseModel):
    data: List[SensorData]
    count: int

class HealthCheckResponse(BaseModel):
    status: str
    message: str
```

**観察**:
- `SensorData` は既に定義済み（GET `/latest` や `/data` のレスポンスで使用）
- `expiresAt` は含まれていない（クライアント側には不要、サーバー側で自動生成）
- Pydantic v2（`ConfigDict` 使用）

### 2.4 API テストの現状

**ファイル**: `lambda/api/tests/test_main.py`  
**テスト数**: 23 個のテストケース  
**カバレッジ**: 93%

**テストの構成**:
- `TestHealthEndpoints`: GET / と /health のテスト
- `TestDataEndpoint`: GET /data のテスト（複数件・空結果・エラーパス）
- `TestLatestEndpoint`: GET /latest のテスト
- `TestMissingEnvVars`: 環境変数欠落時のエラーハンドリング

**重要**: POST エンドポイントのテストは一切ない（実装が無いため）

### 2.5 Terraform IAM ポリシーの現状

**ファイル**: `terraform/modules/lambda-container/main.tf` (L93-111)

```hcl
resource "aws_iam_role_policy" "lambda_dynamodb" {
  count = var.dynamodb_table_arn != "" ? 1 : 0
  role  = aws_iam_role.lambda_role.id
  name  = "dynamodb-access"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",      # ✅ PutItem 既に含まれている
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = var.dynamodb_table_arn
    }]
  })
}
```

**重要な観察**:
- `dynamodb:PutItem` **既に許可済み** (L103)
- API は現在使用していないが、ポリシーには含まれている（Poller 需要による）
- 注記（L203）: "Poller には不要が、モジュール全体で共通"

**API Terraform 設定**:  
**ファイル**: `terraform/environments/prod/lambda-api/terragrunt.hcl`
- `dynamodb_table_arn = dependency.dynamodb.outputs.table_arn`で依存を解決
- DynamoDB ポリシーは自動的に適用される

### 2.6 既存テスト実行方法

**ファイル**: `lambda/api/pyproject.toml`

```toml
[project]
name = "lambda-api"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.104.0",
    "mangum>=0.17.0",
    "boto3>=1.34.0",
    "uvicorn>=0.24.0",
    "pydantic>=2.0.0",
]

[dependency-groups]
dev = [
    "pytest>=7.0",
    "pytest-mock>=3.0",
    "httpx>=0.24.0",
]
```

**テスト実行方法**:
```bash
cd lambda/api
uv sync           # 環境構築
uv run pytest tests/  # テスト実行
```

### 2.7 構造化ログの慣例

**ファイル**: `lambda/api/main.py` (L18-35)

```python
class StructuredLogger:
    def _log(self, level: str, message: str, **kwargs):
        record = {"level": level, "message": message, **kwargs}
        print(json.dumps(record))  # CloudWatch にキャプチャ

logger = StructuredLogger("api")
logger.info("message", key1=value1, key2=value2)
```

API と Poller で同じパターンを使用。Raspberry Pi 送信データはこのログに記録すべき。

---

## 3. 技術コンテキスト

### 3.1 BLE パーシングロジック（ユーザー提供）

CO2 センサーから BLE アドバタイズメントをパースするロジックは提供済み：

```python
def parse_switchbot_co2_ble(manufacturer_data: bytes) -> dict:
    """
    BLE manufacturer_data からセンサー値を抽出
    Returns: {"temperature": float, "humidity": int, "co2": int}
    """
    if len(manufacturer_data) < 15:
        return {}
    temp_decimal = manufacturer_data[8] & 0x0F
    temp_integer = manufacturer_data[9] & 0x7F
    is_positive = (manufacturer_data[9] & 0x80) > 0
    temperature = temp_integer + (temp_decimal * 0.1)
    if not is_positive:
        temperature = -temperature
    humidity = manufacturer_data[10] & 0x7F
    co2 = int.from_bytes(manufacturer_data[13:15], byteorder='big')
    return {
        "temperature": round(temperature, 1),
        "humidity": humidity,
        "co2": co2
    }
```

**重要**: このロジックは Raspberry Pi の Python コードで使用される（本 API とは別）。API は Raspberry Pi から受け取ったデータをそのまま DynamoDB に保存するだけ。

### 3.2 HTTP POST リクエストスキーマ（想定）

Raspberry Pi から API が受け取るデータ構造は未定義だが、既存の `SensorData` モデルに合わせるべき：

```json
{
    "deviceId": "switchbot-co2-sensor-uuid",
    "temperature": 22.5,
    "humidity": 45,
    "co2": 800
}
```

**timestamp と expiresAt は API 側で自動生成**（Poller の `save_to_dynamodb` と同じ実装）

### 3.3 DynamoDB write スループット

現在：`billing_mode = "PAY_PER_REQUEST"` (オンデマンド)  
→ 書き込み スケーリング自動。追加のスロットリング対策不要。

---

## 4. 制約事項と考慮点

### 4.1 パフォーマンス

- **レイテンシ**: 標準的な API レスポンス < 1s 期待（FastAPI + boto3 put_item）
- **スループット**: Raspberry Pi の送信頻度（TBD）によるが、オンデマンド DynamoDB なら問題なし
- **Lambda タイムアウト**: API は現在 30s（十分な余裕）

### 4.2 セキュリティ

**CORS**: 現在 `allow_origins=["*"]`（すべてのオリジンを許可）  
→ Raspberry Pi からの POST は許可される。ただし今後 localhost のみに制限することも検討可

**認証**: 現在なし。Raspberry Pi のリクエストに何らかのトークンを含めるか検討（本タスクのスコープ外の可能性）

### 4.3 バリデーション

**ARCHITECTURE.md の原則**:
> 境界でのデータ検証: すべての外部データは境界で検証スキーマを通す

Raspberry Pi からの POST データは Pydantic で検証する必要あり。

### 4.4 エラーハンドリング

既存 API のエラーハンドリングパターン：
- DynamoDB エラー → 500 + エラーメッセージ
- 環境変数欠落 → 500 + "configuration error"
- バリデーション失敗 → 422 (FastAPI の自動レスポンス)

POST エンドポイントも同じパターンに従うべき。

---

## 5. 参考実装パターン

### 5.1 Poller の save_to_dynamodb ロジック

**ファイル**: `lambda/poller/lambda_function.py` (L212-230)

```python
def save_to_dynamodb(table_name: str, device_id: str, sensor_data: dict):
    table = dynamodb.Table(table_name)
    current_time = int(time.time() * 1000)
    expires_at = int(time.time()) + 30 * 24 * 60 * 60  # 30日後

    item = {
        'deviceId': device_id,
        'timestamp': current_time,
        'temperature': Decimal(str(sensor_data['temperature'])),
        'humidity': Decimal(str(sensor_data['humidity'])),
        'co2': int(sensor_data['CO2']),
        'expiresAt': expires_at
    }

    table.put_item(Item=item)
```

**API の POST エンドポイントはこれと同じロジック**（ただし `sensor_data` は Pydantic 経由）

### 5.2 GET /latest のデータ取得パターン

**ファイル**: `lambda/api/main.py` (L186-234)

```python
@app.get("/latest", response_model=SensorData)
async def get_latest_data():
    device_id, table_name = _get_required_env_vars()
    logger.info("Fetching latest sensor data", device_id=device_id)
    
    try:
        table = dynamodb.Table(table_name)
        response = table.query(...)
        # Decimal 変換 → SensorData モデルでシリアライズ
        return SensorData(**converted_item)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("DynamoDB query failed", error=str(e), endpoint="/latest")
        raise HTTPException(status_code=500, detail=...)
```

**POST エンドポイントは**:
- 環境変数を取得
- リクエスト JSON を Pydantic で検証
- DynamoDB に put_item
- 200 または 40x を返す

---

## 6. リスク・課題・判断が必要な項目

### 6.1 POST リクエストスキーマの確定（QUESTION）

`timestamp` をクライアント（Raspberry Pi）が送信するか、サーバー側で生成するか？

**選択肢**:
1. **Raspberry Pi が送信** (推奨): `timestamp` を Pydantic で受け取る
   - Pros: データ精度（BLE スキャン時刻を正確に記録）
   - Cons: クライアント側で時刻同期が必要
   
2. **サーバー側で生成**: `timestamp` を Pydantic で受け取らない
   - Pros: サーバー側で一元管理（シンプル）
   - Cons: BLE スキャン時刻と DynamoDB 保存時刻にズレ（HTTP レイテンシ分）

**推奨**: オプションパラメータで対応
- デフォルトはサーバー側生成
- クライアントが `timestamp` を明示する場合は採用

### 6.2 deviceId の取得方法（QUESTION）

現在、API は環境変数 `DEVICE_ID` から単一デバイスを読む。複数デバイス対応は？

**選択肢**:
1. **リクエストから取得** (推奨): `POST /data` の JSON に `deviceId` を含める
   - Pros: 複数デバイス対応が容易（Raspberry Pi に複数センサーが接続された場合）
   - Cons: リクエストペイロードが増える
   
2. **環境変数のみ**: 固定 `DEVICE_ID`
   - Pros: Raspberry Pi 側がシンプル（deviceId を送信不要）
   - Cons: センサー追加時に Terraform 変更が必要

**推奨**: リクエストから取得（将来の拡張を考慮）

### 6.3 POST レスポンス形式（決定済み）

既存の GET エンドポイントと統一を考慮：

```python
@app.post("/data", response_model=SensorData, status_code=201)
async def create_sensor_data(data: SensorDataRequest):
    """
    新規センサーデータを DynamoDB に保存
    """
```

- **Status Code**: `201 Created`（リソース作成）
- **Response Body**: 保存されたデータ（SensorData モデル）
- **エラー時**: `400`, `404`, `500`

### 6.4 バリデーションエラーの詳細度（QUESTION）

Pydantic が `temperature: "invalid"` のような不正値をどう扱うか：

```python
class SensorDataRequest(BaseModel):
    deviceId: str
    temperature: float  # float へのキャスト試行
    humidity: int
    co2: int
```

FastAPI の `response_model=SensorData` で自動検証される。型チェック厳密。

**リスク**: Raspberry Pi が JSON 構造を誤ると 422 エラー。エラーハンドリングが必要。

---

## 7. 実装時の参考ファイル

### 必須チェック
- [ ] `SensorData` モデルの確認: `lambda/api/models/sensor.py`
- [ ] 既存 POST テストの有無: `lambda/api/tests/test_main.py` (確認済み：ない)
- [ ] DynamoDB スキーマ（TTL・expiresAt）: `terraform/modules/dynamodb/main.tf` (確認済み)
- [ ] IAM PutItem 権限: `terraform/modules/lambda-container/main.tf` (確認済み：既に許可)

### リファレンス実装
1. **Poller の save_to_dynamodb**: `lambda/poller/lambda_function.py` L212-230
2. **API の GET /latest**: `lambda/api/main.py` L186-234
3. **API テストの命名・構成**: `lambda/api/tests/test_main.py`
4. **Terraform IAM ポリシー**: `terraform/modules/lambda-container/main.tf` L93-111

### テスト実行の環境変数
```bash
cd lambda/api
export DEVICE_ID=test-device
export TABLE_NAME=test-table
uv run pytest tests/
```

---

## 8. アーキテクチャドキュメントの現状

**ファイル**: `ARCHITECTURE.md` (L190-241)

### Poller Lambda の記述
- L192-201: Poller の役割・実装ハイライト（指数バックオフ・検証・構造化ログ）
- **Poller コンテナ化計画**: `docs/exec-plans/active/poller-containerize-plan.md` が進行中

### API Lambda の記述
- L203-218: API の役割・4エンドポイント（GET / , /health, /data, /latest）
- **注記**: POST エンドポイントは未記載。実装後に追加必要。

### 変更が必要か
- [ ] POST `/data` エンドポイント追加に伴い、ARCHITECTURE.md の「API Lambda」セクションを更新

---

## 9. 推奨実装戦略（高レベル）

### Phase 1: API に POST エンドポイントを追加
1. Pydantic モデルを拡張（`SensorDataRequest`）
2. POST エンドポイント `@app.post("/data")` を実装
3. DynamoDB `put_item` ロジック（Poller の参考実装から）
4. テストを追加（12-15 個のテストケース）
5. 既存テスト（GET エンドポイント）が影響を受けないことを確認

### Phase 2: Terraform 検証
1. IAM ポリシー確認（PutItem 既許可）
2. 環境変数設定確認（DEVICE_ID, TABLE_NAME）
3. 本体は変更不要（モジュールレベルで対応済み）

### Phase 3: ドキュメント更新
1. ARCHITECTURE.md に POST エンドポイント追加
2. API テストカバレッジを 93% → 目標値に維持

---

## 10. 既知制約

### 方針転換による影響
- **Poller コンテナ化計画**: 現在進行中（`poller-containerize-plan.md`）
  - ただし、Poller の削除・スコープ縮小はなし。API 拡張と平行可能。
  
- **Poller から API への移行ではない**
  - Poller：SwitchBot クラウド API → DynamoDB（現在も続行）
  - API：Raspberry Pi BLE → DynamoDB（新規追加）
  - 2つのデータソースが並行

### Lambda Function URL
- API には既に Function URL が有効（`create_function_url = true` in Terraform）
- Raspberry Pi の HTTP POST リクエスト先は同じ URL

---

## 11. 参考資料

- AGENTS.md: リサーチプロセス・exec-plan フォーマット
- ARCHITECTURE.md: システム全体・Lambda アーキテクチャ詳細
- RELIABILITY.md: パフォーマンス・スケーラビリティ要件
- SECURITY.md: データバリデーション・エラーハンドリング
- `lambda/api/main.py`: FastAPI 実装参考
- `lambda/poller/lambda_function.py`: DynamoDB 書き込み参考
- `terraform/modules/lambda-container/main.tf`: IAM ポリシー確認

---

## サマリー

### 主な発見
1. **POST エンドポイントなし**: API は現在読み取り専用。POST を実装する必要がある。
2. **DynamoDB スキーマ確定**: deviceId + timestamp（ミリ秒） + temperature/humidity/co2 + expiresAt（TTL）
3. **IAM PutItem 既許可**: Terraform レベルでは既に対応済み（Poller 需要により）
4. **実装参考あり**: Poller の `save_to_dynamodb` と API の `GET /latest` が参考パターン
5. **テストパターン確立**: 既存 23 個のテストケースに POST テストを追加（12-15 ケース予想）

### 重要な判断点
- `timestamp` をクライアント送信か、サーバー側で生成か（推奨：両対応）
- `deviceId` をリクエストから取得か、環境変数のみか（推奨：リクエストから）

### 実装レディネス
- ✅ DynamoDB スキーマ確定
- ✅ Pydantic モデル（基部）確定
- ✅ テストパターン確立
- ✅ IAM ポリシー完備
- ❓ POST リクエストスキーマ詳細（判断待ち）
- ❓ DEVICE_ID スコープ（複数デバイス対応の有無）
