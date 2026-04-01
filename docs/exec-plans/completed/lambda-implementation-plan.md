# Lambda 実装計画

**タスク**: Smarthome センサーダッシュボード用の 2 つの Lambda 関数を完成させ、本番品質に引き上げる
**計画日**: 2026-03-29
**調査ドキュメント**: `docs/exec-plans/active/lambda-implementation-research.md`
**ステータス**: 実装完了・デプロイ待ち（ステップ 1-8 完了、ステップ 9-10 は AWS デプロイ操作）
**実装日**: 2026-03-29

---

## 目標と成功基準

**目標**: 両 Lambda 関数を動作するスケルトンから、堅牢なエラーハンドリング・構造化ログ・包括的なテスト・AWS へのデプロイ検証を備えた本番対応コードへ引き上げる。

**成功基準**:
- [x] Poller Lambda が 2 分ごとに Switchbot API をポーリングし、30 日 TTL 付きでデータを DynamoDB に書き込む（API 上限 1,000 req/日に対し 1 分間隔は 1,440 req/日で超過するため）
- [x] Poller が Switchbot API の一時的な障害を指数バックオフ（最大 3 回）でリトライする
- [x] Poller が全体を通じて構造化 JSON ログを使用する
- [x] API Lambda が 4 つのエンドポイント（`/`、`/health`、`/data`、`/latest`）を正しいレスポンス形式で提供する
- [x] API Lambda が障害時に構造化 JSON エラーレスポンスを返す
- [x] API Lambda が全体を通じて構造化 JSON ログを使用する
- [x] 両 Lambda に行カバレッジ 80% 以上のユニットテストが存在する（Poller: 100%、API: 93%）
- [ ] 両 Lambda が Terragrunt 経由で正常にデプロイされ、フロントエンドから到達可能である（**AWS デプロイ操作が必要**）
- [ ] エンドツーエンドテスト: フロントエンドが実際の API URL からライブセンサーデータを表示できる（**デプロイ後に実行**）

---

## 現在の状態と必要な作業

### 既に存在するもの（ゼロから書き直さないこと）

| ファイル | ステータス | 備考 |
|---|---|---|
| `lambda/poller/lambda_function.py` | スケルトン - 動作するが本番対応ではない | 不足: リトライロジック、構造化ログ、入力バリデーション、Switchbot レスポンスフィールド検証 |
| `lambda/api/main.py` | スケルトン - 動作するが本番対応ではない | 不足: 構造化ログ、起動時の環境変数バリデーション、`/latest` レスポンスモデル |
| `lambda/api/models/sensor.py` | 完成 | Pydantic モデルは正しく、フロントエンドの型と一致している |
| `lambda/api/Dockerfile` | 完成 | Lambda Web Adapter v0.7.1、ポート 8000 で uvicorn |
| `lambda/api/requirements.txt` | 完成 | 全依存関係が正しい |
| `lambda/poller/requirements.txt` | 完成 | boto3 + requests |
| `terraform/modules/lambda/main.tf` | 完成 | Zip ベースの Lambda モジュール準備完了 |
| `terraform/modules/lambda-container/main.tf` | 完成 | ECR ベースの Lambda モジュール準備完了 |
| `terraform/environments/prod/lambda-poller/terragrunt.hcl` | 完成 | スケジュール、環境変数、DynamoDB 依存関係が設定済み |
| `terraform/environments/prod/lambda-api/terragrunt.hcl` | 完成 | ECR イメージ URI、環境変数が設定済み |

### 追記・変更が必要なもの

| ファイル | アクション | 概要 |
|---|---|---|
| `lambda/poller/lambda_function.py` | 変更 | 構造化 JSON ログ、指数バックオフ付きリトライ、Switchbot レスポンスフィールド検証、範囲外警告を追加 |
| `lambda/api/main.py` | 変更 | 構造化 JSON ログ、起動時環境変数バリデーション、`/latest` への `response_model` 追加 |
| `lambda/api/models/sensor.py` | 変更 | Pydantic v1 の `Config` クラスを Pydantic v2 の `model_config` にアップグレード |
| `lambda/poller/tests/test_lambda_function.py` | 新規 | Poller のユニットテスト |
| `lambda/api/tests/test_main.py` | 新規 | API Lambda のユニットテスト |

---

## アーキテクチャの変更

### 新規ファイル
- `lambda/poller/tests/__init__.py` - pytest がパッケージを検出するための空の init
- `lambda/poller/tests/test_lambda_function.py` - Poller ユニットテスト（boto3 + requests をモック）
- `lambda/api/tests/__init__.py` - 空の init
- `lambda/api/tests/test_main.py` - API Lambda ユニットテスト（boto3 をモック、TestClient 使用）

### 変更ファイル
- `lambda/poller/lambda_function.py` - リトライロジック、構造化ログ、バリデーションを追加
- `lambda/api/main.py` - 構造化ログ、起動時バリデーション、`/latest` レスポンスモデルの修正
- `lambda/api/models/sensor.py` - Pydantic v1 の `Config` 内部クラスから Pydantic v2 の `model_config` へ移行

### 追加する依存関係
- `lambda/poller/requirements.txt`: 新しいパッケージは不要（リトライロジックは手動実装）
- `lambda/api/requirements.txt`: 新しいパッケージは不要
- 両方の `tests/` ディレクトリ: `pytest>=7.0`、`pytest-mock>=3.0`、`httpx>=0.24`（FastAPI TestClient 用）— これらは **開発専用** で、各 Lambda ディレクトリの新規 `requirements-dev.txt` に記述する

### インフラの変更なし
Terraform/Terragrunt ファイルはすでに完成していて正しい。変更不要。

---

## 実装ステップ

### ステップ 1: Poller Lambda に構造化 JSON ログモジュールを追加する

**目的**: 生の `print()` 呼び出しを CloudWatch でクエリできる構造化 JSON ログに置き換える。これは Poller の他のすべての変更の基盤となる。

