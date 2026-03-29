import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useInterval } from './useInterval'

describe('useInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('should call callback at specified interval', () => {
    const callback = vi.fn()
    const delay = 1000

    renderHook(() => useInterval(callback, delay))

    // Initially not called
    expect(callback).not.toHaveBeenCalled()

    // After 1 second
    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(1)

    // After 2 seconds
    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(2)

    // After 3 seconds
    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('should not call callback when delay is null', () => {
    const callback = vi.fn()

    renderHook(() => useInterval(callback, null))

    vi.advanceTimersByTime(5000)

    expect(callback).not.toHaveBeenCalled()
  })

  it('should pause interval when delay changes to null', () => {
    const callback = vi.fn()
    const { rerender } = renderHook(
      ({ delay }: { delay: number | null }) => useInterval(callback, delay),
      { initialProps: { delay: 1000 as number | null } }
    )

    // First interval tick
    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(1)

    // Change delay to null (pause)
    rerender({ delay: null })

    // Advance time, callback should not be called
    vi.advanceTimersByTime(5000)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('should restart interval when delay changes from null to number', () => {
    const callback = vi.fn()
    const { rerender } = renderHook(
      ({ delay }: { delay: number | null }) => useInterval(callback, delay),
      { initialProps: { delay: null as number | null } }
    )

    // With null delay, callback should not be called
    vi.advanceTimersByTime(2000)
    expect(callback).not.toHaveBeenCalled()

    // Change delay to 1000 (restart)
    rerender({ delay: 1000 })

    // Now callback should be called
    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('should update to new delay value', () => {
    const callback = vi.fn()
    const { rerender } = renderHook(
      ({ delay }) => useInterval(callback, delay),
      { initialProps: { delay: 1000 } }
    )

    // First tick at 1000ms
    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(1)

    // Change delay to 500ms
    rerender({ delay: 500 })

    // Next tick should be at 500ms
    vi.advanceTimersByTime(500)
    expect(callback).toHaveBeenCalledTimes(2)

    // And another at 500ms
    vi.advanceTimersByTime(500)
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('should use latest callback', () => {
    let count = 0
    const callback1 = vi.fn(() => {
      count = 1
    })
    const callback2 = vi.fn(() => {
      count = 2
    })

    const { rerender } = renderHook(
      ({ callback }) => useInterval(callback, 1000),
      { initialProps: { callback: callback1 } }
    )

    // First tick uses callback1
    vi.advanceTimersByTime(1000)
    expect(count).toBe(1)

    // Update to callback2
    rerender({ callback: callback2 })

    // Next tick should use callback2
    vi.advanceTimersByTime(1000)
    expect(count).toBe(2)
  })

  it('should cleanup interval on unmount', () => {
    const callback = vi.fn()
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

    const { unmount } = renderHook(() => useInterval(callback, 1000))

    unmount()

    expect(clearIntervalSpy).toHaveBeenCalled()

    // After unmount, callback should not be called
    vi.advanceTimersByTime(5000)
    expect(callback).not.toHaveBeenCalled()
  })

  it('should handle rapid callback changes', () => {
    const callback1 = vi.fn()
    const callback2 = vi.fn()
    const callback3 = vi.fn()

    const { rerender } = renderHook(
      ({ callback }) => useInterval(callback, 1000),
      { initialProps: { callback: callback1 } }
    )

    // Update callback multiple times before first tick
    rerender({ callback: callback2 })
    rerender({ callback: callback3 })

    // First tick should use latest callback (callback3)
    vi.advanceTimersByTime(1000)
    expect(callback1).not.toHaveBeenCalled()
    expect(callback2).not.toHaveBeenCalled()
    expect(callback3).toHaveBeenCalledTimes(1)
  })

  it('should work with different delay values', () => {
    const callback = vi.fn()

    const delays = [100, 500, 1000, 2000]

    delays.forEach((delay) => {
      vi.clearAllMocks()
      const { unmount } = renderHook(() => useInterval(callback, delay))

      vi.advanceTimersByTime(delay)
      expect(callback).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(delay)
      expect(callback).toHaveBeenCalledTimes(2)

      unmount()
    })
  })
})
