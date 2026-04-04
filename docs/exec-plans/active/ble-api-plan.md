# BLE センサーデータ収集システム 実装計画

**作成日**: 2026-04-04
**リサーチ文書**: `docs/exec-plans/active/ble-api-research.md`
**ステータス**: 実装完了 (2026-04-04)

---

## Goal and Success Criteria

**Goal**: SwitchBot CO2 センサーの BLE データを Raspberry Pi でスキャンし、Lambda API（Function URL）経由で DynamoDB に登録するシステムを実装する。Lambda API に `POST /data` エンドポイントを追加する。Raspberry Pi 側のスクリプトは関心の分離のため別リポジトリで管理する。

**新アーキテクチャ**:
```
SwitchBot CO2センサー --BLE--> Raspberry Pi --HTTP POST--> Lambda API (Function URL) --> DynamoDB
```

**Success Criteria**:
- [x] `lambda/api/models/sensor.py` の `SensorData.humidity` が `float → int` に修正される
- [x] `lambda/api/models/sensor.py` に `SensorDataCreate` モデルが追加される（`humidity: int`）
- [x] `lambda/api/main.py` に `POST /data` エンドポイントが実装され、201 を返す
- [x] `POST /data` が `timestamp`（ミリ秒）と `expiresAt`（30日後 UNIX 秒）をサーバー側で生成する
- [x] `POST /data` が DynamoDB に `put_item` し、保存データを `SensorData` 形式で返す
- [x] `lambda/api/tests/test_main.py` に POST エンドポイント用テストが追加される（12 件以上）
- [x] 既存の 23 テストが引き続き全て通過する
- [x] `docs/exec-plans/active/poller-containerize-plan.md` が `docs/exec-plans/archived/` に移動し、冒頭に方針転換の注記が付く
- [x] `ARCHITECTURE.md` の API Lambda セクションに `POST /data` エンドポイントと BLE アーキテクチャが追記される
- [x] `ARCHITECTURE.md` に Raspberry Pi スクリプトが別リポジトリで管理される旨が記載される

---

## Architectural Changes

### 新規作成ファイル
- `docs/exec-plans/archived/poller-containerize-plan.md` — アーカイブ済み（poller-containerize-plan.md を移動）

### 変更ファイル
- `lambda/api/models/sensor.py` — `SensorData.humidity: float → int` 修正、`SensorDataCreate` Pydantic モデルを追加
- `lambda/api/main.py` — `POST /data` エンドポイントを追加
- `lambda/api/tests/test_main.py` — POST エンドポイントのテストを追加（12 件以上）
- `ARCHITECTURE.md` — `POST /data` エンドポイント・BLE アーキテクチャ・別リポジトリ情報を追記
- `docs/exec-plans/active/poller-containerize-plan.md` — `archived/` に移動（削除ではなく移動）

### 削除ファイル
- なし（`lambda/poller/` は参照コードとして保持）

### 依存関係
- **追加なし**（Lambda API 側: boto3, pydantic, fastapi は既存）

### Raspberry Pi スクリプトの扱い
- このリポジトリには含めない（関心の分離）
- 別リポジトリ（例: `smarthome-pi-client`）で管理する
- Lambda API の `POST /data` スキーマが Raspberry Pi スクリプトとの契約となる

### Terraform
- **変更なし**（`dynamodb:PutItem` は既に IAM ポリシーに含まれている）

---

## Implementation Steps

### Step 1: `SensorData.humidity` の型修正と `SensorDataCreate` モデルの追加

**目的**: `humidity` の正しい型（`int`）に修正し、`POST /data` エンドポイントのリクエストボディ型を定義する。

**対象ファイル**:
- `lambda/api/models/sensor.py`（変更）

**実装内容**:

#### 1-a. `SensorData.humidity` を `float → int` に修正する

```python
class SensorData(BaseModel):
    """センサーデータモデル"""
    model_config = ConfigDict(populate_by_name=True)

    deviceId: str = Field(..., description="Device ID")
    timestamp: int = Field(..., description="Unix timestamp in milliseconds")
    temperature: float = Field(..., description="Temperature in Celsius")
    humidity: int = Field(..., description="Humidity percentage")   # float → int
    co2: int = Field(..., description="CO2 concentration in ppm")
```

