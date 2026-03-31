import { useState, useEffect, useCallback } from 'react'
import type { AsyncState } from '@shared/types'

/**
 * データフェッチング用のHook
 */
export function useFetch<T>(
  fetchFn: () => Promise<T>,
  dependencies: unknown[] = []
): AsyncState<T> & { refetch: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    status: 'idle',
    error: null,
  })

  const refetch = useCallback(async () => {
    setState({ data: null, status: 'loading', error: null })

    try {
      const data = await fetchFn()
      setState({ data, status: 'success', error: null })
    } catch (error) {
      setState({
        data: null,
        status: 'error',
        error: error as Error,
      })
    }
  }, [fetchFn])

  useEffect(() => {
    refetch()
  }, dependencies) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, refetch }
}
