/**
 * グラフ表示用のデータポイント
 */
export interface ChartDataPoint {
  timestamp: number
  date: Date
  temperature: number
  humidity: number
  co2: number
}

/**
 * 時間範囲オプション
 */
export type TimeRange = '1h' | '6h' | '12h' | '24h' | '7d'

/**
 * 時間範囲と時間（時間単位）のマッピング
 */
export const TIME_RANGE_HOURS: Record<TimeRange, number> = {
  '1h': 1,
  '6h': 6,
  '12h': 12,
  '24h': 24,
  '7d': 168,
}

/**
 * 時間範囲のラベル
 */
export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  '1h': '1時間',
  '6h': '6時間',
  '12h': '12時間',
  '24h': '24時間',
  '7d': '7日間',
}