**現状**: `lambda/poller/lambda_function.py` はすべての出力に `print()` を使用している。

**アクション**:

1. `lambda/poller/lambda_function.py` の冒頭で、現在のインポートブロックを置き換え、ロガーのセットアップを追加する:

```python
import logging
import json

# CloudWatch 向け構造化 JSON ロガー
class StructuredLogger:
    def __init__(self, name: str):
        self._logger = logging.getLogger(name)
        self._logger.setLevel(logging.INFO)

    def _log(self, level: str, message: str, **kwargs):
        record = {"level": level, "message": message, **kwargs}
        print(json.dumps(record))  # Lambda は stdout を CloudWatch にキャプチャする

    def info(self, message: str, **kwargs):
        self._log("INFO", message, **kwargs)

    def warning(self, message: str, **kwargs):
        self._log("WARNING", message, **kwargs)

    def error(self, message: str, **kwargs):
        self._log("ERROR", message, **kwargs)

logger = StructuredLogger("poller")
```

2. `lambda_function.py` 内のすべての `print(...)` 呼び出しを `logger.info(...)`、`logger.warning(...)`、または `logger.error(...)` に置き換える。

3. 主要なログ呼び出しにコンテキストフィールドを追加する:
   - `lambda_handler` 開始時: `logger.info("Poller invoked", device_id=device_id)`
   - 保存成功時: `logger.info("Data saved to DynamoDB", device_id=device_id, timestamp=current_time)`
   - エラー時: `logger.error("Unexpected error", error=str(e), device_id=device_id)`

**完了基準**:
- [x] `lambda_function.py` に生の `print()` 呼び出しが残っていない
- [x] すべてのログ出力が有効な JSON 文字列である
- [x] ログレコードに `level`、`message`、および関連するコンテキストフィールドが含まれている

**影響ファイル**:
- `lambda/poller/lambda_function.py` (変更)

---

### ステップ 2: Poller Lambda に指数バックオフ付きリトライを追加する

**目的**: 現在の `fetch_switchbot_data()` にはリトライロジックがない。一時的なネットワークエラーや Switchbot API の一時的な障害によって、データが無音でギャップになる。計画は 3 回リトライ、指数バックオフ（ベース遅延 1s、2s、4s にジッター追加）。

**現状**: `fetch_switchbot_data()` は 1 回リクエストして失敗時に例外を送出する。リトライなし。

**アクション**:

1. インポートに `import time`（すでに存在する場合あり）と `import random` を追加する。

2. 以下のシグネチャと動作を持つ `_fetch_with_retry()` ラッパー関数を追加する:

```python
def _fetch_with_retry(
    token: str,
    secret: str,
    device_id: str,
    max_attempts: int = 3,
    base_delay: float = 1.0
) -> dict:
    """
    fetch_switchbot_data() を指数バックオフ付きで呼び出す。
    requests.RequestException および statusCode != 100 の場合にリトライする。
    全試行が失敗した場合は最後の例外を送出する。
    """
    last_exc = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fetch_switchbot_data(token, secret, device_id)
        except Exception as exc:
            last_exc = exc
            if attempt == max_attempts:
                break
            delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
            logger.warning(
                "Switchbot API call failed, retrying",
                attempt=attempt,
                max_attempts=max_attempts,
                delay_seconds=round(delay, 2),
                error=str(exc)
            )
            time.sleep(delay)
    raise last_exc
```

3. `lambda_handler` 内で `fetch_switchbot_data(...)` の直接呼び出しを `_fetch_with_retry(...)` に置き換える。

4. `fetch_switchbot_data()` 自体は変更しない（純粋な関数としてテストが容易）。

**判断**: `fetch_switchbot_data` からの**すべての**例外（`requests.RequestException` と `statusCode != 100` による明示的な `Exception` の両方）でリトライする。Switchbot の API は一時的に非 100 を返すことがある。将来的に非 100 のリトライが不要になった場合は、リトライ可能な例外とそうでない例外に分割できる。

**完了基準**:
- [x] `_fetch_with_retry()` 関数が正しいシグネチャで存在する
- [x] `lambda_handler` が `fetch_switchbot_data` を直接呼び出すのではなく `_fetch_with_retry` を呼び出す
- [x] 失敗した試行が試行番号と遅延を含む WARNING レベルでログに記録される
- [x] 最終的な失敗が ERROR レベルでログに記録されて再送出される

**影響ファイル**:
- `lambda/poller/lambda_function.py` (変更)

---

### ステップ 3: Poller Lambda に Switchbot レスポンスフィールドバリデーションを追加する

**目的**: 現在のコードは `sensor_data.get('temperature', 0)` のようにデフォルト値 0 で呼び出している — API レスポンス形式が変わった場合にゼロ値を無音で書き込んでしまう。レスポンスフィールドが存在することを検証し、センサー値が合理的な物理範囲外の場合は警告をログに記録する（ただしデータは書き込む）。

**現状**: `save_to_dynamodb()` は全フィールドに `.get()` とデフォルト値 0 を使用している。バリデーションなし。

**アクション**:

1. `_validate_sensor_data()` 関数を追加する:

```python
def _validate_sensor_data(sensor_data: dict, device_id: str) -> None:
    """
    センサーデータフィールドの存在と期待される範囲を検証する。
    範囲外の値は警告をログに記録するが、例外を送出しない。
    必須フィールドが完全に欠けている場合は KeyError を送出する。
    """
    required_fields = ['temperature', 'humidity', 'CO2']
    for field in required_fields:
        if field not in sensor_data:
            raise KeyError(f"Missing required field '{field}' in Switchbot response")

    temp = sensor_data['temperature']
    humidity = sensor_data['humidity']
    co2 = sensor_data['CO2']

    if not (-50 <= temp <= 100):
        logger.warning(
            "Temperature out of expected range",
            device_id=device_id,
            temperature=temp,
            range="[-50, 100]"
        )
    if not (0 <= humidity <= 100):
        logger.warning(
            "Humidity out of expected range",
            device_id=device_id,
            humidity=humidity,
            range="[0, 100]"
        )
    if not (0 <= co2 <= 10000):
        logger.warning(
            "CO2 out of expected range",
            device_id=device_id,
            co2=co2,
            range="[0, 10000]"
        )
```

