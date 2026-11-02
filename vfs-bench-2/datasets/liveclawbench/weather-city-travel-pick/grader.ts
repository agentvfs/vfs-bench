import { type Grader, grade } from '../../../workspace/grader.ts'
export const grader: Grader = (c) => {
    const path = '/workspace/output/travel_pick.json'
    let r: any = {}
    try {
      r = c.json(path)
    } catch {}
    const integer = (key: string) => {
      try {
        return c.jsonInteger(path, key)
      } catch {
        return false
      }
    }
    const dim_city = r.city === 'shanghai' ? 0.4 : 0,
      dim_aqi = integer('aqi') && r.aqi === 35 ? 0.3 : 0,
      dim_temp = integer('temp_high_c') && Math.abs(r.temp_high_c - 22) <= 1 ? 0.3 : 0
    const score = dim_city + dim_aqi + dim_temp
    return {
      ...grade(score),
      rewards: {
        reward: score,
        dim_city,
        dim_aqi,
        dim_temp,
        _meta_aqi_got:
          typeof r.aqi === 'number' ? Math.trunc(r.aqi) : typeof r.aqi === 'boolean' ? Number(r.aqi) : -1,
      },
      artifacts: { 'reward_details.json': { _meta_city_got: String(r.city ?? '') } },
    }
  }
