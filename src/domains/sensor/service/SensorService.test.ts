import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockSensorData, mockSensorDataResponse } from '@/test/utils/mockData'

// Create mock repository functions
const fetchSensorData = vi.fn()
const fetchLatestData = vi.fn()
const healthCheck = vi.fn()

// Mock the repository module
vi.mock('../repository', () => ({
  getSensorRepository: () => ({
    fetchSensorData,
    fetchLatestData,
    healthCheck,
  }),
}))

// Import after mocking
const { SensorService } = await import('./SensorService')

describe('SensorService', () => {
  let service: InstanceType<typeof SensorService>

  beforeEach(() => {
    service = new SensorService()
    vi.clearAllMocks()
  })

  afterEach(() => {
    service.clearCache()
  })

  describe('getSensorData', () => {
    it('should fetch data from repository', async () => {
      fetchSensorData.mockResolvedValue(mockSensorDataResponse)

      const result = await service.getSensorData(24)

      expect(fetchSensorData).toHaveBeenCalledWith(24)
      expect(result).toEqual(mockSensorDataResponse)
    })

    it('should cache data for 30 seconds', async () => {
      fetchSensorData.mockResolvedValue(mockSensorDataResponse)

      // First fetch
      await service.getSensorData(24)
      // Second fetch (should use cache)
      await service.getSensorData(24)

      // Repository should only be called once
      expect(fetchSensorData).toHaveBeenCalledTimes(1)
    })

    it('should refetch after cache expires', async () => {
      vi.useFakeTimers()
      fetchSensorData.mockResolvedValue(mockSensorDataResponse)

      await service.getSensorData(24)

      // Advance time past cache expiry (30 seconds)
      vi.advanceTimersByTime(31000)

      await service.getSensorData(24)

      // Repository should be called twice
      expect(fetchSensorData).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('should use separate cache for different hours', async () => {
      fetchSensorData.mockResolvedValue(mockSensorDataResponse)

      await service.getSensorData(24)
      await service.getSensorData(48)

      // Different cache keys, so repository called twice
      expect(fetchSensorData).toHaveBeenCalledTimes(2)
      expect(fetchSensorData).toHaveBeenCalledWith(24)
      expect(fetchSensorData).toHaveBeenCalledWith(48)
    })
  })

  describe('getLatestData', () => {
    it('should fetch latest data from repository', async () => {
      fetchLatestData.mockResolvedValue(mockSensorData)

      const result = await service.getLatestData()

      expect(fetchLatestData).toHaveBeenCalled()
      expect(result).toEqual(mockSensorData)
    })
  })

  describe('checkHealth', () => {
    it('should return true when repository is healthy', async () => {
      healthCheck.mockResolvedValue(true)

      const result = await service.checkHealth()

      expect(healthCheck).toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('should return false when repository is unhealthy', async () => {
      healthCheck.mockResolvedValue(false)

      const result = await service.checkHealth()

      expect(result).toBe(false)
    })
  })

  describe('clearCache', () => {
    it('should clear cached data', async () => {
      fetchSensorData.mockResolvedValue(mockSensorDataResponse)

      await service.getSensorData(24)
      service.clearCache()
      await service.getSensorData(24)

      // After cache clear, repository should be called again
      expect(fetchSensorData).toHaveBeenCalledTimes(2)
    })
  })
})
