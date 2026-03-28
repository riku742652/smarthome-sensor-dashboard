"""
Pydantic models for sensor data
"""
from pydantic import BaseModel, Field
from typing import List
from decimal import Decimal


class SensorData(BaseModel):
    """Sensor data model"""
    deviceId: str = Field(..., description="Device ID")
    timestamp: int = Field(..., description="Unix timestamp in milliseconds")
    temperature: float = Field(..., description="Temperature in Celsius")
    humidity: float = Field(..., description="Humidity percentage")
    co2: int = Field(..., description="CO2 concentration in ppm")

    class Config:
        # Serialize Decimal as float
        json_encoders = {
            Decimal: float
        }


class SensorDataResponse(BaseModel):
    """Response model for sensor data list"""
    data: List[SensorData] = Field(..., description="List of sensor data")
    count: int = Field(..., description="Number of items")


class HealthCheckResponse(BaseModel):
    """Health check response"""
    status: str = Field(..., description="Health status")
    message: str = Field(..., description="Status message")
