"""
Lambda Poller for Switchbot Sensor Data
Periodically fetches data from Switchbot API and stores in DynamoDB
"""
import os
import time
import hashlib
import hmac
import base64
import uuid
import json
import random
import logging
import requests
import boto3
from decimal import Decimal


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

dynamodb = boto3.resource('dynamodb')


def lambda_handler(event, context):
    """
    Lambda ハンドラー関数
    EventBridge によって2分ごとにトリガーされる
    """
    # 環境変数の検証（APIコール前に必須変数をすべて確認する）
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

    logger.info("Poller invoked", device_id=device_id)

    try:
        # Switchbot API からデータを取得（指数バックオフリトライ付き）
        sensor_data = _fetch_with_retry(token, secret, device_id)

        # センサーデータのバリデーション
        _validate_sensor_data(sensor_data, device_id)

        # DynamoDB に保存
        save_to_dynamodb(table_name, device_id, sensor_data)

        logger.info("Data saved to DynamoDB", device_id=device_id, timestamp=int(time.time() * 1000))
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Data saved successfully',
                'data': {k: float(v) if isinstance(v, Decimal) else v for k, v in sensor_data.items()}
            })
        }

    except Exception as e:
        logger.error("Unexpected error", error=str(e), device_id=device_id)
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': 'Error occurred',
                'error': str(e)
            })
        }


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


def fetch_switchbot_data(token: str, secret: str, device_id: str) -> dict:
    """
    HMAC-SHA256 認証を使用して Switchbot API からセンサーデータを取得する
    """
    # 認証ヘッダーを生成する
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

    # API リクエスト（タイムアウトは環境変数 SWITCHBOT_TIMEOUT_SECONDS で設定可能、デフォルト 5s）
    # Lambda タイムアウト 30s のため: リトライ 3 回 × 最大 9s + 処理時間 = 余裕を持って 5s
    request_timeout = int(os.environ.get('SWITCHBOT_TIMEOUT_SECONDS', '5'))
    url = f"https://api.switch-bot.com/v1.1/devices/{device_id}/status"
    headers = {
        'Authorization': token,
        't': timestamp,
        'sign': sign,
        'nonce': nonce
    }

    response = requests.get(url, headers=headers, timeout=request_timeout)
    data = response.json()

    # レスポンスのステータスコードを確認する
    # Switchbot API statusCode: 100=成功、101=認証エラー、102=デバイス無効、
    # 103=パラメータエラー、105=レート制限、109=メンテナンス
    if data.get('statusCode') != 100:
        raise Exception(f"Switchbot API error: statusCode={data.get('statusCode')}, message={data.get('message')}")

    return data['body']


def save_to_dynamodb(table_name: str, device_id: str, sensor_data: dict):
    """
    センサーデータを DynamoDB に保存する。
    _validate_sensor_data() がフィールドの存在を保証するため、直接辞書アクセスを使用する。
    """
    table = dynamodb.Table(table_name)
    current_time = int(time.time() * 1000)
    expires_at = int(time.time()) + 30 * 24 * 60 * 60  # 30日後（TTL）

    item = {
        'deviceId': device_id,
        'timestamp': current_time,
        'temperature': Decimal(str(sensor_data['temperature'])),
        'humidity': Decimal(str(sensor_data['humidity'])),
        'co2': sensor_data['CO2'],
        'expiresAt': expires_at
    }

    table.put_item(Item=item)