2. `lambda_handler` 内で `_fetch_with_retry()` が返った後、`save_to_dynamodb()` を呼び出す前に `_validate_sensor_data(sensor_data, device_id)` を呼び出す。

3. `save_to_dynamodb()` を更新して `.get(..., 0)` のデフォルトフォールバックを削除する。`_validate_sensor_data` がフィールドの存在を保証するので、直接的な辞書アクセス（`sensor_data['temperature']`）を使用する。

**判断**: 範囲外の値は警告ログを発生させるが、データは DynamoDB に書き込む。これは「ログに警告を記録するが拒否しない」というデフォルトの方針に合致する。必須フィールドが欠けている場合は `KeyError` が発生し、Lambda は 500 を返す。

**完了基準**:
- [x] `_validate_sensor_data()` 関数が存在する
- [x] `_fetch_with_retry()` と `save_to_dynamodb()` の間で呼び出される
- [x] 必須フィールドの欠如が `KeyError` を送出する
- [x] 範囲外の値が警告をログに記録するが例外を送出しない
- [x] `save_to_dynamodb()` がデフォルト値なしの直接辞書アクセスを使用する

**影響ファイル**:
- `lambda/poller/lambda_function.py` (変更)

---

### ステップ 4: Poller Lambda に起動時の環境変数バリデーションを追加する

**目的**: 現在 Poller は環境変数を `lambda_handler()` 内で読み込んでいる。変数が欠けている場合、Lambda は有用なコンテキストのない `KeyError` でクラッシュする。バリデーションをモジュールロード時（またはハンドラーの先頭で AWS 呼び出し前）に移動することで、より明確なエラーメッセージが得られる。

**現状**: `lambda_handler` 内に `token = os.environ['SWITCHBOT_TOKEN']` がある。

**アクション**:

1. `lambda_handler()` の先頭、API 呼び出し前に、4 つの必須環境変数をすべて検証し、いずれかが欠けているか空の場合は明確な `ValueError` を送出する:

```python
def lambda_handler(event, context):
    token = os.environ.get('SWITCHBOT_TOKEN', '')
    secret = os.environ.get('SWITCHBOT_SECRET', '')
    device_id = os.environ.get('DEVICE_ID', '')
    table_name = os.environ.get('TABLE_NAME', '')

    missing = [k for k, v in {
        'SWITCHBOT_TOKEN': token,
        'SWITCHBOT_SECRET': secret,
        'DEVICE_ID': device_id,
        'TABLE_NAME': table_name
    }.items() if not v]

    if missing:
        logger.error("Missing required environment variables", missing=missing)
        return {
            'statusCode': 500,
            'body': json.dumps({'message': 'Configuration error', 'missing': missing})
        }
    ...
```

注意: 例外を送出するのではなく構造化エラーレスポンスを返すことで、CloudWatch がエラーをクリーンにログに記録できる。

**完了基準**:
- [x] `lambda_handler` の先頭で 4 つの環境変数すべてが検証される
- [x] 欠けている変数が構造化エラーログと 500 の戻り値を生成する
- [x] エラーログに欠けている変数名のリストが含まれる

**影響ファイル**:
- `lambda/poller/lambda_function.py` (変更)

---

### ステップ 5: API Lambda に構造化 JSON ログを追加する

**目的**: API Lambda には現在ログが一切ない。Poller で使用したのと同じ StructuredLogger パターンを追加して、リクエスト/エラー情報を CloudWatch でクエリできるようにする。

**現状**: `lambda/api/main.py` にはログのインポートも呼び出しもない。

**アクション**:

1. `lambda/api/main.py` に Poller と同じ `StructuredLogger` クラスと `logger` インスタンスを追加する（ステップ 1 と同一のパターン）。インポートの後、FastAPI アプリ定義の前に配置する。

2. 各エンドポイントハンドラーの先頭にリクエストログを追加する:
   - `GET /data`: `logger.info("Fetching sensor data", hours=hours, device_id=device_id)`
   - `GET /latest`: `logger.info("Fetching latest sensor data", device_id=device_id)`

3. 各 `raise HTTPException` の前にエラーログを追加する:
   - 設定エラー: `logger.error("Missing env vars", missing=[...])`
   - DynamoDB エラー: `logger.error("DynamoDB query failed", error=str(e), endpoint="/data")`
   - データ未検出（404）: `logger.info("No data found for device", device_id=device_id)`

4. モジュールが最初にロードされる際に環境変数が欠けている場合に警告をログに記録するモジュールレベルの起動バリデーションを追加する（ルートハンドラー外部に配置）:

```python
# 環境変数が設定されていない場合の早期警告（リクエスト時にも失敗する）
_startup_device_id = os.environ.get('DEVICE_ID', '')
_startup_table_name = os.environ.get('TABLE_NAME', '')
if not _startup_device_id or not _startup_table_name:
    logger.warning(
        "DEVICE_ID or TABLE_NAME not set at startup",
        device_id_set=bool(_startup_device_id),
        table_name_set=bool(_startup_table_name)
    )
```

**完了基準**:
- [x] `StructuredLogger` が定義され、`main.py` で `logger` がインスタンス化されている
- [x] 各ルートハンドラーが少なくとも 1 つの INFO メッセージをログに記録する
- [x] すべての `raise HTTPException` の前にログ呼び出しがある
- [x] 欠けている環境変数に対するモジュールレベルの起動警告がある

