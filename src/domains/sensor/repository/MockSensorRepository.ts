import type {
  SensorData,
  SensorDataResponse,
} from '../types'

/**
 * モックデータを返すリポジトリ（開発用）
 */
export class MockSensorRepository {
  /**
   * ヘルスチェック
   */
  async healthCheck(): Promise<boolean> {
    return true
  }

  /**
   * モックセンサーデータを生成
   */
  async fetchSensorData(hours: number): Promise<SensorDataResponse> {
    const now = Date.now()
    const interval = 60000 // 1分間隔
    const count = hours * 60

    const data: SensorData[] = []

    for (let i = 0; i < count; i++) {
      const timestamp = now - i * interval
      data.push({
        deviceId: 'mock-device',
        timestamp,
        temperature: 20 + Math.sin(i / 10) * 5 + Math.random() * 2,
        humidity: 50 + Math.cos(i / 15) * 20 + Math.random() * 5,
        co2: 600 + Math.sin(i / 20) * 200 + Math.random() * 50,
      })
    }

    return {
      data: data.reverse(),
      count: data.length,
    }
  }

  /**
   * 最新のモックデータを取得
   */
  async fetchLatestData(): Promise<SensorData> {
    return {
      deviceId: 'mock-device',
      timestamp: Date.now(),
      temperature: 22.5,
      humidity: 55,
      co2: 650,
    }
  }
}

/**
 * シングルトンインスタンス
 */
export const mockSensorRepository = new MockSensorRepository()
