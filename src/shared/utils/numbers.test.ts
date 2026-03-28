import { describe, it, expect } from 'vitest'
import {
  roundTo,
  formatTemperature,
  formatHumidity,
  formatCO2,
} from './numbers'

describe('numbers utilities', () => {
  describe('roundTo', () => {
    it('should round to specified decimal places', () => {
      expect(roundTo(3.14159, 2)).toBe(3.14)
      expect(roundTo(3.14159, 3)).toBe(3.142)
      expect(roundTo(3.14159, 0)).toBe(3)
    })

    it('should handle negative numbers', () => {
      expect(roundTo(-3.14159, 2)).toBe(-3.14)
      expect(roundTo(-3.14159, 1)).toBe(-3.1)
    })

    it('should handle zero', () => {
      expect(roundTo(0, 2)).toBe(0)
    })

    it('should handle integers', () => {
      expect(roundTo(10, 2)).toBe(10)
    })
  })

  describe('formatTemperature', () => {
    it('should format temperature with 1 decimal place', () => {
      expect(formatTemperature(25.567)).toBe('25.6°C')
      expect(formatTemperature(20.0)).toBe('20°C')
    })

    it('should handle negative temperatures', () => {
      expect(formatTemperature(-5.5)).toBe('-5.5°C')
    })

    it('should handle zero', () => {
      expect(formatTemperature(0)).toBe('0°C')
    })
  })

  describe('formatHumidity', () => {
    it('should format humidity with no decimal places', () => {
      expect(formatHumidity(60.7)).toBe('61%')
      expect(formatHumidity(50.0)).toBe('50%')
    })

    it('should handle edge cases', () => {
      expect(formatHumidity(0)).toBe('0%')
      expect(formatHumidity(100)).toBe('100%')
    })
  })

  describe('formatCO2', () => {
    it('should format CO2 with no decimal places', () => {
      expect(formatCO2(850.7)).toBe('851 ppm')
      expect(formatCO2(1000.0)).toBe('1000 ppm')
    })

    it('should handle low values', () => {
      expect(formatCO2(400)).toBe('400 ppm')
    })

    it('should handle high values', () => {
      expect(formatCO2(2000)).toBe('2000 ppm')
    })
  })
})
