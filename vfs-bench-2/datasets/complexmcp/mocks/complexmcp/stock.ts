/**
 * LightStock (`software/LightStock/stock.py`): the corpus's stocks at
 * prices drawn from the session's seed, an account, a portfolio and its
 * orders, and the app's tools, statement for statement. Trading takes the
 * trade password first; shorting and stop-losses are for VIPs.
 */
import { type Os, PyError, clone, corpus, sorted, uuid } from './common.ts'
import { F, type PyNum, add, div, mul, num, round, str, sub } from '../../../../workspace/py.ts'
import { PyRandom } from './pyrandom.ts'
import type { RandomState } from './pyrandom.ts'
import { type App, type Tools, failed, ok } from './tool.ts'

interface Stock {
  ticker: string
  name: string
  price: PyNum
  sector: string
  description: string
  pe_ratio: PyNum
  market_cap: string
}

interface Position {
  ticker: string
  quantity: number
  avg_price: PyNum
}

interface PendingOrder {
  oid: string
  ticker: string
  side: string
  quantity: number
  price_type: string
  limit_price: PyNum
  frozen_margin: PyNum
}

interface Trade {
  timestamp: string
  trid: string
  ticker: string
  side: string
  quantity: number
  price: PyNum
  total_amount: PyNum
  fee: PyNum
}

export interface StockData {
  stocks: Record<string, Stock>
  market_open: boolean
  trading_balance: PyNum
  savings_balance: PyNum
  frozen_margin: PyNum
  user_tier: string
  day_trades_remaining: number
  portfolio: Record<string, Position>
  pending_orders: PendingOrder[]
  trade_history: Trade[]
  watchlist: string[]
  price_alerts: Record<string, PyNum>
  fee_rate: PyNum
  vip_fee: number
  password_verified: boolean
  rng: RandomState
}

type Result = { status: string; output: unknown }

export class StockSession {
  d: StockData
  rng: PyRandom
  os: Os

  constructor(d: StockData, os: Os) {
    this.d = d
    this.rng = PyRandom.from(d.rng)
    this.os = os
  }

  /** `StockSession(seed, os_cfg)`. */
  static async create(seed: number, os: Os): Promise<StockSession> {
    const rng = new PyRandom(seed)
    const stocks: Record<string, Stock> = {}
    type Raw = { ticker: string; name: string; price: PyNum; sector: string; description: string; pe_ratio: PyNum; market_cap: string }
    for (const raw of corpus<{ stocks: Raw[] }>('LightStock', 'stock.yaml').stocks) {
      const price = round(mul(raw.price, F(rng.uniform(0.8, 1.6))), 2)
      const pe = round(mul(raw.pe_ratio, F(rng.uniform(0.9, 1.1))), 2)
      const cap = round(mul(F(Number(raw.market_cap.slice(0, -1))), F(rng.uniform(0.9, 1.4))), 2)
      stocks[raw.ticker] = {
        ticker: raw.ticker,
        name: raw.name,
        price,
        sector: raw.sector,
        description: raw.description,
        pe_ratio: pe,
        market_cap: str(cap) + raw.market_cap.slice(-1),
      }
    }
    const d: StockData = {
      stocks,
      market_open: rng.choice([true, true, false]),
      trading_balance: rng.randint(10000, 50000),
      savings_balance: rng.randint(50000, 150000),
      frozen_margin: F(0),
      user_tier: rng.choice(['Basic', 'VIP']),
      day_trades_remaining: rng.randint(1, 3),
      portfolio: {},
      pending_orders: [],
      trade_history: [],
      watchlist: [],
      price_alerts: {},
      fee_rate: F(0),
      vip_fee: 8000,
      password_verified: false,
      rng: [[], null],
    }
    d.fee_rate = mul(F(0.002), F(rng.uniform(0.5, 1.5)))
    const s = new StockSession(d, os)
    s.rng = rng
    // `__mock_environment`
    if (!(rng.uniform(0, 1) < 0.5)) {
      const k = rng.randint(1, 3)
      for (const ticker of rng.choices(Object.keys(stocks), k)) {
        d.day_trades_remaining += 1
        s.waitTradePassword()
        await s.placeMarketOrder(ticker, 'buy', rng.randint(1, 15))
      }
      const limit = rng.choice(Object.values(stocks))
      d.day_trades_remaining += 1
      s.waitTradePassword()
      const quantity = rng.randint(10, 100)
      const price = round(mul(limit.price, F(rng.uniform(0.85, 0.97))), 2)
      s.placeLimitOrder(limit.ticker, 'buy', quantity, price)
    }
    d.password_verified = false
    return s
  }

