import { z } from 'zod'

/**
 * SensorDataのZodスキーマ
 */
export const SensorDataSchema = z.object({
  deviceId: z.string(),
  timestamp: z.number().int().positive(),
  temperature: z.number().min(-50).max(100),
  humidity: z.number().min(0).max(100),
  co2: z.number().int().min(0).max(10000),
})

/**
 * SensorDataResponseのZodスキーマ
 */
export const SensorDataResponseSchema = z.object({
  data: z.array(SensorDataSchema),
  count: z.number().int().nonnegative(),
})
