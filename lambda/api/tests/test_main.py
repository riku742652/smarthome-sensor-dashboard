"""
API Lambda のユニットテスト
FastAPI TestClient と pytest-mock を使用して全エンドポイントとエラーパスをカバーする
"""
import os
import sys
import pytest
from decimal import Decimal
from unittest.mock import patch

# テスト実行時に main をインポートできるようにパスを追加する
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# 環境変数をセットしてからインポートする（モジュールレベルの起動バリデーション警告を抑制）
os.environ.setdefault('DEVICE_ID', 'test-device')
os.environ.setdefault('TABLE_NAME', 'test-table')

from fastapi.testclient import TestClient
from main import app


# ============================================================
# フィクスチャ
# ============================================================

def make_sensor_item(temp=22.5, humidity=45.0, co2=800):
    """テスト用センサーデータアイテムを作成するヘルパー"""
    return {
        'deviceId': 'test-device',
        'timestamp': 1706745600000,
        'temperature': Decimal(str(temp)),
        'humidity': Decimal(str(humidity)),
        'co2': co2
    }


@pytest.fixture
def client(mocker):
    """モックされた環境変数と DynamoDB を持つ TestClient を作成する。"""
    mocker.patch.dict(os.environ, {
        'DEVICE_ID': 'test-device',
        'TABLE_NAME': 'test-table',
    })
    with patch('main.dynamodb') as mock_db:
        yield TestClient(app), mock_db


# ============================================================
# TestHealthEndpoints
# ============================================================

class TestHealthEndpoints:
    """ヘルスチェックエンドポイントのテスト"""

    def test_root_returns_ok(self, client):
        """GET / が status=ok を返す。"""
        tc, _ = client
        response = tc.get("/")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_root_returns_message(self, client):
        """GET / がメッセージフィールドを持つ。"""
        tc, _ = client
        response = tc.get("/")
        assert "message" in response.json()

    def test_health_returns_ok(self, client):
        """GET /health が status=ok を返す。"""
        tc, _ = client
        response = tc.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_health_returns_message(self, client):
        """GET /health がメッセージフィールドを持つ。"""
        tc, _ = client
        response = tc.get("/health")
        assert "message" in response.json()


# ============================================================
# TestDataEndpoint
# ============================================================

class TestDataEndpoint:
    """GET /data エンドポイントのテスト"""

    def test_get_data_returns_sensor_list(self, client):
        """センサーデータリストを正しく返す。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {
            'Items': [make_sensor_item()]
        }
        response = tc.get("/data?hours=24")
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["data"][0]["temperature"] == 22.5
        assert body["data"][0]["humidity"] == 45
        assert body["data"][0]["co2"] == 800

    def test_get_data_empty_result(self, client):
        """データなしの場合は count=0 を返す。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {'Items': []}
        response = tc.get("/data?hours=24")
        assert response.status_code == 200
        assert response.json()["count"] == 0
        assert response.json()["data"] == []

    def test_get_data_default_hours(self, client):
        """デフォルト hours=24 でもリクエストが成功する。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {'Items': []}
        response = tc.get("/data")
        assert response.status_code == 200

    def test_get_data_hours_below_min(self, client):
        """hours=0 は FastAPI バリデーションエラー 422 を返す。"""
        tc, _ = client
        response = tc.get("/data?hours=0")
        assert response.status_code == 422

    def test_get_data_hours_above_max(self, client):
        """hours=169 は FastAPI バリデーションエラー 422 を返す。"""
        tc, _ = client
        response = tc.get("/data?hours=169")
        assert response.status_code == 422

    def test_get_data_hours_min_boundary(self, client):
        """hours=1 は有効な境界値。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {'Items': []}
        response = tc.get("/data?hours=1")
        assert response.status_code == 200

    def test_get_data_hours_max_boundary(self, client):
        """hours=168 は有効な境界値。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {'Items': []}
        response = tc.get("/data?hours=168")
        assert response.status_code == 200

    def test_get_data_dynamodb_error(self, client):
        """DynamoDB エラーが 500 とエラーメッセージを返す。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.side_effect = Exception("DynamoDB error")
        response = tc.get("/data?hours=24")
        assert response.status_code == 500
        assert "Error fetching data" in response.json()["detail"]

    def test_get_data_decimal_conversion(self, client):
        """DynamoDB からの Decimal 値が文字列ではなく float としてシリアライズされる。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {
            'Items': [make_sensor_item(temp=Decimal('22.567'))]
        }
        response = tc.get("/data?hours=1")
        assert response.status_code == 200
        temp = response.json()["data"][0]["temperature"]
        assert isinstance(temp, float)

    def test_get_data_multiple_items(self, client):
        """複数アイテムが正しく返される。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {
            'Items': [make_sensor_item(temp=22.0), make_sensor_item(temp=23.0)]
        }
        response = tc.get("/data?hours=24")
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 2
        assert len(body["data"]) == 2


# ============================================================
# TestLatestEndpoint
# ============================================================

