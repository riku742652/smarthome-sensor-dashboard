"""
FastAPI application for Smarthome Sensor Dashboard
Lambda Web Adapter enabled
"""
import os
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import boto3
from decimal import Decimal
from typing import Optional
import time

from models.sensor import SensorData, SensorDataResponse, HealthCheckResponse

# FastAPI app
app = FastAPI(
    title="Smarthome Sensor API",
    description="Switchbot温湿度CO2センサーデータAPI",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DynamoDB client
dynamodb = boto3.resource('dynamodb')


def decimal_to_float(obj):
    """Convert Decimal to float"""
    if isinstance(obj, Decimal):
        return float(obj)
    return obj


@app.get("/", response_model=HealthCheckResponse)
async def root():
    """
    Health check endpoint
    """
    return HealthCheckResponse(
        status="ok",
        message="Smarthome Sensor API is running"
    )


@app.get("/health", response_model=HealthCheckResponse)
async def health_check():
    """
    Health check endpoint (alias for /)
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
    try:
        device_id = os.environ.get('DEVICE_ID')
        table_name = os.environ.get('TABLE_NAME')

        if not device_id or not table_name:
            raise HTTPException(
                status_code=500,
                detail="Server configuration error: DEVICE_ID or TABLE_NAME not set"
            )

        # Calculate start time
        start_time = int((time.time() - hours * 3600) * 1000)

        # Query DynamoDB
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
            ScanIndexForward=True  # Oldest first
        )

        items = response.get('Items', [])

        # Convert Decimal to float
        converted_items = []
        for item in items:
            converted_item = {
                'deviceId': item['deviceId'],
                'timestamp': item['timestamp'],
                'temperature': decimal_to_float(item['temperature']),
                'humidity': decimal_to_float(item['humidity']),
                'co2': item['co2']
            }
            converted_items.append(SensorData(**converted_item))

        return SensorDataResponse(
            data=converted_items,
            count=len(converted_items)
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching data: {str(e)}"
        )


@app.get("/latest")
async def get_latest_data():
    """
    最新のセンサーデータを1件取得

    最も新しいセンサーデータを返します。
    """
    try:
        device_id = os.environ.get('DEVICE_ID')
        table_name = os.environ.get('TABLE_NAME')

        if not device_id or not table_name:
            raise HTTPException(
                status_code=500,
                detail="Server configuration error"
            )

        # Query latest data
        table = dynamodb.Table(table_name)
        response = table.query(
            KeyConditionExpression='deviceId = :deviceId',
            ExpressionAttributeValues={
                ':deviceId': device_id
            },
            ScanIndexForward=False,  # Newest first
            Limit=1
        )

        items = response.get('Items', [])
        if not items:
            raise HTTPException(
                status_code=404,
                detail="No data found"
            )

        item = items[0]
        return {
            'deviceId': item['deviceId'],
            'timestamp': item['timestamp'],
            'temperature': decimal_to_float(item['temperature']),
            'humidity': decimal_to_float(item['humidity']),
            'co2': item['co2']
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching latest data: {str(e)}"
        )


# For local development
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