**影響ファイル**:
- `lambda/api/main.py` (変更)

---

### ステップ 6: センサーモデルの Pydantic v2 互換性を修正する

**目的**: `lambda/api/models/sensor.py` は Pydantic v1 スタイルの `class Config` 内部クラスを使用している。`requirements.txt` が `pydantic>=2.0.0` を指定しているため、v2 では互換性シムを介して動作するが非推奨警告が出る。代わりに v2 の `model_config` スタイルを使用する。

**現状**:
```python
class Config:
    json_encoders = {
        Decimal: float
    }
```

**アクション**:

1. `lambda/api/models/sensor.py` の `SensorData` 内の `Config` 内部クラスを以下に置き換える:

```python
from pydantic import BaseModel, Field, model_serializer
from pydantic import ConfigDict

class SensorData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    ...
```

2. `json_encoders = {Decimal: float}` シムはもはや不要。なぜなら `main.py` の `decimal_to_float()` がすでに `SensorData` インスタンスを構築する前にすべての `Decimal` 値を変換しているため。`SensorData` から `Config` クラスを完全に削除する。

3. `Config` クラスでのみ使用されている場合は、`models/sensor.py` から未使用の `from decimal import Decimal` インポートを削除する。

4. `main.py` の `/latest` エンドポイントに `response_model=SensorData` を追加する（現在は生の `dict` を返している）。これにより OpenAPI スキーマのカバレッジとレスポンスバリデーションが得られる:

```python
@app.get("/latest", response_model=SensorData)
async def get_latest_data():
    ...
    return SensorData(**converted_item)  # 生の dict を返す代わりに
```

**完了基準**:
- [x] `SensorData` が `class Config` ではなく `model_config = ConfigDict(...)` を使用している
- [x] テスト実行時に Pydantic の非推奨警告が出ない
- [x] `/latest` エンドポイントに `response_model=SensorData` がある
- [x] `/latest` が平の `dict` ではなく `SensorData` インスタンスを返す

**影響ファイル**:
- `lambda/api/models/sensor.py` (変更)
- `lambda/api/main.py` (変更 — `/latest` エンドポイント)

---

### ステップ 7: Poller Lambda のユニットテストを書く

**目的**: Poller にはテストがない。ハッピーパス、リトライ動作、バリデーション、エラーハンドリングをカバーするテストを書く。

**アクション**:

1. `lambda/poller/tests/__init__.py` を作成する（空）。

2. `lambda/poller/requirements-dev.txt` を作成する:
```
pytest>=7.0
pytest-mock>=3.0
```

3. `lambda/poller/tests/test_lambda_function.py` を以下のテストケースで作成する:

**テストクラス: `TestFetchSwitchbotData`**

```python
def test_fetch_switchbot_data_success(mocker):
    """ハッピーパス: API が statusCode 100 とセンサーデータを返す。"""
    mock_response = mocker.Mock()
    mock_response.json.return_value = {
        'statusCode': 100,
        'body': {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}
    }
    mocker.patch('requests.get', return_value=mock_response)
    result = fetch_switchbot_data('token', 'secret', 'device123')
    assert result == {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}

def test_fetch_switchbot_data_api_error(mocker):
    """Switchbot が非 100 ステータスコードを返す。"""
    mock_response = mocker.Mock()
    mock_response.json.return_value = {'statusCode': 401, 'message': 'Unauthorized'}
    mocker.patch('requests.get', return_value=mock_response)
    with pytest.raises(Exception, match="Switchbot API error"):
        fetch_switchbot_data('token', 'secret', 'device123')

def test_fetch_switchbot_data_network_error(mocker):
    """ネットワークエラーが requests.RequestException を送出する。"""
    mocker.patch('requests.get', side_effect=requests.RequestException("timeout"))
    with pytest.raises(requests.RequestException):
        fetch_switchbot_data('token', 'secret', 'device123')
```

**テストクラス: `TestFetchWithRetry`**

```python
def test_fetch_with_retry_succeeds_first_attempt(mocker):
    """成功時にリトライは不要。"""
    mock_fetch = mocker.patch('lambda_function.fetch_switchbot_data',
                              return_value={'temperature': 22.5, 'humidity': 45.0, 'CO2': 800})
    result = _fetch_with_retry('token', 'secret', 'device123')
    assert mock_fetch.call_count == 1

def test_fetch_with_retry_succeeds_on_second_attempt(mocker):
    """1 回目が失敗し、2 回目が成功する。"""
    success = {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}
    mocker.patch('lambda_function.fetch_switchbot_data',
                 side_effect=[Exception("temporary"), success])
    mocker.patch('time.sleep')  # テストで実際にスリープしない
    result = _fetch_with_retry('token', 'secret', 'device123', base_delay=0)
    assert result == success

def test_fetch_with_retry_exhausts_all_attempts(mocker):
    """3 回すべての試行が失敗し、最後の例外を送出する。"""
    mocker.patch('lambda_function.fetch_switchbot_data',
                 side_effect=Exception("persistent failure"))
    mocker.patch('time.sleep')
    with pytest.raises(Exception, match="persistent failure"):
        _fetch_with_retry('token', 'secret', 'device123', max_attempts=3, base_delay=0)
```

**テストクラス: `TestValidateSensorData`**

```python
def test_validate_sensor_data_valid():
    """有効なデータは警告なしで通過する。"""
    _validate_sensor_data(
        {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}, 'device123'
    )  # 例外を送出しないこと

def test_validate_sensor_data_missing_field():
    """必須フィールドの欠如が KeyError を送出する。"""
    with pytest.raises(KeyError, match="temperature"):
        _validate_sensor_data({'humidity': 45.0, 'CO2': 800}, 'device123')

def test_validate_sensor_data_out_of_range_logs_warning(mocker):
    """範囲外の値は警告をログに記録するが例外を送出しない。"""
    mock_warning = mocker.patch.object(logger, 'warning')
    _validate_sensor_data({'temperature': 200.0, 'humidity': 45.0, 'CO2': 800}, 'device123')
    assert mock_warning.called
```

