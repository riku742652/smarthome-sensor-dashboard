import { useState, useEffect } from 'react'
import { sensorService } from '@domains/sensor/service'
import type { SensorData } from '@domains/sensor/types'
import { Loading, ErrorMessage, EmptyState } from '@shared/components'
import { MetricCard } from '../components/MetricCard'
import { formatRelativeTime } from '@shared/utils'
import { METRICS_CONFIG } from '@domains/dashboard/config'
import { useInterval } from '@shared/hooks'
import { API_CONFIG } from '@domains/sensor/config'

export function SensorDashboard() {
  const [latestData, setLatestData] = useState<SensorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = async () => {
    try {
      setLoading(true)
      const data = await sensorService.getLatestData()
      setLatestData(data)
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''

      // データ未登録時（404）や CloudFront の SPA フォールバック HTML は空状態として扱う
      if (message.includes('status: 404') || message.includes('Non-JSON response received')) {
        setLatestData(null)
        setError(null)
      } else {
        setError(err as Error)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // 自動更新（1分間隔）
  useInterval(fetchData, API_CONFIG.pollingInterval)

  if (loading && !latestData) {
    return <Loading message="データを読み込んでいます..." />
  }

  if (error && !latestData) {
    return (
      <ErrorMessage
        message={error.message}
        onRetry={fetchData}
      />
    )
  }

  if (!latestData) {
    return <EmptyState message="センサーデータがありません" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          センサーダッシュボード
        </h1>
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-600">
            最終更新: {formatRelativeTime(latestData.timestamp)}
          </p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            disabled={loading}
          >
            {loading ? '更新中...' : '手動更新'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard
          label={METRICS_CONFIG.temperature.label}
          value={latestData.temperature}
          unit={METRICS_CONFIG.temperature.unit}
          color={METRICS_CONFIG.temperature.color}
        />
        <MetricCard
          label={METRICS_CONFIG.humidity.label}
          value={latestData.humidity}
          unit={METRICS_CONFIG.humidity.unit}
          color={METRICS_CONFIG.humidity.color}
        />
        <MetricCard
          label={METRICS_CONFIG.co2.label}
          value={latestData.co2}
          unit={METRICS_CONFIG.co2.unit}
          color={METRICS_CONFIG.co2.color}
        />
      </div>

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