**型根拠**:
- `temperature`: BLE パーシングで `temp_integer + (temp_decimal * 0.1)` → 小数点1桁の `float`（例: 22.5）
- `humidity`: BLE パーシングで `manufacturer_data[10] & 0x7F` → ビット演算の結果は常に `int`（例: 45）
- `co2`: BLE パーシングで `int.from_bytes(...)` → 常に `int`（例: 800）

#### 1-b. `SensorDataCreate` モデルを末尾に追加する

```python
class SensorDataCreate(BaseModel):
    """POST /data のリクエストボディモデル（Raspberry Pi からの入力）"""
    model_config = ConfigDict(populate_by_name=True)

    deviceId: str = Field(..., description="デバイス ID")
    temperature: float = Field(..., description="温度 (°C)")
    humidity: int = Field(..., description="湿度 (%)")
    co2: int = Field(..., description="CO2 濃度 (ppm)")
```

**設計判断**:
- `timestamp` はクライアント（Raspberry Pi）からは受け取らない。サーバー側で生成することでクロックドリフトを防ぐ（リサーチ §6.1 の「サーバー側生成」方針）
- `deviceId` はリクエストから受け取る（将来の複数デバイス対応のため。リサーチ §6.2 の方針）

**完了条件**:
- [ ] `SensorData.humidity` が `int` になっている
- [ ] `SensorDataCreate` が `lambda/api/models/sensor.py` に定義・エクスポートされる
- [ ] `SensorDataCreate` のフィールドは `deviceId: str`, `temperature: float`, `humidity: int`, `co2: int` の 4 つのみ

---

### Step 2: `POST /data` エンドポイントの実装

**目的**: Raspberry Pi からのセンサーデータを受け取り、DynamoDB に保存して、保存したデータを返す。

**対象ファイル**:
- `lambda/api/main.py`（変更）

**実装内容**:

`main.py` の冒頭 import 行に `SensorDataCreate` を追加：

```python
from models.sensor import SensorData, SensorDataCreate, SensorDataResponse, HealthCheckResponse
```

`GET /latest` エンドポイントの後（`if __name__ == "__main__":` の前）に以下を追加：

```python
@app.post("/data", response_model=SensorData, status_code=201)
async def create_sensor_data(data: SensorDataCreate):
    """
    センサーデータを DynamoDB に保存

    Raspberry Pi の BLE スキャン結果を受け取り、DynamoDB に保存します。
    timestamp と expiresAt はサーバー側で生成します。

    - **deviceId**: デバイス ID
    - **temperature**: 温度 (°C)
    - **humidity**: 湿度 (%)
    - **co2**: CO2 濃度 (ppm)
    """
    _, table_name = _get_required_env_vars()

    # サーバー側でタイムスタンプを生成
    current_time = int(time.time() * 1000)           # ミリ秒
    expires_at = int(time.time()) + 30 * 24 * 60 * 60  # 30日後 UNIX 秒

    logger.info(
        "Saving sensor data",
        device_id=data.deviceId,
        temperature=data.temperature,
        humidity=data.humidity,
        co2=data.co2,
        timestamp=current_time,
    )

    try:
        table = dynamodb.Table(table_name)
        item = {
            'deviceId': data.deviceId,
            'timestamp': current_time,
            'temperature': Decimal(str(data.temperature)),  # float は Decimal 経由で保存
            'humidity': data.humidity,                      # int はそのまま保存
            'co2': data.co2,                                # int はそのまま保存
            'expiresAt': expires_at,
        }
        table.put_item(Item=item)

    except Exception as e:
        logger.error("DynamoDB put_item failed", error=str(e), endpoint="/data", method="POST")
        raise HTTPException(
            status_code=500,
            detail=f"Error saving data: {str(e)}"
        )

    # 保存データを SensorData 形式で返す
    return SensorData(
        deviceId=data.deviceId,
        timestamp=current_time,
        temperature=data.temperature,
        humidity=data.humidity,
        co2=data.co2,
    )
```

