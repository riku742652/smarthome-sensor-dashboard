import React, { useState, useEffect, useMemo } from 'react'
import { sensorService } from '@domains/sensor/service'
import { chartDataService } from '@domains/dashboard/service'
import type { TimeRange, ChartDataPoint } from '@domains/dashboard/types'
import { TIME_RANGE_HOURS } from '@domains/dashboard/types'
import { Loading, ErrorMessage, EmptyState, Card } from '@shared/components'
import { TimeRangeSelector } from '../components/TimeRangeSelector'
import { SensorChart } from '../components/SensorChart'
import { useInterval, useLocalStorage } from '@shared/hooks'
import { API_CONFIG } from '@domains/sensor/config'

export function DashboardPage(): React.JSX.Element {
  const [timeRange, setTimeRange] = useLocalStorage<TimeRange>('timeRange', '24h')
  const [data, setData] = useState<ChartDataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = async (): Promise<void> => {
    try {
      setLoading(true)
      const hours = TIME_RANGE_HOURS[timeRange]
      const response = await sensorService.getSensorData(hours)
      const chartData = chartDataService.transformToChartData(response.data)

      // データポイントが多い場合は間引く
      const downsampledData = chartDataService.downsample(chartData, 200)

      setData(downsampledData)
      setError(null)
    } catch (err) {
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange])

  // 自動更新（1分間隔）
  useInterval(fetchData, API_CONFIG.pollingInterval)

  // 統計情報を計算
  const stats = useMemo(() => {
    if (data.length === 0) return null
    return chartDataService.calculateStats(data)
  }, [data])

  if (loading && data.length === 0) {
    return <Loading message="グラフデータを読み込んでいます..." />
  }

  if (error && data.length === 0) {
    return <ErrorMessage message={error.message} onRetry={fetchData} />
  }

  if (data.length === 0) {
    return <EmptyState message="グラフ表示するデータがありません" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">時系列グラフ</h2>
        <TimeRangeSelector
          selectedRange={timeRange}
          onChange={setTimeRange}
        />
      </div>

      <Card>
        <SensorChart data={data} />
      </Card>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="温度統計">
            <div className="space-y-2 text-sm">
              <p>平均: {stats.temperature.avg.toFixed(1)}°C</p>
              <p>最小: {stats.temperature.min.toFixed(1)}°C</p>
              <p>最大: {stats.temperature.max.toFixed(1)}°C</p>
            </div>
          </Card>
          <Card title="湿度統計">
            <div className="space-y-2 text-sm">
              <p>平均: {stats.humidity.avg.toFixed(1)}%</p>
              <p>最小: {stats.humidity.min.toFixed(1)}%</p>
              <p>最大: {stats.humidity.max.toFixed(1)}%</p>
            </div>
          </Card>
          <Card title="CO2統計">
            <div className="space-y-2 text-sm">
              <p>平均: {Math.round(stats.co2.avg)} ppm</p>
              <p>最小: {Math.round(stats.co2.min)} ppm</p>
              <p>最大: {Math.round(stats.co2.max)} ppm</p>
            </div>
          </Card>
        </div>
      )}

      {error && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <p className="text-sm text-yellow-700">
            自動更新でエラーが発生しました: {error.message}
          </p>
        </div>
      )}
    </div>
  )
}
