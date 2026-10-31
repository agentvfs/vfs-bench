
export const HEALTH = '/var/lib/mock-data/health/health.db',
  MINT = '/var/lib/mock-data/mint-diet/mint-diet.sqlite',
  INSURANCE = '/var/lib/mock-data/insurance/insurance.db'
export const date = (d: Date) => d.toISOString().slice(0, 10)
export const close = (a: any, b: number, t: number) => typeof a === 'number' && Math.abs(a - b) <= t