**設計判断**:
- `_get_required_env_vars()` を呼び出すが、`DEVICE_ID` は使用しない（`deviceId` はリクエストから受け取るため）。ただし `TABLE_NAME` 未設定時の早期エラーを活かすため同メソッドを利用する
- `Decimal(str(data.temperature))` で float → Decimal 変換（DynamoDB boto3 の要件。Poller の参考実装に倣う）
- `expiresAt` は DynamoDB TTL 属性（レスポンスには含めない）

**完了条件**:
- [ ] `POST /data` エンドポイントが `main.py` に追加される
- [ ] 正常時に 201 + `SensorData` 形式のレスポンスを返す
- [ ] DynamoDB エラー時に 500 を返す
- [ ] 環境変数 `TABLE_NAME` 未設定時に 500 を返す
- [ ] ログが既存の `StructuredLogger` パターンで出力される

---

### Step 3: POST エンドポイントのテスト追加

**目的**: `POST /data` エンドポイントの正常系・異常系を網羅するテストを追加する。既存 23 テストと同スタイルで実装する。

**対象ファイル**:
- `lambda/api/tests/test_main.py`（変更）

**実装内容**:

`TestMissingEnvVars` クラスの後に以下の新しいクラスを追加：

```python
# ============================================================
# TestCreateDataEndpoint
# ============================================================

class TestCreateDataEndpoint:
    """POST /data エンドポイントのテスト"""

    VALID_PAYLOAD = {
        "deviceId": "test-device",
        "temperature": 22.5,
        "humidity": 45,   # int（湿度は整数）
        "co2": 800,
    }

    def test_post_data_returns_201(self, client):
        """正常なリクエストで 201 Created を返す。"""
        tc, mock_db = client
        mock_db.Table.return_value.put_item.return_value = {}
        response = tc.post("/data", json=self.VALID_PAYLOAD)
        assert response.status_code == 201

    def test_post_data_response_contains_sensor_fields(self, client):
        """レスポンスに SensorData の全フィールドが含まれる。"""
        tc, mock_db = client
        mock_db.Table.return_value.put_item.return_value = {}
        response = tc.post("/data", json=self.VALID_PAYLOAD)
        body = response.json()
        assert body["deviceId"] == "test-device"
        assert body["temperature"] == 22.5
        assert body["humidity"] == 45
        assert body["co2"] == 800
        assert "timestamp" in body

    def test_post_data_timestamp_is_integer(self, client):
        """レスポンスの timestamp が整数（ミリ秒）である。"""
        tc, mock_db = client
        mock_db.Table.return_value.put_item.return_value = {}
        response = tc.post("/data", json=self.VALID_PAYLOAD)
        assert isinstance(response.json()["timestamp"], int)

    def test_post_data_calls_put_item(self, client):
        """DynamoDB の put_item が 1 回呼び出される。"""
        tc, mock_db = client
        mock_db.Table.return_value.put_item.return_value = {}
        tc.post("/data", json=self.VALID_PAYLOAD)
        mock_db.Table.return_value.put_item.assert_called_once()

    def test_post_data_put_item_contains_expires_at(self, client):
        """put_item に渡されるアイテムに expiresAt が含まれる。"""
        tc, mock_db = client
        mock_db.Table.return_value.put_item.return_value = {}
        tc.post("/data", json=self.VALID_PAYLOAD)
        call_args = mock_db.Table.return_value.put_item.call_args
        item = call_args[1]["Item"]  # キーワード引数 Item=
        assert "expiresAt" in item

    def test_post_data_missing_device_id_returns_422(self, client):
        """deviceId が欠けている場合は 422 を返す。"""
        tc, mock_db = client
        payload = {"temperature": 22.5, "humidity": 45.0, "co2": 800}
        response = tc.post("/data", json=payload)
        assert response.status_code == 422

    def test_post_data_missing_temperature_returns_422(self, client):
        """temperature が欠けている場合は 422 を返す。"""
        tc, mock_db = client
        payload = {"deviceId": "test-device", "humidity": 45.0, "co2": 800}
        response = tc.post("/data", json=payload)
        assert response.status_code == 422

    def test_post_data_missing_co2_returns_422(self, client):
        """co2 が欠けている場合は 422 を返す。"""
        tc, mock_db = client
        payload = {"deviceId": "test-device", "temperature": 22.5, "humidity": 45.0}
        response = tc.post("/data", json=payload)
        assert response.status_code == 422

    def test_post_data_invalid_temperature_type_returns_422(self, client):
        """temperature が文字列の場合は 422 を返す。"""
        tc, mock_db = client
        payload = {**self.VALID_PAYLOAD, "temperature": "invalid"}
        response = tc.post("/data", json=payload)
        assert response.status_code == 422

    def test_post_data_dynamodb_error_returns_500(self, client):
        """DynamoDB エラーで 500 とエラーメッセージを返す。"""
        tc, mock_db = client
        mock_db.Table.return_value.put_item.side_effect = Exception("DynamoDB error")
        response = tc.post("/data", json=self.VALID_PAYLOAD)
        assert response.status_code == 500
        assert "Error saving data" in response.json()["detail"]

    def test_post_data_missing_table_name_returns_500(self, mocker):
        """TABLE_NAME が欠けている場合に 500 を返す。"""
        mocker.patch.dict(os.environ, {'DEVICE_ID': 'dev'}, clear=True)
        with patch('main.dynamodb'):
            tc = TestClient(app)
            response = tc.post("/data", json={
                "deviceId": "dev",
                "temperature": 22.5,
                "humidity": 45.0,
                "co2": 800,
            })
        assert response.status_code == 500

    def test_post_data_negative_temperature(self, client):
        """負の温度値（冬場など）が正常に保存される。"""
        tc, mock_db = client
        mock_db.Table.return_value.put_item.return_value = {}
        payload = {**self.VALID_PAYLOAD, "temperature": -5.0}
        response = tc.post("/data", json=payload)
        assert response.status_code == 201
        assert response.json()["temperature"] == -5.0
```