  data(): StockData {
    return { ...this.d, rng: this.rng.getstate() }
  }

  waitTradePassword() {
    this.d.password_verified = true
    return ok('The user has enterred the correct password')
  }

  /** `@require_market_open`, `@require_password`, `@require_trade_cnt` and `@require_vip`, in the order given. */
  guard(checks: ('market' | 'password' | 'count' | 'vip')[]): Result | null {
    for (const check of checks) {
      if (check === 'market' && !this.d.market_open) return failed('The market is currently closed for trading')
      if (check === 'password') {
        if (!this.d.password_verified) return failed('Please enter the trading password first')
        this.d.password_verified = false
      }
      if (check === 'count' && this.d.user_tier !== 'VIP' && this.d.day_trades_remaining === 0) {
        return failed('Daily trade limit reached. No remaining quota for today. Please upgrade to VIP to unlock unlimited trading.')
      }
      if (check === 'vip' && this.d.user_tier !== 'VIP') return failed('This operation need VIP')
    }
    return null
  }

  async placeMarketOrder(tickerIn: string, side: string, quantity: number): Promise<Result> {
    const g = this.guard(['market', 'password', 'count'])
    if (g) return g
    const ticker = tickerIn.toUpperCase()
    const stock = this.d.stocks[ticker]
    if (!stock) return failed('Invalid ticker')
    const total = mul(stock.price, quantity)
    const fee = round(pyMin(mul(this.d.fee_rate, total), 100), 2)
    if (side === 'buy') {
      const available = sub(this.d.trading_balance, this.d.frozen_margin)
      if (num(available) < num(add(total, fee))) {
        return failed(`Insufficient available cash. You have ${str(this.d.trading_balance)}$ in total, and ${str(this.d.frozen_margin)}$ is frozen by pending orders.`)
      }
      this.d.trading_balance = sub(this.d.trading_balance, add(total, fee))
      const pos = this.d.portfolio[ticker] ?? { ticker, quantity: 0, avg_price: 0 }
      const qty = pos.quantity + quantity
      if (qty === 0) throw new PyError('float division by zero')
      const avg = div(add(mul(pos.avg_price, pos.quantity), total), qty)
      this.d.portfolio[ticker] = { ticker, quantity: qty, avg_price: round(avg, 2) }
    } else {
      const pos = this.d.portfolio[ticker]
      if ((!pos || pos.quantity < quantity) && this.d.user_tier !== 'VIP') return failed('Short selling is only available for VIP users.')
      this.d.trading_balance = add(this.d.trading_balance, sub(total, fee))
      const current = pos ? pos.quantity : 0
      this.d.portfolio[ticker] = { ticker, quantity: current - quantity, avg_price: pos ? pos.avg_price : stock.price }
    }
    const timestamp = await this.os.step()
    this.d.trade_history.push({ timestamp, trid: `trans_${uuid(this.rng)}`, ticker, side, quantity, price: stock.price, total_amount: total, fee })
    if (this.d.user_tier !== 'VIP') this.d.day_trades_remaining -= 1
    return ok(`Market order executed. ${side} ${quantity} shares of ${ticker}, fee: ${str(fee)}$`)
  }

  placeLimitOrder(ticker: string, side: string, quantity: number, limitPrice: PyNum): Result {
    const g = this.guard(['market', 'password', 'count'])
    if (g) return g
    const cost = mul(limitPrice, quantity)
    const available = sub(this.d.trading_balance, this.d.frozen_margin)
    if (side === 'buy') {
      if (num(available) < num(cost)) {
        return failed(`Insufficient available cash. Total: ${str(this.d.trading_balance)}$, Frozen: ${str(this.d.frozen_margin)}$, Needed: ${str(cost)}$`)
      }
      this.d.frozen_margin = add(this.d.frozen_margin, cost)
    }
    const oid = `order_${uuid(this.rng)}`
    this.d.pending_orders.push({ oid, ticker: ticker.toUpperCase(), side, quantity, price_type: 'limit', limit_price: limitPrice, frozen_margin: side === 'buy' ? cost : 0 })
    if (this.d.user_tier !== 'VIP') this.d.day_trades_remaining -= 1
    return ok(`Limit order ${oid} placed. ${str(cost)} is now frozen.`)
  }
}

/** Python's `min(a, b)`: the first of the smallest, as it is. */
function pyMin(a: PyNum, b: PyNum): PyNum {
  return num(b) < num(a) ? b : a
}

