"""
Pydantic models for sensor data
"""
from pydantic import BaseModel, Field, ConfigDict
from typing import List


class SensorData(BaseModel):
    """センサーデータモデル"""
    # Pydantic v2: class Config の代わりに model_config を使用する
    model_config = ConfigDict(populate_by_name=True)

    deviceId: str = Field(..., description="Device ID")
    timestamp: int = Field(..., description="Unix timestamp in milliseconds")
    temperature: float = Field(..., description="Temperature in Celsius")
    humidity: float = Field(..., description="Humidity percentage")
    co2: int = Field(..., description="CO2 concentration in ppm")


class SensorDataResponse(BaseModel):
    """センサーデータリストのレスポンスモデル"""
    data: List[SensorData] = Field(..., description="List of sensor data")
    count: int = Field(..., description="Number of items")


class HealthCheckResponse(BaseModel):
    """ヘルスチェックレスポンス"""
    status: str = Field(..., description="Health status")
    message: str = Field(..., description="Status message")
