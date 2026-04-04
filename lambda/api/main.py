"""
FastAPI application for Smarthome Sensor Dashboard
Lambda Web Adapter enabled
"""
import os
import json
import logging
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import boto3
from decimal import Decimal
import time

from models.sensor import SensorData, SensorDataCreate, SensorDataResponse, HealthCheckResponse


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


logger = StructuredLogger("api")

# FastAPI アプリ
app = FastAPI(
    title="Smarthome Sensor API",
    description="Switchbot温湿度CO2センサーデータAPI",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS ミドルウェア
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DynamoDB クライアント
dynamodb = boto3.resource('dynamodb')

# 環境変数が設定されていない場合の早期警告（リクエスト時にも失敗する）
_startup_device_id = os.environ.get('DEVICE_ID', '')
_startup_table_name = os.environ.get('TABLE_NAME', '')
if not _startup_device_id or not _startup_table_name:
    logger.warning(
        "DEVICE_ID or TABLE_NAME not set at startup",
        device_id_set=bool(_startup_device_id),
        table_name_set=bool(_startup_table_name)
    )


def decimal_to_float(obj):
    """Decimal を float に変換する"""
    if isinstance(obj, Decimal):
        return float(obj)
    return obj


def _get_required_env_vars() -> tuple[str, str]:
    """
    必須環境変数 DEVICE_ID と TABLE_NAME を取得する。
    未設定の場合はエラーログを出力し HTTPException(500) を送出する。
    """
    device_id = os.environ.get('DEVICE_ID')
    table_name = os.environ.get('TABLE_NAME')

    if not device_id or not table_name:
        missing = [k for k, v in {'DEVICE_ID': device_id, 'TABLE_NAME': table_name}.items() if not v]
        logger.error("Missing env vars", missing=missing)
        raise HTTPException(
            status_code=500,
            detail="Server configuration error: DEVICE_ID or TABLE_NAME not set"
        )

    return device_id, table_name



@app.get("/", response_model=HealthCheckResponse)
async def root():
    """
    ヘルスチェックエンドポイント
    """
    return HealthCheckResponse(
        status="ok",
        message="Smarthome Sensor API is running"
    )


@app.get("/health", response_model=HealthCheckResponse)
async def health_check():
    """
    ヘルスチェックエンドポイント（/ のエイリアス）
    """
    return HealthCheckResponse(
        status="ok",
        message="Healthy"
    )


@app.get("/data", response_model=SensorDataResponse)
async def get_sensor_data(
    hours: int = Query(
        default=24,
        ge=1,
        le=168,
        description="取得する時間範囲（時間）。1-168時間の範囲で指定。"
    )
):
    """
    センサーデータを取得

    指定された時間範囲のセンサーデータを取得します。

    - **hours**: 取得する時間範囲（1-168時間、デフォルト24時間）
    """
    device_id, table_name = _get_required_env_vars()

    logger.info("Fetching sensor data", hours=hours, device_id=device_id)

    try:
        # 取得開始時刻を計算する
        start_time = int((time.time() - hours * 3600) * 1000)

        # DynamoDB クエリ
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

        # Decimal を Python 型に変換する（humidity・co2 は int に明示変換）
        converted_items = []
        for item in items:
            converted_item = {
                'deviceId': item['deviceId'],
                'timestamp': item['timestamp'],
                'temperature': decimal_to_float(item['temperature']),
                'humidity': int(decimal_to_float(item['humidity'])),
                'co2': int(decimal_to_float(item['co2']))
            }
            converted_items.append(SensorData(**converted_item))

        return SensorDataResponse(
            data=converted_items,
            count=len(converted_items)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("DynamoDB query failed", error=str(e), endpoint="/data")
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching data: {str(e)}"
        )


@app.get("/latest", response_model=SensorData)
async def get_latest_data():
    """
    最新のセンサーデータを1件取得

    最も新しいセンサーデータを返します。
    """
    device_id, table_name = _get_required_env_vars()

    logger.info("Fetching latest sensor data", device_id=device_id)

    try:
        # 最新データをクエリする
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
            logger.info("No data found for device", device_id=device_id)
            raise HTTPException(
                status_code=404,
                detail="No data found"
            )

        item = items[0]
        converted_item = {
            'deviceId': item['deviceId'],
            'timestamp': item['timestamp'],
            'temperature': decimal_to_float(item['temperature']),
            'humidity': int(decimal_to_float(item['humidity'])),  # 既存 float レコードも安全に int へ変換
            'co2': int(item['co2'])
        }
        return SensorData(**converted_item)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("DynamoDB query failed", error=str(e), endpoint="/latest")
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching latest data: {str(e)}"
        )


@app.post("/data", response_model=SensorData, status_code=201)
async def create_sensor_data(data: SensorDataCreate) -> SensorData:
    """
    センサーデータを DynamoDB に保存

    Raspberry Pi の BLE スキャン結果を受け取り、DynamoDB に保存します。
    IAM Function URL レベルで SigV4 認証済みのリクエストのみ到達します。
    timestamp と expiresAt はサーバー側で生成します。

    - **deviceId**: デバイス ID
    - **temperature**: 温度 (°C)
    - **humidity**: 湿度 (%)
    - **co2**: CO2 濃度 (ppm)
    """
    # POST /data は deviceId をリクエストから受け取るため TABLE_NAME のみ必要
    table_name = os.environ.get('TABLE_NAME')
    if not table_name:
        logger.error("Missing env var", missing=["TABLE_NAME"])
        raise HTTPException(
            status_code=500,
            detail="Server configuration error: TABLE_NAME not set"
        )

    # サーバー側でタイムスタンプを生成（同一の time.time() から計算し一貫性を保証）
    now = time.time()
    current_time = int(now * 1000)                    # ミリ秒
    expires_at = int(now) + 30 * 24 * 60 * 60         # 30日後 UNIX 秒

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


# ローカル開発用
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
