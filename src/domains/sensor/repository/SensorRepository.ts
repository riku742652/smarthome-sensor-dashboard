import { API_CONFIG, API_ENDPOINTS } from '../config'
import type {
  SensorData,
  SensorDataResponse,
  ApiError,
} from '../types'
import { SensorNotFoundError, NonJsonResponseError } from '../types'
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

      const json = await this.parseJsonResponse(response, url)

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

      const json = await this.parseJsonResponse(response, url)

      // Zodでバリデーション
      const validated = SensorDataSchema.parse(json)

      return validated
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * エラーハンドリング
   * カスタムエラー（SensorNotFoundError, NonJsonResponseError）はそのまま再スロー
   */
  private handleError(error: unknown): ApiError | never {
    if (error instanceof SensorNotFoundError || error instanceof NonJsonResponseError) {
      throw error
    }
    if (error instanceof Error) {
      return {
        message: error.message,
      }
    }
    return {
      message: 'Unknown error occurred',
    }
  }

  /**
   * JSON レスポンスを検証して返却
   */
  private async parseJsonResponse(response: Response, url: string): Promise<unknown> {
    if (!response.ok) {
      if (response.status === 404) {
        throw new SensorNotFoundError(`Sensor data not found. url: ${url}`)
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const contentType = response.headers?.get?.('content-type')
    if (contentType && !contentType.toLowerCase().includes('application/json')) {
      let responsePreview = ''
      if (typeof response.text === 'function') {
        try {
          responsePreview = (await response.text()).slice(0, 120)
        } catch {
          responsePreview = ''
        }
      }

      const previewInfo = responsePreview
        ? `, responsePreview: ${JSON.stringify(responsePreview)}`
        : ''
      throw new NonJsonResponseError(
        `Non-JSON response received. url: ${url}, status: ${response.status}, content-type: ${contentType}${previewInfo}. ` +
          'API URL may be misconfigured (VITE_API_BASE_URL).'
      )
    }

    return response.json()
  }
}

/**
 * シングルトンインスタンス
 */
export const sensorRepository = new SensorRepository()