**テストクラス: `TestSaveToDynamoDB`**

```python
def test_save_to_dynamodb_success(mocker):
    """DynamoDB の put_item 呼び出しが成功する。"""
    mock_table = mocker.Mock()
    mock_dynamodb = mocker.patch('lambda_function.dynamodb')
    mock_dynamodb.Table.return_value = mock_table
    sensor_data = {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800}
    save_to_dynamodb('test-table', 'device123', sensor_data)
    mock_table.put_item.assert_called_once()
    call_args = mock_table.put_item.call_args[1]['Item']
    assert call_args['deviceId'] == 'device123'
    assert float(call_args['temperature']) == 22.5
    assert 'expiresAt' in call_args

def test_save_to_dynamodb_dynamodb_error(mocker):
    """DynamoDB エラーが伝播する。"""
    mock_table = mocker.Mock()
    mock_table.put_item.side_effect = Exception("DynamoDB error")
    mocker.patch('lambda_function.dynamodb').Table.return_value = mock_table
    with pytest.raises(Exception, match="DynamoDB error"):
        save_to_dynamodb('test-table', 'device123', {'temperature': 22.5, 'humidity': 45.0, 'CO2': 800})
```

**テストクラス: `TestLambdaHandler`**

```python
def test_lambda_handler_success(mocker):
    """全体のハッピーパスが statusCode 200 を返す。"""
    mocker.patch.dict(os.environ, {
        'SWITCHBOT_TOKEN': 'tok', 'SWITCHBOT_SECRET': 'sec',
        'DEVICE_ID': 'dev', 'TABLE_NAME': 'tbl'
    })
    mocker.patch('lambda_function._fetch_with_retry',
                 return_value={'temperature': 22.5, 'humidity': 45.0, 'CO2': 800})
    mocker.patch('lambda_function._validate_sensor_data')
    mocker.patch('lambda_function.save_to_dynamodb')
    result = lambda_handler({}, {})
    assert result['statusCode'] == 200

def test_lambda_handler_missing_env_vars(mocker):
    """環境変数の欠如が Switchbot を呼び出さずに statusCode 500 を返す。"""
    mocker.patch.dict(os.environ, {}, clear=True)
    mock_fetch = mocker.patch('lambda_function._fetch_with_retry')
    result = lambda_handler({}, {})
    assert result['statusCode'] == 500
    mock_fetch.assert_not_called()

def test_lambda_handler_api_failure_returns_500(mocker):
    """リトライ後の Switchbot API 障害が statusCode 500 を返す。"""
    mocker.patch.dict(os.environ, {
        'SWITCHBOT_TOKEN': 'tok', 'SWITCHBOT_SECRET': 'sec',
        'DEVICE_ID': 'dev', 'TABLE_NAME': 'tbl'
    })
    mocker.patch('lambda_function._fetch_with_retry',
                 side_effect=Exception("all retries failed"))
    result = lambda_handler({}, {})
    assert result['statusCode'] == 500
```

**完了基準**:
- [x] `lambda/poller/tests/__init__.py` が作成されている
- [x] `lambda/poller/requirements-dev.txt` が作成されている
- [x] `lambda/poller/tests/test_lambda_function.py` が上記のすべてのテストクラスで作成されている
- [x] `pytest lambda/poller/tests/` がエラーなしで実行される
- [x] `lambda_function.py` のカバレッジが 80% 以上（実際: 100%）

**影響ファイル**:
- `lambda/poller/tests/__init__.py` (新規)
- `lambda/poller/requirements-dev.txt` (新規)
- `lambda/poller/tests/test_lambda_function.py` (新規)

---

### ステップ 8: API Lambda のユニットテストを書く

**目的**: API Lambda にはテストがない。FastAPI の `TestClient` と pytest-mock を使用して、全エンドポイントとエラーパスをカバーするテストを書く。

**アクション**:

1. `lambda/api/tests/__init__.py` を作成する（空）。

2. `lambda/api/requirements-dev.txt` を作成する:
```
pytest>=7.0
pytest-mock>=3.0
httpx>=0.24.0
```
（httpx は FastAPI の `TestClient` に必要）

3. `lambda/api/tests/test_main.py` を以下のテストケースで作成する:

**フィクスチャ: モック DynamoDB テーブル**

```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
from decimal import Decimal
import os

@pytest.fixture
def client(mocker):
    """モックされた環境変数と DynamoDB を持つ TestClient を作成する。"""
    mocker.patch.dict(os.environ, {'DEVICE_ID': 'dev123', 'TABLE_NAME': 'test-table'})
    with patch('main.dynamodb') as mock_db:
        yield TestClient(app), mock_db

def make_sensor_item(temp=22.5, humidity=45.0, co2=800):
    return {
        'deviceId': 'dev123',
        'timestamp': 1706745600000,
        'temperature': Decimal(str(temp)),
        'humidity': Decimal(str(humidity)),
        'co2': co2
    }
```

**テストクラス: `TestHealthEndpoints`**

```python
def test_root_returns_ok(client):
    tc, _ = client
    response = tc.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_health_returns_ok(client):
    tc, _ = client
    response = tc.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
```

**テストクラス: `TestDataEndpoint`**

