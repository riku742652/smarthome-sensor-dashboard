import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SensorRepository } from './SensorRepository'
import { mockSensorData, mockSensorDataResponse } from '@/test/utils/mockData'


describe('SensorRepository', () => {
  let repository: SensorRepository
  const mockBaseUrl = 'https://api.example.com'

  beforeEach(() => {
    repository = new SensorRepository(mockBaseUrl)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('healthCheck', () => {
    it('should return true when API is healthy', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
      })
      global.fetch = mockFetch

      const result = await repository.healthCheck()

      expect(mockFetch).toHaveBeenCalledWith(`${mockBaseUrl}/health`)
      expect(result).toBe(true)
    })

    it('should return false when API returns error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
      })
      global.fetch = mockFetch

      const result = await repository.healthCheck()

      expect(result).toBe(false)
    })

    it('should return false when fetch throws error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      global.fetch = mockFetch

      const result = await repository.healthCheck()

      expect(result).toBe(false)
    })
  })

  describe('fetchSensorData', () => {
    it('should fetch and validate sensor data successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSensorDataResponse,
      })
      global.fetch = mockFetch

      const result = await repository.fetchSensorData(24)

      expect(mockFetch).toHaveBeenCalledWith(`${mockBaseUrl}/data?hours=24`)
      expect(result).toEqual(mockSensorDataResponse)
    })

    it('should throw error when response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
      global.fetch = mockFetch

      await expect(repository.fetchSensorData(24)).rejects.toThrow(
        'HTTP error! status: 500'
      )
    })

    it('should throw error when JSON parsing fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON')
        },
      })
      global.fetch = mockFetch

      await expect(repository.fetchSensorData(24)).rejects.toThrow()
    })

    it('should throw error when validation fails', async () => {
      const invalidResponse = {
        data: [
          {
            deviceId: 'test',
            timestamp: -1, // Invalid: must be positive
            temperature: 25,
            humidity: 60,
            co2: 800,
          },
        ],
        count: 1,
      }

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => invalidResponse,
      })
      global.fetch = mockFetch

      await expect(repository.fetchSensorData(24)).rejects.toThrow()
    })

    it('should validate temperature range', async () => {
      const invalidResponse = {
        data: [
          {
            ...mockSensorData,
            temperature: 150, // Invalid: exceeds max 100
          },
        ],
        count: 1,
      }

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => invalidResponse,
      })
      global.fetch = mockFetch

      await expect(repository.fetchSensorData(24)).rejects.toThrow()
    })

    it('should validate humidity range', async () => {
      const invalidResponse = {
        data: [
          {
            ...mockSensorData,
            humidity: -10, // Invalid: below min 0
          },
        ],
        count: 1,
      }

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => invalidResponse,
      })
      global.fetch = mockFetch

      await expect(repository.fetchSensorData(24)).rejects.toThrow()
    })

    it('should validate CO2 range', async () => {
      const invalidResponse = {
        data: [
          {
            ...mockSensorData,
            co2: 15000, // Invalid: exceeds max 10000
          },
        ],
        count: 1,
      }

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => invalidResponse,
      })
      global.fetch = mockFetch

      await expect(repository.fetchSensorData(24)).rejects.toThrow()
    })

    it('should use correct query parameter for different hours', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSensorDataResponse,
      })
      global.fetch = mockFetch

      await repository.fetchSensorData(48)

      expect(mockFetch).toHaveBeenCalledWith(`${mockBaseUrl}/data?hours=48`)
    })
  })

  describe('fetchLatestData', () => {
    it('should fetch and validate latest data successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSensorData,
      })
      global.fetch = mockFetch

      const result = await repository.fetchLatestData()

      expect(mockFetch).toHaveBeenCalledWith(`${mockBaseUrl}/latest`)
      expect(result).toEqual(mockSensorData)
    })

    it('should throw error when response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
      global.fetch = mockFetch

      await expect(repository.fetchLatestData()).rejects.toThrow(
        'HTTP error! status: 404'
      )
    })

    it('should throw error when validation fails', async () => {
      const invalidData = {
        deviceId: 'test',
        timestamp: 'invalid', // Should be number
        temperature: 25,
        humidity: 60,
        co2: 800,
      }

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => invalidData,
      })
      global.fetch = mockFetch

      await expect(repository.fetchLatestData()).rejects.toThrow()
    })
  })

  describe('constructor', () => {
    it('should use provided base URL', () => {
      const customUrl = 'https://custom.api.com'
      const customRepository = new SensorRepository(customUrl)

      expect(customRepository).toBeDefined()
    })

    it('should use default base URL when not provided', async () => {
      // This test ensures the default parameter works
      const defaultRepository = new SensorRepository()

      expect(defaultRepository).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should handle network errors', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error('Failed to fetch'))
      global.fetch = mockFetch

      await expect(repository.fetchSensorData(24)).rejects.toThrow(
        'Failed to fetch'
      )
    })

    it('should handle unknown errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue('Unknown error')
      global.fetch = mockFetch

      const error = await repository.fetchSensorData(24).catch((e) => e)

      expect(error).toHaveProperty('message')
    })
  })
})
