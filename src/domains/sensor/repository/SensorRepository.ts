import { API_CONFIG, API_ENDPOINTS } from '../config'
import type {
  SensorData,
  SensorDataResponse,
  ApiError,
} from '../types'
import { SensorDataSchema, SensorDataResponseSchema } from './schemas'

/**
 * センサーデータリポジトリ
 * 外部API（Lambda Function URL）との通信を担当
 */
export class SensorRepository {
  private baseUrl: string

  constructor(baseUrl: string = API_CONFIG.baseUrl) {
    this.baseUrl = baseUrl
  }

  /**
   * ヘルスチェック
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}${API_ENDPOINTS.health}`)
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * センサーデータを取得
   * @param hours 取得する時間範囲（時間）
   */
  async fetchSensorData(hours: number): Promise<SensorDataResponse> {
    try {
      const url = `${this.baseUrl}${API_ENDPOINTS.data}?hours=${hours}`
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const json = await response.json()

      // Zodでバリデーション
      const validated = SensorDataResponseSchema.parse(json)

      return validated
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * 最新のセンサーデータを取得
   */
  async fetchLatestData(): Promise<SensorData> {
    try {
      const url = `${this.baseUrl}${API_ENDPOINTS.latest}`
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const json = await response.json()

      // Zodでバリデーション
      const validated = SensorDataSchema.parse(json)

      return validated
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * エラーハンドリング
   */
  private handleError(error: unknown): ApiError {
    if (error instanceof Error) {
      return {
        message: error.message,
      }
    }
    return {
      message: 'Unknown error occurred',
    }
  }
}

/**
 * シングルトンインスタンス
 */
export const sensorRepository = new SensorRepository()
