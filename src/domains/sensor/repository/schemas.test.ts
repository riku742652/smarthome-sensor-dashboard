import { describe, it, expect } from 'vitest'
import { SensorDataSchema, SensorDataResponseSchema } from './schemas'
import { mockSensorData, mockSensorDataResponse } from '@/test/utils/mockData'

describe('SensorDataSchema', () => {
  it('should validate valid sensor data', () => {
    const result = SensorDataSchema.safeParse(mockSensorData)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(mockSensorData)
    }
  })

  it('should reject missing deviceId', () => {
    const invalidData = {
      timestamp: 1700000000000,
      temperature: 25.5,
      humidity: 60.0,
      co2: 800,
    }

    const result = SensorDataSchema.safeParse(invalidData)

    expect(result.success).toBe(false)
  })

  it('should reject invalid timestamp (negative)', () => {
    const invalidData = {
      ...mockSensorData,
      timestamp: -1,
    }

    const result = SensorDataSchema.safeParse(invalidData)

    expect(result.success).toBe(false)
  })

  it('should reject invalid timestamp (zero)', () => {
    const invalidData = {
      ...mockSensorData,
      timestamp: 0,
    }

    const result = SensorDataSchema.safeParse(invalidData)

    expect(result.success).toBe(false)
  })

  it('should reject invalid timestamp (non-integer)', () => {
    const invalidData = {
      ...mockSensorData,
      timestamp: 1700000000000.5,
    }

    const result = SensorDataSchema.safeParse(invalidData)

    expect(result.success).toBe(false)
  })

  describe('temperature validation', () => {
    it('should accept temperature within valid range', () => {
      const validTemps = [-50, -10, 0, 25, 50, 100]

      validTemps.forEach((temp) => {
        const data = { ...mockSensorData, temperature: temp }
        const result = SensorDataSchema.safeParse(data)
        expect(result.success).toBe(true)
      })
    })

    it('should reject temperature below minimum (-50)', () => {
      const invalidData = {
        ...mockSensorData,
        temperature: -51,
      }

      const result = SensorDataSchema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should reject temperature above maximum (100)', () => {
      const invalidData = {
        ...mockSensorData,
        temperature: 101,
      }

      const result = SensorDataSchema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should accept decimal temperature values', () => {
      const data = { ...mockSensorData, temperature: 25.567 }
      const result = SensorDataSchema.safeParse(data)

      expect(result.success).toBe(true)
    })
  })

  describe('humidity validation', () => {
    it('should accept humidity within valid range', () => {
      const validHumidities = [0, 25, 50, 75, 100]

      validHumidities.forEach((humidity) => {
        const data = { ...mockSensorData, humidity }
        const result = SensorDataSchema.safeParse(data)
        expect(result.success).toBe(true)
      })
    })

    it('should reject humidity below minimum (0)', () => {
      const invalidData = {
        ...mockSensorData,
        humidity: -0.1,
      }

      const result = SensorDataSchema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should reject humidity above maximum (100)', () => {
      const invalidData = {
        ...mockSensorData,
        humidity: 100.1,
      }

      const result = SensorDataSchema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })
  })

  describe('CO2 validation', () => {
    it('should accept CO2 within valid range', () => {
      const validCO2s = [0, 400, 800, 1500, 5000, 10000]

      validCO2s.forEach((co2) => {
        const data = { ...mockSensorData, co2 }
        const result = SensorDataSchema.safeParse(data)
        expect(result.success).toBe(true)
      })
    })

    it('should reject CO2 below minimum (0)', () => {
      const invalidData = {
        ...mockSensorData,
        co2: -1,
      }

      const result = SensorDataSchema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should reject CO2 above maximum (10000)', () => {
      const invalidData = {
        ...mockSensorData,
        co2: 10001,
      }

      const result = SensorDataSchema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should reject non-integer CO2 values', () => {
      const invalidData = {
        ...mockSensorData,
        co2: 800.5,
      }

      const result = SensorDataSchema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })
  })
})

describe('SensorDataResponseSchema', () => {
  it('should validate valid response data', () => {
    const result = SensorDataResponseSchema.safeParse(mockSensorDataResponse)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(mockSensorDataResponse)
    }
  })

  it('should reject missing data array', () => {
    const invalidResponse = {
      count: 0,
    }

    const result = SensorDataResponseSchema.safeParse(invalidResponse)

    expect(result.success).toBe(false)
  })

  it('should reject missing count', () => {
    const invalidResponse = {
      data: [mockSensorData],
    }

    const result = SensorDataResponseSchema.safeParse(invalidResponse)

    expect(result.success).toBe(false)
  })

  it('should accept empty data array', () => {
    const emptyResponse = {
      data: [],
      count: 0,
    }

    const result = SensorDataResponseSchema.safeParse(emptyResponse)

    expect(result.success).toBe(true)
  })

  it('should reject negative count', () => {
    const invalidResponse = {
      data: [],
      count: -1,
    }

    const result = SensorDataResponseSchema.safeParse(invalidResponse)

    expect(result.success).toBe(false)
  })

  it('should reject non-integer count', () => {
    const invalidResponse = {
      data: [mockSensorData],
      count: 1.5,
    }

    const result = SensorDataResponseSchema.safeParse(invalidResponse)

    expect(result.success).toBe(false)
  })

  it('should reject invalid sensor data in array', () => {
    const invalidResponse = {
      data: [
        {
          ...mockSensorData,
          temperature: 150, // Invalid
        },
      ],
      count: 1,
    }

    const result = SensorDataResponseSchema.safeParse(invalidResponse)

    expect(result.success).toBe(false)
  })

  it('should validate multiple sensor data items', () => {
    const multiResponse = {
      data: [
        mockSensorData,
        { ...mockSensorData, timestamp: 1700000060000 },
        { ...mockSensorData, timestamp: 1700000120000 },
      ],
      count: 3,
    }

    const result = SensorDataResponseSchema.safeParse(multiResponse)

    expect(result.success).toBe(true)
  })
})
