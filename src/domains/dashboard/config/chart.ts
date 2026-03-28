/**
 * グラフ設定
 */
export const CHART_CONFIG = {
  /** グラフの高さ（px） */
  height: 300,
  /** アニメーション有効化 */
  animationEnabled: false,
  /** グリッドの表示 */
  showGrid: true,
  /** ツールチップの表示 */
  showTooltip: true,
} as const

/**
 * メトリクス設定
 */
export const METRICS_CONFIG = {
  temperature: {
    label: '温度',
    unit: '°C',
    color: '#ef4444',
    min: -50,
    max: 100,
  },
  humidity: {
    label: '湿度',
    unit: '%',
    color: '#3b82f6',
    min: 0,
    max: 100,
  },
  co2: {
    label: 'CO2',
    unit: 'ppm',
    color: '#10b981',
    min: 0,
    max: 5000,
  },
} as const
