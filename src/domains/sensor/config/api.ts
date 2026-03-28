/**
 * API設定
 */
export const API_CONFIG = {
  /** APIベースURL */
  baseUrl: import.meta.env.VITE_API_BASE_URL || '',
  /** モックデータを使用するか */
  useMockData: import.meta.env.VITE_USE_MOCK_DATA === 'true',
  /** ポーリング間隔（ミリ秒） */
  pollingInterval: Number(import.meta.env.VITE_POLLING_INTERVAL) || 60000,
  /** リトライ回数 */
  maxRetries: 3,
  /** リトライ間隔（ミリ秒） */
  retryDelay: 1000,
} as const

/**
 * APIエンドポイント
 */
export const API_ENDPOINTS = {
  health: '/health',
  data: '/data',
  latest: '/latest',
} as const