**完了条件**:
- [ ] 12 件以上のテストが追加される
- [ ] `uv run pytest tests/` で全テスト（既存 23 件 + 新規）が通過する
- [ ] テストカバレッジが 93% 以上を維持する

---

### Step 4: Raspberry Pi スクリプト用 API 仕様の確定（別リポジトリ向け）

**目的**: Raspberry Pi スクリプトは別リポジトリで管理するため、このリポジトリでは `POST /data` のインターフェース仕様のみを定義する。

**スコープ外**: `raspberry_pi/` ディレクトリの作成は行わない。

**API 仕様（Raspberry Pi スクリプトとの契約）**:

```
POST {LAMBDA_FUNCTION_URL}/data
Content-Type: application/json

リクエストボディ:
{
  "deviceId": "switchbot-co2-01",  // string: DynamoDB の deviceId に使用
  "temperature": 22.5,             // float: 摂氏 (例: 22.5)
  "humidity": 45,                  // int: 整数 (例: 45)
  "co2": 800                       // int: ppm (例: 800)
}

レスポンス 201 Created:
{
  "deviceId": "switchbot-co2-01",
  "timestamp": 1706745600000,      // int: サーバー生成 Unix ミリ秒
  "temperature": 22.5,
  "humidity": 45,
  "co2": 800
}
```

**完了条件**:
- [ ] `POST /data` エンドポイントが上記仕様通りに動作することが確認できる（テストで担保）
- [ ] `ARCHITECTURE.md` に別リポジトリについての言及がある

---

### Step 5: poller-containerize-plan.md のアーカイブ

**目的**: 方針転換により不要となった Poller コンテナ化計画を `archived/` に移動し、経緯を明記する。

**対象ファイル**:
- `docs/exec-plans/active/poller-containerize-plan.md`（移動元）
- `docs/exec-plans/archived/poller-containerize-plan.md`（移動先）

**実装内容**:

