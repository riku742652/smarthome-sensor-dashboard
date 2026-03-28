import { getSensorRepository } from '../repository'
import type { SensorData, SensorDataResponse } from '../types'

/**
 * センサーサービス
 * データの取得、キャッシング、正規化を担当
 */
export class SensorService {
  private repository = getSensorRepository()
  private cache: Map<string, { data: SensorDataResponse; timestamp: number }> =
    new Map()
  private cacheExpiry = 30000 // 30秒

  /**
   * センサーデータを取得（キャッシュ付き）
   */
  async getSensorData(hours: number): Promise<SensorDataResponse> {
    const cacheKey = `data-${hours}`
    const cached = this.cache.get(cacheKey)

    // キャッシュが有効な場合は返す
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data
    }

    // APIから取得
    const data = await this.repository.fetchSensorData(hours)

    // キャッシュに保存
    this.cache.set(cacheKey, { data, timestamp: Date.now() })

    return data
  }

  /**
   * 最新データを取得
   */
  async getLatestData(): Promise<SensorData> {
    return this.repository.fetchLatestData()
  }

  /**
   * ヘルスチェック
   */
  async checkHealth(): Promise<boolean> {
    return this.repository.healthCheck()
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.cache.clear()
  }
}

/**
 * シングルトンインスタンス
 */
export const sensorService = new SensorService()
