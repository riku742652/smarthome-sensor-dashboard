import { describe, it, expect } from 'vitest'
import { ChartDataService } from './ChartDataService'
import type { SensorData } from '@domains/sensor/types'
import type { ChartDataPoint } from '../types'

describe('ChartDataService', () => {
  const service = new ChartDataService()

  const mockSensorData: SensorData[] = [
    {
      deviceId: 'device-1',
      timestamp: 1700000000000,
      temperature: 25.5,
      humidity: 60.0,
      co2: 800,
    },
    {
      deviceId: 'device-1',
      timestamp: 1700000060000,
      temperature: 25.6,
      humidity: 61.0,
      co2: 810,
    },
    {
      deviceId: 'device-1',
      timestamp: 1700000120000,
      temperature: 25.7,
      humidity: 62.0,
      co2: 820,
    },
  ]

  describe('transformToChartData', () => {
    it('should transform sensor data to chart data', () => {
      const result = service.transformToChartData(mockSensorData)

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        timestamp: 1700000000000,
        date: new Date(1700000000000),
        temperature: 25.5,
        humidity: 60.0,
        co2: 800,
      })
    })

    it('should handle empty array', () => {
      const result = service.transformToChartData([])

      expect(result).toEqual([])
    })

    it('should preserve all data fields', () => {
      const result = service.transformToChartData(mockSensorData)

      result.forEach((point, index) => {
        expect(point.temperature).toBe(mockSensorData[index].temperature)
        expect(point.humidity).toBe(mockSensorData[index].humidity)
        expect(point.co2).toBe(mockSensorData[index].co2)
        expect(point.timestamp).toBe(mockSensorData[index].timestamp)
      })
    })
  })

  describe('downsample', () => {
    it('should return all data when length <= maxPoints', () => {
      const chartData: ChartDataPoint[] = mockSensorData.map((d) => ({
        timestamp: d.timestamp,
        date: new Date(d.timestamp),
        temperature: d.temperature,
        humidity: d.humidity,
        co2: d.co2,
      }))

      const result = service.downsample(chartData, 5)

      expect(result).toHaveLength(3)
      expect(result).toEqual(chartData)
    })

    it('should downsample data when length > maxPoints', () => {
      const largeData: ChartDataPoint[] = Array.from({ length: 100 }, (_, i) => ({
        timestamp: 1700000000000 + i * 60000,
        date: new Date(1700000000000 + i * 60000),
        temperature: 25 + i * 0.1,
        humidity: 60,
        co2: 800,
      }))

      const result = service.downsample(largeData, 10)

      expect(result.length).toBeLessThanOrEqual(10)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should preserve first data point', () => {
      const largeData: ChartDataPoint[] = Array.from({ length: 100 }, (_, i) => ({
        timestamp: 1700000000000 + i * 60000,
        date: new Date(1700000000000 + i * 60000),
        temperature: 25 + i * 0.1,
        humidity: 60,
        co2: 800,
      }))

      const result = service.downsample(largeData, 10)

      expect(result[0]).toEqual(largeData[0])
    })
  })

  describe('calculateStats', () => {
    it('should calculate correct statistics', () => {
      const result = service.calculateStats(mockSensorData)

      expect(result.temperature.avg).toBeCloseTo(25.6, 1)
      expect(result.temperature.min).toBe(25.5)
      expect(result.temperature.max).toBe(25.7)

      expect(result.humidity.avg).toBeCloseTo(61.0, 1)
      expect(result.humidity.min).toBe(60.0)
      expect(result.humidity.max).toBe(62.0)

      expect(result.co2.avg).toBeCloseTo(810, 0)
      expect(result.co2.min).toBe(800)
      expect(result.co2.max).toBe(820)
    })

    it('should return zero stats for empty array', () => {
      const result = service.calculateStats([])

      expect(result).toEqual({
        temperature: { avg: 0, min: 0, max: 0 },
        humidity: { avg: 0, min: 0, max: 0 },
        co2: { avg: 0, min: 0, max: 0 },
      })
    })

    it('should handle single data point', () => {
      const singleData: SensorData[] = [mockSensorData[0]]

      const result = service.calculateStats(singleData)

      expect(result.temperature.avg).toBe(25.5)
      expect(result.temperature.min).toBe(25.5)
      expect(result.temperature.max).toBe(25.5)
    })

    it('should work with ChartDataPoint type', () => {
      const chartData: ChartDataPoint[] = mockSensorData.map((d) => ({
        timestamp: d.timestamp,
        date: new Date(d.timestamp),
        temperature: d.temperature,
        humidity: d.humidity,
        co2: d.co2,
      }))

      const result = service.calculateStats(chartData)

      expect(result.temperature.avg).toBeCloseTo(25.6, 1)
    })
  })
})
