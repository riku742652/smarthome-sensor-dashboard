/**
 * 小数点以下を指定桁数で丸める
 */
export function roundTo(value: number, decimals: number): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals)
}

/**
 * 温度をフォーマット
 */
export function formatTemperature(value: number): string {
  return `${roundTo(value, 1)}°C`
}

/**
 * 湿度をフォーマット
 */
export function formatHumidity(value: number): string {
  return `${roundTo(value, 0)}%`
}

/**
 * CO2をフォーマット
 */
export function formatCO2(value: number): string {
  return `${Math.round(value)} ppm`
}
