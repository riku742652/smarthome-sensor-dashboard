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

/**
 * センサーデータが見つからない場合のエラー（HTTP 404）
 */
export class SensorNotFoundError extends Error {
  constructor(message = 'Sensor data not found') {
    super(message)
    this.name = 'SensorNotFoundError'
  }
}

/**
 * API が JSON 以外のレスポンスを返した場合のエラー（SPAフォールバック等）
 */
export class NonJsonResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonJsonResponseError'
  }
}
