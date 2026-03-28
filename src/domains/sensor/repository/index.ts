import { API_CONFIG } from '../config'
import { sensorRepository } from './SensorRepository'
import { mockSensorRepository } from './MockSensorRepository'

/**
 * リポジトリのファクトリ関数
 * 開発モードではモックを返す
 */
export function getSensorRepository() {
  return API_CONFIG.useMockData ? mockSensorRepository : sensorRepository
}

export { SensorRepository } from './SensorRepository'
export { MockSensorRepository } from './MockSensorRepository'