```python
def test_get_data_returns_sensor_list(client):
    tc, mock_db = client
    mock_db.Table.return_value.query.return_value = {
        'Items': [make_sensor_item()]
    }
    response = tc.get("/data?hours=24")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["data"][0]["temperature"] == 22.5
    assert body["data"][0]["humidity"] == 45.0
    assert body["data"][0]["co2"] == 800

def test_get_data_empty_result(client):
    tc, mock_db = client
    mock_db.Table.return_value.query.return_value = {'Items': []}
    response = tc.get("/data?hours=24")
    assert response.status_code == 200
    assert response.json()["count"] == 0

def test_get_data_hours_below_min(client):
    tc, _ = client
    response = tc.get("/data?hours=0")
    assert response.status_code == 422  # FastAPI バリデーションエラー

def test_get_data_hours_above_max(client):
    tc, _ = client
    response = tc.get("/data?hours=169")
    assert response.status_code == 422

def test_get_data_dynamodb_error(client):
    tc, mock_db = client
    mock_db.Table.return_value.query.side_effect = Exception("DynamoDB error")
    response = tc.get("/data?hours=24")
    assert response.status_code == 500
    assert "Error fetching data" in response.json()["detail"]

def test_get_data_decimal_conversion(client):
    """DynamoDB からの Decimal 値が文字列ではなく float としてシリアライズされる。"""
    tc, mock_db = client
    mock_db.Table.return_value.query.return_value = {
        'Items': [make_sensor_item(temp=Decimal('22.567'))]
    }
    response = tc.get("/data?hours=1")
    assert response.status_code == 200
    temp = response.json()["data"][0]["temperature"]
    assert isinstance(temp, float)
```

**テストクラス: `TestLatestEndpoint`**

```python
def test_get_latest_returns_single_item(client):
    tc, mock_db = client
    mock_db.Table.return_value.query.return_value = {
        'Items': [make_sensor_item()]
    }
    response = tc.get("/latest")
    assert response.status_code == 200
    body = response.json()
    assert "deviceId" in body
    assert "timestamp" in body

def test_get_latest_no_data_returns_404(client):
    tc, mock_db = client
    mock_db.Table.return_value.query.return_value = {'Items': []}
    response = tc.get("/latest")
    assert response.status_code == 404

def test_get_latest_dynamodb_error(client):
    tc, mock_db = client
    mock_db.Table.return_value.query.side_effect = Exception("DynamoDB error")
    response = tc.get("/latest")
    assert response.status_code == 500
```

**テストクラス: `TestMissingEnvVars`**

```python
def test_data_endpoint_missing_device_id(mocker):
    mocker.patch.dict(os.environ, {'TABLE_NAME': 'tbl'}, clear=True)
    tc = TestClient(app)
    response = tc.get("/data")
    assert response.status_code == 500
    assert "configuration error" in response.json()["detail"].lower()
```

**完了基準**:
- [x] `lambda/api/tests/__init__.py` が作成されている
- [x] `lambda/api/requirements-dev.txt` が作成されている
- [x] `lambda/api/tests/test_main.py` が上記のすべてのテストクラスで作成されている
- [x] `pytest lambda/api/tests/` がエラーなしで実行される
- [x] `main.py` のカバレッジが 80% 以上（実際: 93%）

**影響ファイル**:
- `lambda/api/tests/__init__.py` (新規)
- `lambda/api/requirements-dev.txt` (新規)
- `lambda/api/tests/test_main.py` (新規)

---

### ステップ 9: Poller Lambda をデプロイする

**目的**: 完成した Poller Lambda を Terragrunt を使って AWS にプッシュする。これが計画における最初の実際の AWS 操作である。

**前提条件**: シェルに AWS 認証情報が設定されており、`SWITCHBOT_TOKEN`、`SWITCHBOT_SECRET`、`SWITCHBOT_DEVICE_ID` が環境変数としてエクスポートされている。

**アクション**:

1. DynamoDB がすでにデプロイされていることを確認する（インフラセットアップ済みのはず）。未デプロイの場合:
```bash
cd /Users/riku/Work/smarthome/terraform/environments/prod/dynamodb
terragrunt apply
```

2. Poller Lambda をデプロイする:
```bash
export SWITCHBOT_TOKEN="<your token>"
export SWITCHBOT_SECRET="<your secret>"
export SWITCHBOT_DEVICE_ID="<your device id>"

cd /Users/riku/Work/smarthome/terraform/environments/prod/lambda-poller
terragrunt apply
```

3. 手動で呼び出してデプロイを確認する:
```bash
aws lambda invoke \
  --function-name poller \
  --region ap-northeast-1 \
  --payload '{}' \
  /tmp/poller-response.json
cat /tmp/poller-response.json
```

4. DynamoDB にデータが現れたことを確認する:
```bash
aws dynamodb scan \
  --table-name $(terragrunt output -raw table_name -chdir=../dynamodb) \
  --region ap-northeast-1 \
  --limit 5
```

5. CloudWatch ログで構造化 JSON 出力を確認する:
```bash
aws logs tail /aws/lambda/poller --region ap-northeast-1 --since 5m
```

**完了基準**:
- [ ] `terragrunt apply` がエラーなしで完了する
- [ ] 手動の invoke が `{"statusCode": 200, ...}` を返す
- [ ] DynamoDB スキャンで少なくとも 1 つの新しいアイテムが表示される
- [ ] CloudWatch ログに有効な JSON 構造エントリが含まれる
- [ ] EventBridge ルールが毎分発火する（2 分待って 2 つの新しいアイテムを確認）

**影響ファイル**: なし（デプロイのみ）

---

### ステップ 10: API Lambda コンテナをビルドしてプッシュし、デプロイする

**目的**: API Lambda は ECR コンテナイメージを使用する。Terraform がデプロイできるようになる前に、イメージをビルドしてプッシュする必要がある。

**前提条件**: Docker がローカルで実行されており、AWS CLI が設定済みで、ECR リポジトリが作成済みである（前のインフラステップで Terraform が作成）。

**アクション**:

1. ECR リポジトリ URI を取得する:
```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api"
```

2. Docker を ECR に認証する:
```bash
aws ecr get-login-password --region ap-northeast-1 \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com"
```