class TestLatestEndpoint:
    """GET /latest エンドポイントのテスト"""

    def test_get_latest_returns_single_item(self, client):
        """最新データを 1 件返す。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {
            'Items': [make_sensor_item()]
        }
        response = tc.get("/latest")
        assert response.status_code == 200
        body = response.json()
        assert "deviceId" in body
        assert "timestamp" in body
        assert "temperature" in body
        assert "humidity" in body
        assert "co2" in body

    def test_get_latest_no_data_returns_404(self, client):
        """データなしの場合は 404 を返す。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {'Items': []}
        response = tc.get("/latest")
        assert response.status_code == 404

    def test_get_latest_dynamodb_error(self, client):
        """DynamoDB エラーが 500 を返す。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.side_effect = Exception("DynamoDB error")
        response = tc.get("/latest")
        assert response.status_code == 500

    def test_get_latest_response_model_fields(self, client):
        """レスポンスが SensorData モデルのフィールドを持つ。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {
            'Items': [make_sensor_item(temp=25.0, humidity=60.0, co2=1000)]
        }
        response = tc.get("/latest")
        assert response.status_code == 200
        body = response.json()
        assert body["temperature"] == 25.0
        assert body["humidity"] == 60
        assert body["co2"] == 1000

    def test_get_latest_decimal_conversion(self, client):
        """DynamoDB からの Decimal 値が float としてシリアライズされる。"""
        tc, mock_db = client
        mock_db.Table.return_value.query.return_value = {
            'Items': [make_sensor_item(temp=Decimal('22.567'))]
        }
        response = tc.get("/latest")
        assert response.status_code == 200
        temp = response.json()["temperature"]
        assert isinstance(temp, float)


# ============================================================
# TestMissingEnvVars
# ============================================================

class TestMissingEnvVars:
    """環境変数が欠けている場合のテスト"""

    def test_data_endpoint_missing_device_id(self, mocker):
        """DEVICE_ID が欠けている場合に /data が 500 を返す。"""
        mocker.patch.dict(os.environ, {'TABLE_NAME': 'tbl'}, clear=True)
        with patch('main.dynamodb'):
            tc = TestClient(app)
            response = tc.get("/data")
        assert response.status_code == 500
        assert "configuration error" in response.json()["detail"].lower()

    def test_data_endpoint_missing_table_name(self, mocker):
        """TABLE_NAME が欠けている場合に /data が 500 を返す。"""
        mocker.patch.dict(os.environ, {'DEVICE_ID': 'dev'}, clear=True)
        with patch('main.dynamodb'):
            tc = TestClient(app)
            response = tc.get("/data")
        assert response.status_code == 500

    def test_latest_endpoint_missing_device_id(self, mocker):
        """DEVICE_ID が欠けている場合に /latest が 500 を返す。"""
        mocker.patch.dict(os.environ, {'TABLE_NAME': 'tbl'}, clear=True)
        with patch('main.dynamodb'):
            tc = TestClient(app)
            response = tc.get("/latest")
        assert response.status_code == 500

    def test_latest_endpoint_missing_table_name(self, mocker):
        """TABLE_NAME が欠けている場合に /latest が 500 を返す。"""
        mocker.patch.dict(os.environ, {'DEVICE_ID': 'dev'}, clear=True)
        with patch('main.dynamodb'):
            tc = TestClient(app)
            response = tc.get("/latest")
        assert response.status_code == 500


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
        payload = {"temperature": 22.5, "humidity": 45, "co2": 800}
        response = tc.post("/data", json=payload, )
        assert response.status_code == 422

    def test_post_data_missing_temperature_returns_422(self, client):
        """temperature が欠けている場合は 422 を返す。"""
        tc, mock_db = client
        payload = {"deviceId": "test-device", "humidity": 45, "co2": 800}
        response = tc.post("/data", json=payload, )
        assert response.status_code == 422

    def test_post_data_missing_co2_returns_422(self, client):
        """co2 が欠けている場合は 422 を返す。"""
        tc, mock_db = client
        payload = {"deviceId": "test-device", "temperature": 22.5, "humidity": 45}
        response = tc.post("/data", json=payload, )
        assert response.status_code == 422

    def test_post_data_invalid_temperature_type_returns_422(self, client):
        """temperature が文字列の場合は 422 を返す。"""
        tc, mock_db = client
        payload = {**self.VALID_PAYLOAD, "temperature": "invalid"}
        response = tc.post("/data", json=payload, )
        assert response.status_code == 422

    def test_post_data_dynamodb_error_returns_500(self, client):
        """DynamoDB エラーで 500 とエラーメッセージを返す。"""
        tc, mock_db = client
        mock_db.Table.return_value.put_item.side_effect = Exception("DynamoDB error")
        response = tc.post("/data", json=self.VALID_PAYLOAD, )
        assert response.status_code == 500
        assert "Error saving data" in response.json()["detail"]

    def test_post_data_missing_table_name_returns_500(self, mocker):
        """TABLE_NAME が欠けている場合に 500 を返す。"""
        mocker.patch.dict(os.environ, {}, clear=True)
        with patch('main.dynamodb'):
            tc = TestClient(app)
            response = tc.post("/data", json={
                "deviceId": "dev",
                "temperature": 22.5,
                "humidity": 45,
                "co2": 800,
            }, )
        assert response.status_code == 500

    def test_post_data_negative_temperature(self, client):
        """負の温度値（冬場など）が正常に保存される。"""
        tc, mock_db = client
        mock_db.Table.return_value.put_item.return_value = {}
        payload = {**self.VALID_PAYLOAD, "temperature": -5.0}
        response = tc.post("/data", json=payload, )
        assert response.status_code == 201
        assert response.json()["temperature"] == -5.0
