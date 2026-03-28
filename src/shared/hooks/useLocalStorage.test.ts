import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalStorage } from './useLocalStorage'

describe('useLocalStorage', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('should return initial value when localStorage is empty', () => {
    const { result } = renderHook(() =>
      useLocalStorage('testKey', 'defaultValue')
    )

    expect(result.current[0]).toBe('defaultValue')
  })

  it('should return stored value from localStorage', () => {
    localStorage.setItem('testKey', JSON.stringify('storedValue'))

    const { result } = renderHook(() =>
      useLocalStorage('testKey', 'defaultValue')
    )

    expect(result.current[0]).toBe('storedValue')
  })

  it('should update both state and localStorage when setValue is called', () => {
    const { result } = renderHook(() =>
      useLocalStorage('testKey', 'initialValue')
    )

    act(() => {
      result.current[1]('newValue')
    })

    expect(result.current[0]).toBe('newValue')
    expect(localStorage.getItem('testKey')).toBe(JSON.stringify('newValue'))
  })

  it('should work with object values', () => {
    const initialObject = { name: 'John', age: 30 }
    const updatedObject = { name: 'Jane', age: 25 }

    const { result } = renderHook(() =>
      useLocalStorage('userKey', initialObject)
    )

    expect(result.current[0]).toEqual(initialObject)

    act(() => {
      result.current[1](updatedObject)
    })

    expect(result.current[0]).toEqual(updatedObject)
    expect(JSON.parse(localStorage.getItem('userKey')!)).toEqual(updatedObject)
  })

  it('should work with array values', () => {
    const initialArray = [1, 2, 3]
    const updatedArray = [4, 5, 6]

    const { result } = renderHook(() =>
      useLocalStorage('arrayKey', initialArray)
    )

    expect(result.current[0]).toEqual(initialArray)

    act(() => {
      result.current[1](updatedArray)
    })

    expect(result.current[0]).toEqual(updatedArray)
    expect(JSON.parse(localStorage.getItem('arrayKey')!)).toEqual(updatedArray)
  })

  it('should work with number values', () => {
    const { result } = renderHook(() => useLocalStorage('numberKey', 42))

    expect(result.current[0]).toBe(42)

    act(() => {
      result.current[1](100)
    })

    expect(result.current[0]).toBe(100)
    expect(JSON.parse(localStorage.getItem('numberKey')!)).toBe(100)
  })

  it('should work with boolean values', () => {
    const { result } = renderHook(() => useLocalStorage('boolKey', false))

    expect(result.current[0]).toBe(false)

    act(() => {
      result.current[1](true)
    })

    expect(result.current[0]).toBe(true)
    expect(JSON.parse(localStorage.getItem('boolKey')!)).toBe(true)
  })

  it('should handle invalid JSON in localStorage', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('invalidKey', 'invalid-json{')

    const { result } = renderHook(() =>
      useLocalStorage('invalidKey', 'fallbackValue')
    )

    expect(result.current[0]).toBe('fallbackValue')
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('should handle localStorage.setItem errors', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

    const { result } = renderHook(() => useLocalStorage('testKey', 'value'))

    act(() => {
      result.current[1]('newValue')
    })

    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
    setItemSpy.mockRestore()
  })

  it('should use separate storage for different keys', () => {
    const { result: result1 } = renderHook(() =>
      useLocalStorage('key1', 'value1')
    )
    const { result: result2 } = renderHook(() =>
      useLocalStorage('key2', 'value2')
    )

    expect(result1.current[0]).toBe('value1')
    expect(result2.current[0]).toBe('value2')

    act(() => {
      result1.current[1]('updated1')
    })

    expect(result1.current[0]).toBe('updated1')
    expect(result2.current[0]).toBe('value2') // Should not change

    act(() => {
      result2.current[1]('updated2')
    })

    expect(result1.current[0]).toBe('updated1') // Should not change
    expect(result2.current[0]).toBe('updated2')
  })

  it('should persist value across hook re-renders', () => {
    const { result, rerender } = renderHook(() =>
      useLocalStorage('persistKey', 'initial')
    )

    act(() => {
      result.current[1]('updated')
    })

    rerender()

    expect(result.current[0]).toBe('updated')
  })

  it('should handle null initial value', () => {
    const { result } = renderHook(() => useLocalStorage('nullKey', null))

    expect(result.current[0]).toBeNull()

    act(() => {
      result.current[1]('notNull')
    })

    expect(result.current[0]).toBe('notNull')
  })

  it('should handle undefined in stored value', () => {
    localStorage.setItem('undefinedKey', JSON.stringify(undefined))

    const { result } = renderHook(() =>
      useLocalStorage('undefinedKey', 'default')
    )

    // JSON.stringify(undefined) returns undefined (not a string),
    // so localStorage stores "undefined" string
    // JSON.parse(undefined) throws error, so fallback to default
    expect(result.current[0]).toBeDefined()
  })

  it('should update localStorage immediately when setValue is called', () => {
    const { result } = renderHook(() => useLocalStorage('syncKey', 'initial'))

    act(() => {
      result.current[1]('sync')
    })

    // Check that localStorage is updated synchronously
    const storedValue = localStorage.getItem('syncKey')
    expect(storedValue).toBe(JSON.stringify('sync'))
  })
})
