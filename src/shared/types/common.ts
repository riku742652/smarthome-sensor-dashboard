/**
 * 非同期操作の状態
 */
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error'

/**
 * 非同期データの状態を表す型
 */
export interface AsyncState<T, E = Error> {
  data: T | null
  status: AsyncStatus
  error: E | null
}
