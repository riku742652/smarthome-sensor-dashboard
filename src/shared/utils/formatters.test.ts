import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  formatDateTime,
  formatTime,
  formatDate,
  formatRelativeTime,
} from './formatters'

describe('formatters', () => {
  describe('formatDateTime', () => {
    it('should format timestamp as Japanese datetime', () => {
      const timestamp = new Date('2026-03-28T10:30:00').getTime()
      const result = formatDateTime(timestamp)
      expect(result).toMatch(/2026/)
      expect(result).toMatch(/03/)
      expect(result).toMatch(/28/)
      expect(result).toMatch(/10:30/)
    })

    it('should handle different times correctly', () => {
      const timestamp = new Date('2026-12-31T23:59:00').getTime()
      const result = formatDateTime(timestamp)
      expect(result).toMatch(/2026/)
      expect(result).toMatch(/12/)
      expect(result).toMatch(/31/)
      expect(result).toMatch(/23:59/)
    })
  })

  describe('formatTime', () => {
    it('should format timestamp as time only', () => {
      const timestamp = new Date('2026-03-28T10:30:00').getTime()
      const result = formatTime(timestamp)
      expect(result).toBe('10:30')
    })

    it('should handle midnight correctly', () => {
      const timestamp = new Date('2026-03-28T00:00:00').getTime()
      const result = formatTime(timestamp)
      expect(result).toBe('00:00')
    })

    it('should handle noon correctly', () => {
      const timestamp = new Date('2026-03-28T12:00:00').getTime()
      const result = formatTime(timestamp)
      expect(result).toBe('12:00')
    })
  })

  describe('formatDate', () => {
    it('should format timestamp as date only', () => {
      const timestamp = new Date('2026-03-28T10:30:00').getTime()
      const result = formatDate(timestamp)
      expect(result).toBe('2026/03/28')
    })

    it('should handle different dates correctly', () => {
      const timestamp = new Date('2025-01-01T00:00:00').getTime()
      const result = formatDate(timestamp)
      expect(result).toBe('2025/01/01')
    })
  })

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      // Use fake timers for consistent testing
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-03-28T12:00:00'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return "たった今" for recent timestamps', () => {
      const timestamp = Date.now() - 30000 // 30秒前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('たった今')
    })

    it('should return minutes for timestamps within an hour', () => {
      const timestamp = Date.now() - 5 * 60 * 1000 // 5分前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('5分前')
    })

    it('should return hours for timestamps within a day', () => {
      const timestamp = Date.now() - 3 * 60 * 60 * 1000 // 3時間前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('3時間前')
    })

    it('should return days for older timestamps', () => {
      const timestamp = Date.now() - 2 * 24 * 60 * 60 * 1000 // 2日前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('2日前')
    })

    it('should handle edge case at 1 minute', () => {
      const timestamp = Date.now() - 60 * 1000 // ちょうど1分前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('1分前')
    })

    it('should handle edge case at 1 hour', () => {
      const timestamp = Date.now() - 60 * 60 * 1000 // ちょうど1時間前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('1時間前')
    })

    it('should handle edge case at 1 day', () => {
      const timestamp = Date.now() - 24 * 60 * 60 * 1000 // ちょうど1日前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('1日前')
    })
  })
})