1. `docs/exec-plans/archived/` ディレクトリを作成する（存在しない場合）
2. `poller-containerize-plan.md` を `active/` から `archived/` に移動する
3. 移動先ファイルの冒頭（`# Lambda Poller コンテナ化 実装計画` の直後）に以下の注記を追加する：

```markdown
> **[アーカイブ済み - 2026-04-04]**
> 方針転換により、このプランは実施しません。
> SwitchBot Hub Mini が手元になく、クラウド API 経由でのデータ取得が不可能なため、
> Lambda Poller によるポーリング方式から Raspberry Pi BLE スキャン方式に切り替えました。
> 参照コードとして `lambda/poller/` は削除せず残します。
> 代替プラン: `docs/exec-plans/active/ble-api-plan.md`
```

**完了条件**:
- [ ] `docs/exec-plans/archived/poller-containerize-plan.md` が存在する
- [ ] `docs/exec-plans/active/poller-containerize-plan.md` が存在しない
- [ ] アーカイブファイルの冒頭に方針転換の注記が入っている

---

### Step 6: ARCHITECTURE.md の更新

**目的**: `POST /data` エンドポイントの追加と新アーキテクチャを ARCHITECTURE.md に反映する。

**対象ファイル**:
- `ARCHITECTURE.md`（変更）

**実装内容**:

1. 「API Lambda (`lambda/api/main.py`)」セクションの「エンドポイント」部分に `POST /data` を追加：

```markdown
**エンドポイント**:
- `GET /` - ヘルスチェック（ステータス確認）
- `GET /health` - ヘルスチェックのエイリアス
- `GET /data?hours=24` - 指定時間範囲のセンサーデータ（デフォルト24時間、最大168時間）
- `GET /latest` - 最新のセンサーデータ1件
- `POST /data` - Raspberry Pi BLE スキャン結果を受け取り DynamoDB に保存（201 Created）
```

2. 「データフロー」または「バックエンド/API」セクション付近に新アーキテクチャの説明を追記：

```markdown
### BLE センサーデータフロー（Raspberry Pi 経由）

SwitchBot Hub Mini なしの環境では、Raspberry Pi が BLE で直接センサーをスキャンし、
Lambda API Function URL 経由でデータを登録します。

```
SwitchBot CO2センサー --BLE--> Raspberry Pi --HTTP POST--> Lambda API --> DynamoDB
```

Raspberry Pi 側のスクリプトは別リポジトリで管理します（関心の分離）。
`POST /data` のリクエスト/レスポンス仕様が両リポジトリ間の契約です。
```

3. 「テストカバレッジ」セクションの API テスト数を更新（23 → 35+）

**完了条件**:
- [ ] `POST /data` がエンドポイント一覧に追記される
- [ ] BLE データフローの説明が追記される

---

## Test Strategy

### Unit Tests（Lambda API）

**ファイル**: `lambda/api/tests/test_main.py`
**追加テストクラス**: `TestCreateDataEndpoint`
**テスト件数**: 12 件以上
**カバレッジ目標**: 93% 以上を維持

**主要テストケース**:

| # | テスト名 | 検証内容 |
|---|---------|---------|
| 1 | `test_post_data_returns_201` | 正常時に 201 を返す |
| 2 | `test_post_data_response_contains_sensor_fields` | レスポンスに全フィールドが含まれる |
| 3 | `test_post_data_timestamp_is_integer` | timestamp が整数（ミリ秒）である |
| 4 | `test_post_data_calls_put_item` | `put_item` が 1 回呼ばれる |
| 5 | `test_post_data_put_item_contains_expires_at` | `expiresAt` が DynamoDB item に含まれる |
| 6 | `test_post_data_missing_device_id_returns_422` | `deviceId` 欠落で 422 |
| 7 | `test_post_data_missing_temperature_returns_422` | `temperature` 欠落で 422 |
| 8 | `test_post_data_missing_co2_returns_422` | `co2` 欠落で 422 |
| 9 | `test_post_data_invalid_temperature_type_returns_422` | 不正型で 422 |
| 10 | `test_post_data_dynamodb_error_returns_500` | DynamoDB エラーで 500 |
| 11 | `test_post_data_missing_table_name_returns_500` | `TABLE_NAME` 未設定で 500 |
| 12 | `test_post_data_negative_temperature` | 負の温度値が正常に保存される |