3. イメージをビルドしてプッシュする（Lambda 用に `--platform linux/amd64` を使用すること）:
```bash
cd /Users/riku/Work/smarthome/lambda/api
docker build --platform linux/amd64 -t smarthome-sensor-api:latest .
docker tag smarthome-sensor-api:latest "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"
```

4. Terragrunt で API Lambda をデプロイする:
```bash
export SWITCHBOT_DEVICE_ID="<your device id>"

cd /Users/riku/Work/smarthome/terraform/environments/prod/lambda-api
terragrunt apply
```

5. Terraform の出力から Lambda Function URL を取得する:
```bash
terragrunt output function_url
```

6. 各エンドポイントをテストする:
```bash
FUNC_URL=$(terragrunt output -raw function_url)
curl "${FUNC_URL}/health"
curl "${FUNC_URL}/latest"
curl "${FUNC_URL}/data?hours=1"
```

7. CORS ヘッダーが存在することを確認する:
```bash
curl -I -H "Origin: http://localhost:3000" "${FUNC_URL}/health"
# 期待値: access-control-allow-origin: *
```

**完了基準**:
- [ ] Docker イメージが `linux/amd64` 用に正常にビルドされている
- [ ] イメージがエラーなしで ECR にプッシュされている
- [ ] `terragrunt apply` がエラーなしで完了する
- [ ] `GET /health` が `{"status": "ok", ...}` を返す
- [ ] `GET /latest` が単一のセンサーデータアイテムを返す（データがまだない場合は 404）
- [ ] `GET /data?hours=1` が配列を返す（Poller がまだ実行されていない場合は空の可能性あり）
- [ ] レスポンスに CORS ヘッダーが含まれる

**影響ファイル**: なし（デプロイのみ）

---

### ステップ 11: エンドツーエンド検証

**目的**: フロントエンドがデプロイされた API と通信してリアルデータを表示できることを確認する。

**アクション**:

1. フロントエンドの `.env`（または `.env.local`）の `VITE_API_BASE_URL` をステップ 10 の Lambda Function URL に設定する。

2. フロントエンドをローカルで実行する:
```bash
cd /Users/riku/Work/smarthome
npm run dev
```

3. ダッシュボードを開いて確認する:
   - ヘルスインジケーターが「healthy」を表示している
   - 最新のセンサー読み取り値が表示されている
   - データチャートに履歴データが表示されている

4. ブラウザの DevTools > Network タブを開いて確認する:
   - リクエストが Lambda Function URL に向かっている
   - レスポンスが `src/domains/sensor/repository/schemas.ts` の Zod スキーマと一致する有効な JSON である
   - コンソールに CORS エラーがない

**完了基準**:
- [ ] フロントエンドがエラーなしでライブセンサーデータを表示する
- [ ] ブラウザコンソールに CORS エラーがない
- [ ] ネットワークレスポンスが Zod バリデーションを通過する（アプリにエラーがない）
- [ ] リフレッシュで Poller が実行されるにつれてデータが毎分更新されることが確認できる

---

## テスト戦略

### ユニットテスト

**Poller Lambda**
- ファイル: `lambda/poller/tests/test_lambda_function.py`
- 実行コマンド: `cd lambda/poller && pip install -r requirements-dev.txt && pytest tests/ -v --cov=lambda_function`
- カバレッジ目標: 80% 以上
- 主要テストケース:
  1. ハッピーパス: 有効な Switchbot レスポンス → DynamoDB 書き込み
  2. リトライ: 1 回目が失敗し、2 回目が成功
  3. リトライ枯渇: 3 回すべての試行が失敗 → 500 レスポンス
  4. 環境変数の欠如 → 500 レスポンス、Switchbot 呼び出しなし
  5. レスポンスフィールドの欠如 → KeyError → 500
  6. 範囲外の値 → 警告ログ記録、データは書き込まれる
  7. DynamoDB 書き込み失敗 → 500 レスポンス

**API Lambda**
- ファイル: `lambda/api/tests/test_main.py`
- 実行コマンド: `cd lambda/api && pip install -r requirements.txt -r requirements-dev.txt && pytest tests/ -v --cov=main`
- カバレッジ目標: 80% 以上
- 主要テストケース:
  1. `GET /` → 200、`{"status": "ok"}`
  2. `GET /health` → 200
  3. `GET /data?hours=24` → 200、カウント付きリスト
  4. `GET /data?hours=0` → 422（FastAPI バリデーション）
  5. `GET /data?hours=169` → 422
  6. `GET /latest`（データあり）→ 200、単一アイテム
  7. `GET /latest`（テーブル空）→ 404
  8. `/data` での DynamoDB エラー → 500
  9. Decimal → float 変換の確認
  10. 環境変数の欠如 → 設定エラーメッセージ付き 500

### 統合テスト（手動）
ステップ 9〜11 で検証する:
- [ ] Poller Lambda がスケジュール通りに実行されて DynamoDB に書き込む
- [ ] API Lambda が DynamoDB を読み取って正しい形式を返す
- [ ] フロントエンドが API を正常に消費する

### リグレッションチェック
全コード変更後に、既存のフロントエンドテストを実行してリグレッションがないことを確認する:
```bash
npm run test
npm run type-check
npm run lint
```

---

## 既知のリスクと制約

### 技術的リスク

- **リスク**: Dockerfile の `AWS_LWA_INVOKE_MODE=response_stream` がすべての FastAPI レスポンスタイプと互換性がない可能性がある。ストリーミングが問題を引き起こす場合は、この環境変数を削除してデフォルトのバッファモードを使用する。
  - **影響**: 低 — API はストリーミングを必要としない小さな JSON ペイロードを返す
  - **軽減策**: `/data` がおかしなレスポンスを返す場合は、Dockerfile から `AWS_LWA_INVOKE_MODE` を削除して再ビルドする

