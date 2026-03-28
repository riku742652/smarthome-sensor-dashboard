import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFetch } from './useFetch'

describe('useFetch', () => {
  it('should start with loading status', async () => {
    const fetchFn = vi.fn().mockResolvedValue({})
    const { result } = renderHook(() => useFetch(fetchFn, []))

    expect(result.current.status).toBe('loading')
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })
  })

  it('should fetch data successfully', async () => {
    const mockData = { value: 'test' }
    const fetchFn = vi.fn().mockResolvedValue(mockData)

    const { result } = renderHook(() => useFetch(fetchFn))

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })

    expect(result.current.data).toEqual(mockData)
    expect(result.current.error).toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('should handle fetch errors', async () => {
    const error = new Error('Fetch failed')
    const fetchFn = vi.fn().mockRejectedValue(error)

    const { result } = renderHook(() => useFetch(fetchFn))

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toEqual(error)
  })

  it('should refetch when refetch is called', async () => {
    const mockData = { value: 'test' }
    const fetchFn = vi.fn().mockResolvedValue(mockData)

    const { result } = renderHook(() => useFetch(fetchFn))

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })

    result.current.refetch()

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(2)
    })
  })

  it('should show loading state during fetch', async () => {
    const mockData = { value: 'test' }
    const fetchFn = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(mockData), 100))
    )

    const { result } = renderHook(() => useFetch(fetchFn))

    // Should start with loading
    await waitFor(() => {
      expect(result.current.status).toBe('loading')
    })

    // Then transition to success
    await waitFor(
      () => {
        expect(result.current.status).toBe('success')
      },
      { timeout: 200 }
    )

    expect(result.current.data).toEqual(mockData)
  })
})