### テスト実行

```bash
cd lambda/api
uv sync
uv run pytest tests/ -v
uv run pytest tests/ --cov=. --cov-report=term-missing
```

### Manual Testing（統合確認）

Raspberry Pi から実際に API を叩く動作確認手順：

```bash
# Lambda Function URL に直接 POST（curl で確認）
curl -X POST https://<function-url>/data \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"switchbot-co2","temperature":22.5,"humidity":45,"co2":800}'
# 期待: 201 + {"deviceId":"switchbot-co2","timestamp":...,"temperature":22.5,"humidity":45,"co2":800}
```

---

## Known Risks and Constraints

### 技術的リスク

- **リスク**: Raspberry Pi の BLE スキャンがセンサーを検出できない場合
  - **影響**: Medium
  - **軽減策**: `ble_scanner.py` はキューが空の場合に警告ログを出力する。`SEND_INTERVAL_SECONDS` を短くして早期に検出する

- **リスク**: Lambda Function URL への認証がない（現状はパブリック）
  - **影響**: Low（センサーデータのみ。内部ネットワーク + 固定の Raspberry Pi からの送信）
  - **軽減策**: 現スコープでは対応しない。将来的に IAM 認証や API キーを検討

- **リスク**: SwitchBot のメーカー ID（`0x0969`）が異なる場合、BLE データが取得できない
  - **影響**: High（センサー検出不能）
  - **軽減策**: `ble_scanner.py` の `detection_callback` でメーカー ID が見つからない場合はスキップし、警告ログを出力する。実機確認で要検証

- **リスク**: `Decimal(str(data.temperature))` で浮動小数点精度の誤差が生じる可能性
  - **影響**: Low（センサー値の精度要件は小数点 1 桁）
  - **軽減策**: `str()` 経由の変換は Poller と同じ実装で安全性が確認済み

### 制約

- **Terraform 変更なし**: `dynamodb:PutItem` は既に IAM ポリシーに含まれているため、Terraform の変更は不要
- **Raspberry Pi 用テストなし**: `ble_scanner.py` は BLE ハードウェア依存のため、自動ユニットテストは現スコープ外とする
- **複数デバイス未対応の GET エンドポイント**: `GET /data` と `GET /latest` は環境変数 `DEVICE_ID` を参照するが、`POST /data` はリクエストの `deviceId` を使用する。この非一貫性は既知の技術的負債として残す

---

## Alternative Approaches Considered

### アプローチ A: `timestamp` をクライアントから受け取る

- **長所**: BLE スキャン時刻を正確に記録できる
- **短所**: Raspberry Pi のクロックドリフトによるデータ精度低下リスク
- **不採用理由**: サーバー側で生成する方がシンプルで安全。HTTP レイテンシは数十ms 程度で実用上は問題なし

### アプローチ B: `deviceId` を環境変数から取得（採用しない）

- **長所**: Raspberry Pi 側がシンプル（リクエストに `deviceId` 不要）
- **短所**: センサー追加時に Terraform 変更が必要。拡張性が低い
- **不採用理由**: リクエストから受け取ることで将来の複数デバイス対応が容易になる

### アプローチ C: `bleak` の代わりに `bluepy` を使用

- **長所**: より低レベルなアクセスが可能
- **短所**: bluepy はメンテナンスが停滞しており、Python 3.x 対応が不安定
- **不採用理由**: bleak は asyncio ネイティブで現代的な API を提供しており、Python 3.11 との相性が良い

---

## Post-Implementation Tasks

- [ ] `ARCHITECTURE.md` を更新する（Step 6 で実施）
- [ ] 完了後、本計画を `docs/exec-plans/completed/` に移動する
- [ ] `docs/exec-plans/active/poller-containerize-plan.md` を `archived/` に移動する（Step 5 で実施）
- [ ] 別リポジトリ（Raspberry Pi スクリプト）から実際に `POST /data` を呼び出して動作確認を行う
