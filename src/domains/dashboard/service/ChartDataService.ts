import type { SensorData } from '@domains/sensor/types'
import type { ChartDataPoint } from '../types'

/**
 * グラフデータサービス
 * センサーデータをグラフ表示用に変換
 */
export class ChartDataService {
  /**
   * センサーデータをグラフデータに変換
   */
  transformToChartData(sensorData: SensorData[]): ChartDataPoint[] {
    return sensorData.map((data) => ({
      timestamp: data.timestamp,
      date: new Date(data.timestamp),
      temperature: data.temperature,
      humidity: data.humidity,
      co2: data.co2,
    }))
  }

  /**
   * データポイントを間引く（パフォーマンス最適化）
   * @param data 元データ
   * @param maxPoints 最大データポイント数
   */
  downsample(data: ChartDataPoint[], maxPoints: number): ChartDataPoint[] {
    if (data.length <= maxPoints) {
      return data
    }

    const step = Math.ceil(data.length / maxPoints)
    return data.filter((_, index) => index % step === 0)
  }

  /**
   * 統計情報を計算
   */
  calculateStats(data: (SensorData | ChartDataPoint)[]): {
    temperature: { avg: number; min: number; max: number }
    humidity: { avg: number; min: number; max: number }
    co2: { avg: number; min: number; max: number }
  } {
    if (data.length === 0) {
      return {
        temperature: { avg: 0, min: 0, max: 0 },
        humidity: { avg: 0, min: 0, max: 0 },
        co2: { avg: 0, min: 0, max: 0 },
      }
    }

    const temperatures = data.map((d) => d.temperature)
    const humidities = data.map((d) => d.humidity)
    const co2s = data.map((d) => d.co2)

    return {
      temperature: {
        avg: this.average(temperatures),
        min: Math.min(...temperatures),
        max: Math.max(...temperatures),
      },
      humidity: {
        avg: this.average(humidities),
        min: Math.min(...humidities),
        max: Math.max(...humidities),
      },
      co2: {
        avg: this.average(co2s),
        min: Math.min(...co2s),
        max: Math.max(...co2s),
      },
    }
  }

  private average(numbers: number[]): number {
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length
  }
}

/**
 * シングルトンインスタンス
 */
export const chartDataService = new ChartDataService()
