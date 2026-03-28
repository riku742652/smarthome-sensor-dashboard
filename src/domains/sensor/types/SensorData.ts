/**
 * センサーデータの型定義
 */
export interface SensorData {
  /** デバイスID */
  deviceId: string
  /** タイムスタンプ（Unixミリ秒） */
  timestamp: number
  /** 温度（摂氏） */
  temperature: number
  /** 湿度（パーセンテージ） */
  humidity: number
  /** CO2濃度（ppm） */
  co2: number
}

/**
 * APIレスポンスの型定義
 */
export interface SensorDataResponse {
  data: SensorData[]
  count: number
}

/**
 * API エラーの型定義
 */
export interface ApiError {
  message: string
  statusCode?: number
}
