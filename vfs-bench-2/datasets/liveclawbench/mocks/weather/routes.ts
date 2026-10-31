/**
 * The weather fake's routes: upstream's `src/index.tsx`, its pages' markup
 * and its JSON copied as they are, over the run's Prisma client.
 *
 * Upstream's "today" is the date in China Standard Time when the request
 * arrives, and it reseeds when that date moves on. Here it is the run's
 * frozen clock (`/reset`'s epoch), which the fixture was seeded at, so the
 * date never moves and the reseed never happens.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { C } from './config.ts'

const HTML = 'text/html; charset=utf-8'

/** Upstream's `cstDateStr`. */
function cstDateStr(d: Date): string {
  const cst = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const year = cst.getUTCFullYear()
  const month = String(cst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(cst.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** The run's now, without a tick: every route here reads. */
const now = (ctx: Ctx<C>) => Date.parse(ctx.clock.lastIso())
const today = (ctx: Ctx<C>) => cstDateStr(new Date(now(ctx)))
const tomorrow = (ctx: Ctx<C>) => cstDateStr(new Date(now(ctx) + 24 * 60 * 60 * 1000))

/** Upstream's `formatDate`, which reads the date in local time (the run's is UTC). */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function getLocation(db: C, slug: string) {
  return db.location.findUnique({ where: { slug } })
}

async function renderNav(db: C, currentSlug: string): Promise<string> {
  const locations = await db.location.findMany({ select: { slug: true, display_name: true }, orderBy: { id: 'asc' } })
  return `<nav style="padding:8px 16px;background:#1a73e8;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <a href="/search" style="color:#fff;font-weight:bold;text-decoration:none;font-size:16px">天气预报</a>
    ${locations.map((l) => `<a href="/location/${l.slug}" style="color:${l.slug === currentSlug ? '#ffd' : '#cce'};text-decoration:none;padding:4px 8px;border-radius:4px">${l.display_name}</a>`).join('')}
    <form action="/search" method="get" style="margin-left:auto;display:flex;gap:4px">
      <input name="q" placeholder="搜索城市" style="padding:4px 8px;border-radius:4px;border:none;font-size:14px"/>
      <button type="submit" style="padding:4px 10px;background:#0d47a1;color:#fff;border:none;border-radius:4px;cursor:pointer">搜索</button>
    </form>
  </nav>`
}

async function renderPage(db: C, title: string, body: string, slug = '', status = 200): Promise<Reply> {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} - 天气预报</title>
<style>
body{margin:0;font-family:'PingFang SC','Microsoft YaHei',sans-serif;background:#f5f5f5;color:#333}
.container{max-width:960px;margin:0 auto;padding:16px}
.card{background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1,h2,h3{margin:0 0 8px}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #eee}
th{background:#f0f4ff;font-weight:600}
a{color:#1a73e8;text-decoration:none}
a:hover{text-decoration:underline}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600}
.good{background:#e8f5e9;color:#2e7d32}
.moderate{background:#fff3e0;color:#e65100}
.unhealthy_sensitive{background:#fce4ec;color:#c62828}
</style>
</head>
<body>
${await renderNav(db, slug)}
<div class="container">${body}</div>
</body>
</html>`
  return { status, body: Buffer.from(html), headers: { 'Content-Type': HTML } }
}

function renderNotFound(db: C, slug: string): Promise<Reply> {
  return renderPage(db, '未找到城市', `<div class="card"><h2>未找到城市</h2><p>城市"${escHtml(slug)}"不存在。</p><a href="/">返回首页</a></div>`, '', 404)
}

async function locationPage(ctx: Ctx<C>): Promise<Reply> {
  const db = ctx.db
  const slug = ctx.params.slug ?? ''
  const loc = await getLocation(db, slug)
  if (!loc) return renderNotFound(db, slug)

  const todayStr = today(ctx)
  const tomorrowStr = tomorrow(ctx)
  const dailyRows = await db.weatherDaily.findMany({ where: { location_id: loc.id }, orderBy: [{ valid_date: 'asc' }, { id: 'asc' }] })
  const todayDaily = dailyRows.find((r) => r.valid_date === todayStr) ?? dailyRows[0]
  const tomorrowDaily = dailyRows.find((r) => r.valid_date === tomorrowStr) ?? null
  const aqi = await db.airQualitySnapshot.findFirst({ where: { location_id: loc.id }, orderBy: { id: 'asc' } })
  const tips = await db.healthActivityTip.findMany({ where: { location_id: loc.id }, orderBy: [{ valid_date: 'asc' }, { id: 'asc' }] })

  const body = `
<div class="card">
  <h1>${loc.display_name} <small style="font-size:14px;color:#666">${loc.timezone_label}</small></h1>
  <p style="margin:0;color:#666">${formatDate(todayStr)}</p>
</div>
<div class="card">
  <h2>今天 <span style="font-size:14px;color:#666">${formatDate(todayDaily?.valid_date ?? todayStr)}</span></h2>
  <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin:8px 0">
    <div style="font-size:48px;font-weight:200">${todayDaily?.temp_high_c ?? '--'}°C</div>
    <div>
      <div style="font-size:18px">${todayDaily?.condition_text ?? '--'}</div>
      <div style="color:#666">最高 ${todayDaily?.temp_high_c ?? '--'}°C / 最低 ${todayDaily?.temp_low_c ?? '--'}°C</div>
      <div style="color:#666">风向：${todayDaily?.wind_dir ?? '--'} ${todayDaily?.wind_speed_kmh ?? '--'}km/h</div>
    </div>
  </div>
  <div style="display:flex;gap:12px">
    <a href="/location/${slug}/hourly">逐小时预报</a>
    <a href="/location/${slug}/daily">多日预报</a>
  </div>
</div>
${tomorrowDaily ? `
<div class="card">
  <h2>明天 <span style="font-size:14px;color:#666">${formatDate(tomorrowDaily.valid_date)}</span></h2>
  <div style="color:#666">${tomorrowDaily.condition_text} / ${tomorrowDaily.temp_high_c}°C / ${tomorrowDaily.temp_low_c}°C</div>
</div>` : ''}
${aqi ? `
<div class="card">
  <h2>空气质量</h2>
  <p>AQI：<strong>${aqi.aqi}</strong> <span class="badge ${aqi.category}">${aqi.category}</span></p>
  <p style="color:#666">${aqi.summary_text}</p>
</div>` : ''}
${tips.length > 0 ? `
<div class="card">
  <h2>健康建议</h2>
  ${tips.map((t) => `<div style="margin-bottom:12px"><strong>${t.tip_title}</strong> <span style="font-size:12px;color:#999">${formatDate(t.valid_date)}</span><p style="margin:4px 0;color:#555">${t.tip_body}</p></div>`).join('')}
</div>` : ''}
`
  return renderPage(db, loc.display_name, body, slug)
}

async function hourlyPage(ctx: Ctx<C>): Promise<Reply> {
  const db = ctx.db
  const slug = ctx.params.slug ?? ''
  const loc = await getLocation(db, slug)
  if (!loc) return renderNotFound(db, slug)

  const todayStr = today(ctx)
  const tomorrowStr = tomorrow(ctx)
  const hourlyRows = await db.weatherHourly.findMany({
    where: { location_id: loc.id },
    orderBy: [{ valid_date: 'asc' }, { hour: 'asc' }, { id: 'asc' }],
  })
  const todayHours = hourlyRows.filter((r) => r.valid_date === todayStr)
  const tomorrowHours = hourlyRows.filter((r) => r.valid_date === tomorrowStr).slice(0, 6)

  const body = `
<div class="card">
  <a href="/location/${slug}">← 返回 ${loc.display_name}</a>
  <h1 style="margin-top:8px">${loc.display_name} 逐小时预报</h1>
</div>
<div class="card">
  <h2>今天</h2>
  <table>
    <thead><tr><th>时间</th><th>温度</th><th>体感</th><th>天气</th><th>降水(mm)</th><th>湿度</th><th>云量</th></tr></thead>
    <tbody>
      ${todayHours.map((h) => `<tr><td>${String(h.hour).padStart(2, '0')}:00</td><td>${h.temp_c}°C</td><td>${h.feels_like_c}°C</td><td>${h.condition_text}</td><td>${h.precip_mm.toFixed(1)}</td><td>${h.humidity}%</td><td>${h.cloud_cover}%</td></tr>`).join('')}
    </tbody>
  </table>
</div>
${tomorrowHours.length > 0 ? `
<div class="card">
  <h2>明日预览</h2>
  <table>
    <thead><tr><th>时间</th><th>温度</th><th>体感</th><th>天气</th><th>降水(mm)</th><th>湿度</th><th>云量</th></tr></thead>
    <tbody>
      ${tomorrowHours.map((h) => `<tr><td>${String(h.hour).padStart(2, '0')}:00</td><td>${h.temp_c}°C</td><td>${h.feels_like_c}°C</td><td>${h.condition_text}</td><td>${h.precip_mm.toFixed(1)}</td><td>${h.humidity}%</td><td>${h.cloud_cover}%</td></tr>`).join('')}
    </tbody>
  </table>
</div>` : ''}
`
  return renderPage(db, `${loc.display_name} 逐小时`, body, slug)
}

async function dailyPage(ctx: Ctx<C>): Promise<Reply> {
  const db = ctx.db
  const slug = ctx.params.slug ?? ''
  const loc = await getLocation(db, slug)
  if (!loc) return renderNotFound(db, slug)

  const todayStr = today(ctx)
  const dailyRows = await db.weatherDaily.findMany({ where: { location_id: loc.id }, orderBy: [{ valid_date: 'asc' }, { id: 'asc' }] })

  const body = `
<div class="card">
  <a href="/location/${slug}">← 返回 ${loc.display_name}</a>
  <h1 style="margin-top:8px">${loc.display_name} 多日预报</h1>
</div>
<div class="card">
  <table>
    <thead><tr><th>日期</th><th>天气</th><th>最高</th><th>最低</th><th>降水(mm)</th><th>风向</th></tr></thead>
    <tbody>
      ${dailyRows.map((d) => `<tr>
        <td>${d.valid_date === todayStr ? '今天' : '明天'} ${formatDate(d.valid_date)}</td>
        <td>${d.condition_text}</td>
        <td>${d.temp_high_c}°C</td>
        <td>${d.temp_low_c}°C</td>
        <td>${d.precip_mm}</td>
        <td>${d.wind_dir} ${d.wind_speed_kmh}km/h</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>
`
  return renderPage(db, `${loc.display_name} 多日预报`, body, slug)
}

interface LocationRow {
  id: number
  slug: string
  display_name: string
  timezone_label: string
}

async function searchPage(ctx: Ctx<C>): Promise<Reply> {
  const db = ctx.db
  const q = ctx.query.get('q') ?? ''
  // Upstream's LIKE, wildcards in `q` included, which Prisma's `contains` escapes.
  const rows = (await db.$queryRawUnsafe('SELECT * FROM location WHERE display_name LIKE ?', `%${q}%`)) as LocationRow[]

  if (rows.length === 1) return { status: 302, headers: { Location: `/location/${rows[0]!.slug}` } }

  const qEsc = escHtml(q)
  const title = q ? `搜索"${qEsc}"` : '城市列表'
  let body: string
  if (rows.length === 0) {
    body = `<div class="card"><h2>未找到城市</h2><p>没有找到与"${qEsc}"匹配的城市。</p><a href="/search">查看全部城市</a></div>`
  } else {
    body = `<div class="card">
  <h2>${title}</h2>
  <ul style="padding:0;list-style:none;margin:0">
    ${rows.map((l) => `<li style="padding:8px 0;border-bottom:1px solid #eee"><a href="/location/${l.slug}" style="font-size:16px">${l.display_name}</a></li>`).join('')}
  </ul>
</div>`
  }
  return renderPage(db, title, body)
}

async function locations(ctx: Ctx<C>): Promise<Reply> {
  const rows = await ctx.db.location.findMany({ orderBy: { id: 'asc' } })
  return {
    status: 200,
    body: { ok: true, data: rows.map((r) => ({ id: r.id, slug: r.slug, display_name: r.display_name, timezone_label: r.timezone_label })) },
  }
}

const cityNotFound: Reply = { status: 404, body: { ok: false, error: 'city not found' } }

async function airQuality(ctx: Ctx<C>): Promise<Reply> {
  const slug = ctx.params.slug ?? ''
  const loc = await getLocation(ctx.db, slug)
  if (!loc) return cityNotFound
  const row = await ctx.db.airQualitySnapshot.findFirst({ where: { location_id: loc.id }, orderBy: { id: 'asc' } })
  if (!row) return cityNotFound
  return {
    status: 200,
    body: {
      ok: true,
      data: { location_slug: slug, observed_at: row.observed_at, aqi: row.aqi, category: row.category, summary_text: row.summary_text },
    },
  }
}

async function healthTips(ctx: Ctx<C>): Promise<Reply> {
  const slug = ctx.params.slug ?? ''
  const loc = await getLocation(ctx.db, slug)
  if (!loc) return cityNotFound
  const rows = await ctx.db.healthActivityTip.findMany({
    select: { valid_date: true, tip_title: true, tip_body: true },
    where: { location_id: loc.id },
    orderBy: [{ valid_date: 'asc' }, { id: 'asc' }],
  })
  return { status: 200, body: { ok: true, data: rows } }
}

/** Hono's own 404. */
const notFound = (): Reply => ({
  status: 404,
  body: Buffer.from('404 Not Found'),
  headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
})

export function weatherRoutes(): KitRoute<C>[] {
  return [
    // mock-lib's health check, with its default body.
    route<C>('GET', '/health', () => ({ status: 200, body: { ok: true, status: 'healthy', service: 'weather' } })),
    route<C>('GET', '/__mock_sentinel__/weather', () => ({ status: 200, body: { mock: 'weather', sentinel: true } })),
    route<C>('GET', '/', () => ({ status: 302, headers: { Location: '/location/beijing' } })),
    route<C>('GET', '/location/:slug', locationPage),
    route<C>('GET', '/location/:slug/hourly', hourlyPage),
    route<C>('GET', '/location/:slug/daily', dailyPage),
    route<C>('GET', '/search', searchPage),
    route<C>('GET', '/api/locations', locations),
    route<C>('GET', '/api/location/:slug/air-quality', airQuality),
    route<C>('GET', '/api/location/:slug/health-tips', healthTips),
    ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => route<C>(method, '/*rest', notFound)),
  ]
}
