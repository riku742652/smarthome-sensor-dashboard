import type { SensorData, SensorDataResponse } from '@domains/sensor/types'

export const mockSensorData: SensorData = {
  deviceId: 'test-device-123',
  timestamp: 1700000000000,
  temperature: 25.5,
  humidity: 60.0,
  co2: 800,
}

export const mockSensorDataResponse: SensorDataResponse = {
  data: [
    mockSensorData,
    {
      ...mockSensorData,
      timestamp: 1700000060000,
      temperature: 25.6,
    },
    {
      ...mockSensorData,
      timestamp: 1700000120000,
      temperature: 25.7,
    },
  ],
  count: 3,
}