const tools: Tools<StockSession> = {
  get_account_summary: {
    params: [],
    run: async (s) =>
      ok({ tier: s.d.user_tier, 'trading balance': s.d.trading_balance, 'savings balance': s.d.savings_balance, 'frozen margin': s.d.frozen_margin }),
  },
  list_all_sectors: { params: [], run: async (s) => ok(sorted([...new Set(Object.values(s.d.stocks).map((x) => x.sector))])) },
  list_all_tickers_by_sector: {
    params: [['sector', 'str']],
    run: async (s, { sector }) => {
      const want = (sector as string).toLowerCase().trim()
      return ok(Object.values(s.d.stocks).filter((x) => x.sector.toLowerCase() === want).map((x) => x.ticker))
    },
  },
  search_stocks: {
    params: [['query', 'str']],
    run: async (s, { query }) => {
      const q = (query as string).toLowerCase()
      return ok(
        Object.values(s.d.stocks)
          .filter((x) => x.ticker.toLowerCase().includes(q) || x.name.toLowerCase().includes(q))
          .map((x) => ({ ticker: x.ticker, name: x.name, price: x.price })),
      )
    },
  },
  get_stock_details: {
    params: [['ticker', 'str']],
    run: async (s, { ticker }) => {
      const stock = s.d.stocks[(ticker as string).toUpperCase()]
      return stock ? ok(clone(stock)) : failed(`Ticker ${ticker} not found`)
    },
  },
  wait_trade_password: { params: [], run: async (s) => s.waitTradePassword() },
  transfer_funds: {
    params: [['amount', 'float'], ['direction', 'str']],
    run: async (s, { amount, direction }) => {
      if (direction === 's2t') {
        if (num(s.d.savings_balance) < num(amount)) return failed('Insufficient savings balance.')
        s.d.savings_balance = sub(s.d.savings_balance, amount)
        s.d.trading_balance = add(s.d.trading_balance, amount)
      } else {
        if (num(s.d.trading_balance) < num(amount)) return failed('Insufficient trading balance.')
        s.d.trading_balance = sub(s.d.trading_balance, amount)
        s.d.savings_balance = add(s.d.savings_balance, amount)
      }
      return ok(`Transferred ${str(amount)} successfully.`)
    },
  },
  place_market_order: {
    params: [['ticker', 'str'], ['side', 'str'], ['quantity', 'int']],
    run: (s, { ticker, side, quantity }) => s.placeMarketOrder(ticker, side, quantity),
  },
  place_limit_order: {
    params: [['ticker', 'str'], ['side', 'str'], ['quantity', 'int'], ['limit_price', 'float']],
    run: async (s, { ticker, side, quantity, limit_price }) => s.placeLimitOrder(ticker, side, quantity, limit_price),
  },
  place_stop_loss_order: {
    params: [['ticker', 'str'], ['quantity', 'int'], ['stop_price', 'float']],
    run: async (s, { ticker: tickerIn, quantity, stop_price }) => {
      const g = s.guard(['market', 'password', 'count', 'vip'])
      if (g) return g
      const ticker = (tickerIn as string).toUpperCase()
      const stock = s.d.stocks[ticker]
      if (!stock) return failed('Invalid ticker.')
      if (num(stop_price) >= num(stock.price)) {
        return failed(`Stop price (${str(stop_price)}) must be lower than the current price (${str(stock.price)}).`)
      }
      const pos = s.d.portfolio[ticker]
      if (!pos || pos.quantity < quantity) {
        return failed(`You don't have enough shares of ${ticker} to set a stop-loss. Current: ${pos ? pos.quantity : 0}`)
      }
      const oid = `order_${uuid(s.rng)}`
      s.d.pending_orders.push({ oid, ticker, side: 'sell', quantity, price_type: 'stop_loss', limit_price: stop_price, frozen_margin: F(0) })
      if (s.d.user_tier !== 'VIP') s.d.day_trades_remaining -= 1
      return ok(`Stop-loss order ${oid} for ${ticker} set at ${str(stop_price)}. It will trigger automatically if the price drops.`)
    },
  },
  get_portfolio: {
    params: [],
    run: async (s) => {
      const list = Object.values(s.d.portfolio)
      return list.length === 0 ? ok('You currently hold no positions.') : ok(clone(list))
    },
  },
  get_pending_orders: {
    params: [],
    run: async (s) => (s.d.pending_orders.length === 0 ? ok('No pending orders.') : ok(clone(s.d.pending_orders))),
  },
  cancel_order: {
    params: [['oid', 'str']],
    run: async (s, { oid }) => {
      const i = s.d.pending_orders.findIndex((o) => o.oid === oid)
      if (i >= 0) {
        const order = s.d.pending_orders[i]!
        if (order.side === 'buy') {
          s.d.trading_balance = add(s.d.trading_balance, order.frozen_margin)
          s.d.frozen_margin = sub(s.d.frozen_margin, order.frozen_margin)
        }
        s.d.pending_orders.splice(i, 1)
        return ok(`Order ${oid} cancelled successfully.`)
      }
      return failed('Order ID not found.')
    },
  },
  get_trade_history: { params: [], run: async (s) => ok(clone(s.d.trade_history)) },
  toggle_watchlist: {
    params: [['ticker', 'str']],
    run: async (s, { ticker: tickerIn }) => {
      const ticker = (tickerIn as string).toUpperCase()
      if (!(ticker in s.d.stocks)) return failed('Invalid ticker')
      if (s.d.watchlist.includes(ticker)) {
        s.d.watchlist = s.d.watchlist.filter((t) => t !== ticker)
        return ok(`Removed ${ticker} from watchlist.`)
      }
      s.d.watchlist.push(ticker)
      return ok(`Added ${ticker} to watchlist.`)
    },
  },
  get_watchlist_details: {
    params: [],
    run: async (s) => ok(s.d.watchlist.map((t) => ({ ticker: t, price: s.d.stocks[t]!.price, pe: s.d.stocks[t]!.pe_ratio }))),
  },
  check_vip_price: { params: [], run: async (s) => ok(s.d.vip_fee) },
  upgrade_to_vip: {
    params: [],
    run: async (s) => {
      const g = s.guard(['password'])
      if (g) return g
      if (s.d.user_tier === 'VIP') return failed('You are already a VIP member. No further upgrade is required.')
      const fee = s.d.vip_fee
      const available = sub(s.d.trading_balance, s.d.frozen_margin)
      if (num(available) < fee) {
        if (num(s.d.trading_balance) >= fee) {
          return failed(
            `Insufficient available cash to upgrade. Your total balance is ${str(s.d.trading_balance)}, ` +
              `and ${str(s.d.frozen_margin)} is frozen by pending orders. ` +
              'Please cancel some orders or transfer funds from savings.',
          )
        }
        return failed(`Insufficient funds. The VIP upgrade requires ${fee}$, but your trading balance is ${str(s.d.trading_balance)}$.`)
      }
      s.d.trading_balance = sub(s.d.trading_balance, fee)
      s.d.user_tier = 'VIP'
      return ok(`Congratulations! You have successfully upgraded to VIP. ${fee}$ has been deducted from your balance.`)
    },
  },
  get_day_trades_remaining: {
    params: [],
    run: async (s) => (s.d.user_tier === 'Basic' ? ok(s.d.day_trades_remaining) : ok('Unlimited')),
  },
  set_price_alert: {
    params: [['ticker', 'str'], ['price', 'float']],
    run: async (s, { ticker, price }) => {
      if (!(ticker in s.d.stocks)) return failed(`Ticker ${ticker} not found`)
      s.d.price_alerts[ticker] = price
      return ok(`You have succussfully set one price alert: ${ticker} (${str(price)})`)
    },
  },
  remove_price_alert: {
    params: [['ticker', 'str']],
    run: async (s, { ticker }) => {
      if (!(ticker in s.d.price_alerts)) return failed(`Ticker ${ticker} not in alert table`)
      const price = s.d.price_alerts[ticker]!
      delete s.d.price_alerts[ticker]
      return ok(`You have succussfully removed one price alert: ${ticker} (${str(price)})`)
    },
  },
}

const byTrade = (x: { ticker: string; side: string; quantity: number }) => [x.ticker, x.side, x.quantity]

export const LightStock: App<StockSession, StockData> = {
  name: 'LightStock',
  tools,
  load: (data, os) => new StockSession(data, os),
  save: (s) => s.data(),
  sessionDict: (s) => ({
    user: {
      tier: s.d.user_tier,
      trading_balance: s.d.trading_balance,
      savings_balance: s.d.savings_balance,
      frozen_margin: s.d.frozen_margin,
    },
    stocks: {
      portfolio: sorted(clone(Object.values(s.d.portfolio)), (p) => p.ticker),
      pending_orders: sorted(clone(s.d.pending_orders), byTrade),
      trade_history: sorted(clone(s.d.trade_history), byTrade),
      watch_list: sorted(s.d.watchlist),
      price_alerts: clone(s.d.price_alerts),
    },
  }),
}
