import { useEffect, useRef } from 'react'

/**
 * setIntervalをReactで使いやすくするHook
 */
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback)

  // コールバックを最新に保つ
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  // インターバルをセットアップ
  useEffect(() => {
    if (delay === null) {
      return
    }

    const id = setInterval(() => savedCallback.current(), delay)

    return () => clearInterval(id)
  }, [delay])
}
