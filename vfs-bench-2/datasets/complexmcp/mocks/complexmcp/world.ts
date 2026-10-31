/**
 * A ComplexMCP session's world: LightSystem's clock and each app the task
 * logs into, made as upstream's client logs in (`AgentClient.__login`):
 * LightSystem with the task's seed, then each app in the task's order with
 * the same seed and a connector to that clock. LightStock's login trades and
 * LightNews's draws past times, so each app's world depends on the ones
 * before it; every fake makes the whole login and keeps its own app's part.
 */
import type { Os } from './common.ts'
import { FlightSession, LightFlight } from './flight.ts'
import { LightNews, NewsSession } from './news.ts'
import { LightShop, ShopSession } from './shop.ts'
import { LightStock, StockSession } from './stock.ts'
import { Clock, LightSystem } from './system.ts'
import { LightTalk, Talk } from './talk.ts'
import type { App } from './tool.ts'
import { LightWeather, WeatherSession } from './weather.ts'

export type AppName = 'LightSystem' | 'LightTalk' | 'LightShop' | 'LightWeather' | 'LightFlight' | 'LightStock' | 'LightNews'

/** Each app, in upstream's configuration's order (`config/general.yaml`). */
export const APPS: Record<AppName, App<any, any>> = {
  LightSystem,
  LightTalk,
  LightShop,
  LightWeather,
  LightFlight,
  LightStock,
  LightNews,
}

const CREATE: Record<Exclude<AppName, 'LightSystem'>, (seed: number, os: Os) => Promise<{ data(): unknown }>> = {
  LightTalk: Talk.create,
  LightShop: ShopSession.create,
  LightWeather: WeatherSession.create,
  LightFlight: FlightSession.create,
  LightStock: StockSession.create,
  LightNews: NewsSession.create,
}

/** The logins of a task: each logged-in app's stored session, LightSystem's clock among them. */
export async function login(seed: number, apps: AppName[]): Promise<Partial<Record<AppName, unknown>>> {
  const clock = Clock.create(seed)
  const out: Partial<Record<AppName, unknown>> = {}
  for (const app of apps) {
    if (app === 'LightSystem') continue
    out[app] = (await CREATE[app](seed, clock.os())).data()
  }
  out.LightSystem = clock.data()
  return out
}