- **リスク**: Pydantic v2 の `model_config` 移行（ステップ 6）が、他のコードが v1 の `Config` クラスの動作に依存している場合に微妙な挙動の違いをもたらす可能性がある。
  - **影響**: 低 — 変更は `SensorData` に限定されており、`Config` は `json_encoders` のみを設定していたが、これはすでに別の場所で処理されている
  - **軽減策**: この変更後、先に進む前に全 API テストを実行する

- **リスク**: リトライロジックの `time.sleep()` が Lambda の実行時間バジェット（30 秒タイムアウト）内で実行される。3 回のリトライで base_delay=1s の場合、最悪ケースは約 7 秒のスリープ（1 + 2 + 4）＋ 3 × 10 秒のタイムアウト = 約 37 秒となる。これは **30 秒の Lambda タイムアウトを超える**。
  - **影響**: Switchbot API が完全に応答しない場合は高い影響
  - **軽減策**: リトライロジックを追加する際に `fetch_switchbot_data()` のリクエストごとのタイムアウトを 10 秒から 5 秒に削減する。これにより最悪ケースは実際のリクエスト約 22 秒＋スリープ約 7 秒 = 約 29 秒となり、30 秒の制限内に収まる。

- **リスク**: FastAPI テストの TestClient がモジュールレベルで `app` をインポートする。インポート前に環境変数が設定されていない場合、モジュールレベルの起動警告（ステップ 5）がテストで発火する。
  - **影響**: 低 — 警告はテストコンテキストでは無害
  - **軽減策**: テストは `TestClient` をインスタンス化する前に `mocker.patch.dict(os.environ, ...)` を使用する。起動ログの警告はテストで許容できる。

### 制約

- **デプロイ順序**: `lambda-api` Terragrunt apply の前に ECR イメージが存在する必要がある。ECR リポジトリがまだ存在しない場合は、先に `terraform/environments/prod/ecr` を実行するか（存在する場合）、手動で作成する。
- **プラットフォーム制約**: Docker イメージは `--platform linux/amd64` でビルドする必要がある。Apple Silicon（M1/M2/M3）の開発者はこのフラグを含めなければならない。含めないと Lambda がアーキテクチャミスマッチエラーでクラッシュする。
- **Switchbot リクエストタイムアウト**: ステップ 2 でリトライロジックを Lambda タイムアウトバジェット内に収めるために 10 秒から 5 秒に削減する（上記リスク参照）。
- **単一デバイスのみ**: この計画全体が単一の `DEVICE_ID` にスコープされている。マルチデバイスサポートは MVP の明示的なスコープ外である。

---

## 検討された代替アプローチ

### リトライ実装: 外部ライブラリ vs 手動実装

**オプション A: `tenacity` ライブラリをリトライに使用する**
- メリット: 実績あり、豊富なデコレーター API、組み込みジッター
- デメリット: 依存関係の追加、Lambda ZIP サイズの増加、3 回のリトライには過剰
- 判断: 選択しない。手動リトライループは約 15 行で、Lambda パッケージへの依存関係追加を回避できる。

**オプション B: 手動指数バックオフ（選択）**
- メリット: 新しい依存関係なし、透明な動作、テストが容易
- デメリット: 保守するコードが増える
- 判断: 選択。リトライロジックが十分シンプル（3 回の試行、固定式）なため、手動ループのほうがクリーン。

### ログ: Python `logging` モジュール vs カスタム StructuredLogger

**オプション A: JSON フォーマッターを持つ標準 `logging`**
- メリット: 業界標準、ログアグリゲーターと統合
- デメリット: カスタム Formatter クラスの設定が必要；Lambda のデフォルトハンドラーが傍受する可能性がある
- 判断: MVP では選択しない。Lambda のログ環境は特有（stdout vs stderr vs logging モジュール）。

**オプション B: JSON を stdout に出力するカスタム StructuredLogger（選択）**
- メリット: Lambda は常に stdout を CloudWatch にキャプチャする；シンプルで明示的；設定の驚きがない
- デメリット: 標準 Python ログエコシステムと互換性がない
- 判断: 選択。CloudWatch は stdout を確実にキャプチャする。MVP ではこれが最も予測可能なアプローチ。フェーズ 2 で `python-json-logger` に移行できる。

---

## 実装後のタスク

- [ ] `ARCHITECTURE.md` を実際の Lambda バックエンドを反映するように更新する（現在は将来のバックエンドを記述しており、現在のものではない）
- [ ] この計画を `docs/exec-plans/completed/lambda-implementation/` に移動する
- [ ] `docs/exec-plans/completed/lambda-implementation/retrospective.md` に振り返りドキュメントを作成する
- [ ] `docs/exec-plans/tech-debt-tracker.md` に以下を追記する:
  - StructuredLogger を `python-json-logger` に移行する（フェーズ 2）
  - Poller の失敗率に対する CloudWatch アラームを追加する（フェーズ 2）
  - Switchbot のリクエストタイムアウトが 5 秒にハードコードされている（環境変数で設定可能にすべき）
- [ ] ECR ライフサイクルポリシーがイメージ数を制限するよう設定されていることを確認する（コスト管理）

---

## ファイルサマリー

| ファイル | アクション | ステップ |
|---|---|---|
| `lambda/poller/lambda_function.py` | 変更 | ステップ 1〜4 |
| `lambda/api/main.py` | 変更 | ステップ 5〜6 |
| `lambda/api/models/sensor.py` | 変更 | ステップ 6 |
| `lambda/poller/tests/__init__.py` | 新規 | ステップ 7 |
| `lambda/poller/requirements-dev.txt` | 新規 | ステップ 7 |
| `lambda/poller/tests/test_lambda_function.py` | 新規 | ステップ 7 |
| `lambda/api/tests/__init__.py` | 新規 | ステップ 8 |
| `lambda/api/requirements-dev.txt` | 新規 | ステップ 8 |
| `lambda/api/tests/test_main.py` | 新規 | ステップ 8 |
