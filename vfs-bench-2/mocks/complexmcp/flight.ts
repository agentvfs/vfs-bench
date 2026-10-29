/**
 * LightFlight (`software/LightFlight/flight.py`): the corpus's airports,
 * flights between them generated from the session's seed and LightSystem's
 * time at login, passengers, bookings and a balance, and the app's tools,
 * statement for statement.
 */
import { type Os, addSecs, clone, corpus, index, keyError, pop, sorted, uuid } from './common.ts'
import { Dataclass, F, type PyNum, add, dayOf, fixed, mul, num, parseDate, parseStamp, repr, roundInt, str, sub } from './py.ts'
import { PyRandom } from './pyrandom.ts'
import type { RandomState } from './pyrandom.ts'
import { type App, type Tools, failed, ok } from './tool.ts'

interface Flight {
  fid: string
  departure: string
  arrival: string
  departure_airport: string
  arrival_airport: string
  departure_time: string
  arrival_time: string
  duration: number
  price: number
  seat_count: Record<string, number>
}

interface Airport {
  aid: string
  name: string
  city: string
  code: string
  _coord: [number, number]
  star: boolean
}

interface Passenger {
  name: string
  light_talk_uid: string
}

interface Booking {
  bid: string
  fid: string
  seat_class: string
  total_price: PyNum
  passenger_info: Passenger
  paid: boolean
}

interface Record_ {
  id: string
  timestamp: string
  total_price: PyNum
  bookings: Record<string, Record<string, number>>
}

export interface FlightData {
  airports: Airport[]
  airports_in_cities: Record<string, string[]>
  flights: Record<string, Flight>
  /** `flights_by_arrival` and `flights_by_departure`, as fids. */
  by_arrival: Record<string, string[]>
  by_departure: Record<string, string[]>
  my_balance: PyNum
  current_bookings: Booking[]
  bookings_history: Record_[]
  refund_history: Record_[]
  passengers: Passenger[]
  my_starred_airports: string[]
  enter_password: boolean
  rng: RandomState
}

/** `__mock_dura_price`: minutes and price between two coordinates. */
function duraPrice(rng: PyRandom, [lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): [number, number] {
  const dlat = num(lat2) - num(lat1)
  const dlon = num(lon2) - num(lon1)
  const c = Math.cos(num(lat1) * (Math.PI / 180)) * dlon
  const distance = 111 * Math.sqrt(dlat * dlat + c * c)
  const hours = distance / 800
  let minutes = Math.trunc(roundInt(hours * 60 + 45))
  minutes = Math.trunc(minutes * rng.uniform(0.9, 1.1))
  minutes = Math.max(60, minutes)
  let price = distance * rng.uniform(0.8, 1.2)
  if (minutes < 120) price *= 1.5
  else if (minutes > 360) price *= 0.9
  price *= rng.uniform(0.3, 1.2)
  price = Math.max(300, Math.min(10000, price))
  return [minutes, roundInt(price / 10) * 10]
}

const passenger = (p: Passenger) => new Dataclass('PassengerInfo', { name: p.name, light_talk_uid: p.light_talk_uid })

export class FlightSession {
  d: FlightData
  rng: PyRandom
  os: Os

  constructor(d: FlightData, os: Os) {
    this.d = d
    this.rng = PyRandom.from(d.rng)
    this.os = os
  }

  /** `FlightSession(seed, os_cfg)`. */
  static async create(seed: number, os: Os): Promise<FlightSession> {
    const rng = new PyRandom(seed)
    const airports: Airport[] = []
    const inCities: Record<string, string[]> = {}
    for (const a of corpus<{ airports: Omit<Airport, 'star'>[] }>('LightFlight', 'airports.yaml').airports) {
      airports.push({ aid: a.aid, name: a.name, city: a.city, code: a.code, _coord: a._coord, star: false })
      ;(inCities[a.city] ??= []).push(a.name)
    }
    const flights: Record<string, Flight> = {}
    const byArrival: Record<string, string[]> = {}
    const byDeparture: Record<string, string[]> = {}
    const base = await os.now()
    for (const airport of airports) {
      let targets = rng.sample(airports, rng.randint(5, 50))
      targets = rng.choices(targets, 4 * targets.length)
      for (const target of targets) {
        const [dura, price] = duraPrice(rng, airport._coord, target._coord)
        const departure = addSecs(rng, base, 3600 * 4, 3600 * 10 * 24)
        const fid = `flight_${uuid(rng)}`
        const arrival = addSecs(rng, departure, dura * 60, dura * 60)
        const flight: Flight = {
          fid,
          departure: airport.city,
          arrival: target.city,
          departure_airport: airport.name,
          arrival_airport: target.name,
          departure_time: departure,
          arrival_time: arrival,
          duration: dura,
          price,
          seat_count: { economy: rng.randint(10, 50), business: rng.randint(0, 20), first: rng.randint(0, 7) },
        }
        flights[fid] = flight
        ;(byArrival[flight.arrival] ??= []).push(fid)
        ;(byDeparture[flight.departure] ??= []).push(fid)
      }
    }
    const d: FlightData = {
      airports,
      airports_in_cities: inCities,
      flights,
      by_arrival: byArrival,
      by_departure: byDeparture,
      my_balance: rng.randint(15000, 60000),
      current_bookings: [],
      bookings_history: [],
      refund_history: [],
      passengers: [],
      my_starred_airports: [],
      enter_password: false,
      rng: [[], null],
    }
    const s = new FlightSession(d, os)
    s.rng = rng
    // `__mock_booking`
    if (!(rng.uniform(0, 1) > 0.5)) {
      s.addPassenger('Carl Lee', '')
      const fid = rng.choice(Object.keys(flights))
      s.addToBooking(fid, 'economy', 0)
    }
    return s
  }

  data(): FlightData {
    return { ...this.d, rng: this.rng.getstate() }
  }

  flight(fid: string): [Flight | null, ReturnType<typeof failed<string>> | null] {
    const f = this.d.flights[fid]
    return f ? [f, null] : [null, failed(`Flight ID with ${fid} not found`)]
  }

  addPassenger(name: string, uid: string) {
    const p: Passenger = { name, light_talk_uid: uid ? uid : 'empty' }
    this.d.passengers.push(p)
    return ok(`You have successfully added a new passenger : ${passengerDict(p)}, index = ${this.d.passengers.length - 1}`)
  }

  addToBooking(fid: string, seatClass: string, idx: number) {
    const [f, err] = this.flight(fid)
    if (err) return err
    if (!(seatClass in f!.seat_count)) throw keyError(seatClass)
    if (f!.seat_count[seatClass] === 0) return failed('There is not enough seat count for this seat class')
    if (idx >= this.d.passengers.length) return failed('Passenger index out of range')
    const p = index(this.d.passengers, idx)
    const table: Record<string, PyNum> = { economy: f!.price, business: 2 * f!.price, first: mul(F(4.5), f!.price) }
    if (!(seatClass in table)) return failed(`Unsupported seat class \`${seatClass}\``)
    this.d.current_bookings.push({ bid: `booking_${uuid(this.rng)}`, fid: f!.fid, seat_class: seatClass, total_price: table[seatClass]!, passenger_info: clone(p), paid: false })
    return ok('You have successfully added one booking into list')
  }
}

/** `asdict(passenger)` in an f-string. */
const passengerDict = (p: Passenger) => repr({ name: p.name, light_talk_uid: p.light_talk_uid })

const airportRow = (a: Airport) => ({ aid: a.aid, name: a.name, city: a.city, code: a.code })

const tools: Tools<FlightSession> = {
  list_all_cities: { params: [], run: async (s) => ok(Object.keys(s.d.airports_in_cities)) },
  list_airports_by_city: {
    params: [['city', 'str']],
    run: async (s, { city }) => {
      const names = s.d.airports_in_cities[city]
      return names === undefined ? failed(`City '${city}' not found`) : ok(names)
    },
  },
  get_flight_details: {
    params: [['fid', 'str']],
    run: async (s, { fid }) => {
      const [f, err] = s.flight(fid)
      if (err) return err
      return ok({
        fid: f!.fid,
        departure: `${f!.departure}, ${f!.departure_airport}`,
        arrival: `${f!.arrival}, ${f!.arrival_airport}`,
        depature_time: f!.departure_time,
        arrival_time: f!.arrival_time,
        duration: `${f!.duration} min`,
        price: { ecomony: f!.price, business: f!.price * 2, first: mul(f!.price, F(4.5)) },
        seat_count: f!.seat_count,
      })
    },
  },
  search_flights: {
    params: [['departure', 'str'], ['arrival', 'str'], ['date', 'str']],
    run: async (s, { departure, arrival, date }) => {
      const text = (date as string).trim()
      const target = Array.from(text).length === 10 ? parseDate(text) : parseStamp(text)
      if (target === null) return failed(`Invalid date format: ${date}. Use 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS'`)
      const day = dayOf(target)
      const matched = []
      for (const fid of s.d.by_departure[departure] ?? []) {
        const f = s.d.flights[fid]!
        const dep = parseStamp(f.departure_time)
        if (dep === null || dayOf(dep) !== day) continue
        if (f.arrival === arrival) matched.push(f.fid)
      }
      return matched.length === 0 ? failed(`No flights found for ${departure} -> ${arrival} on ${date}`) : ok(matched)
    },
  },
  check_seat_availability: {
    params: [['fid', 'str'], ['seat_class', 'str']],
    run: async (s, { fid, seat_class }) => {
      const [f, err] = s.flight(fid)
      if (err) return err
      if (!(seat_class in f!.seat_count)) return failed(`Seat class \`${seat_class}\` not found`)
      return ok(`Remain ${f!.seat_count[seat_class]} seats`)
    },
  },
  check_passengers: { params: [], run: async (s) => ok(clone(s.d.passengers)) },
  add_passenger: { params: [['name', 'str'], ['light_talk_uid', 'str']], run: async (s, { name, light_talk_uid }) => s.addPassenger(name, light_talk_uid) },
  remove_passenger: {
    params: [['passenger_idx', 'int']],
    run: async (s, { passenger_idx }) => {
      if (passenger_idx >= s.d.passengers.length) return failed('Index out of range')
      const p = pop(s.d.passengers, passenger_idx)
      return ok(`You have succussfully removed one passenger : ${passengerDict(p)}`)
    },
  },
  add_to_booking: {
    params: [['fid', 'str'], ['seat_class', 'str'], ['passenger_idx', 'int']],
    run: async (s, { fid, seat_class, passenger_idx }) => s.addToBooking(fid, seat_class, passenger_idx),
  },
  check_bookings: { params: [], run: async (s) => ok(sorted(clone(s.d.current_bookings), (b) => b.paid)) },
  remove_from_booking: {
    params: [['bid', 'str']],
    run: async (s, { bid }) => {
      const i = s.d.current_bookings.findIndex((b) => b.bid === bid)
      if (i >= 0) {
        const b = s.d.current_bookings[i]!
        if (b.paid) {
          const shown = new Dataclass('BookingItem', { ...b, passenger_info: passenger(b.passenger_info) })
          return { stats: 'failed', output: `The booking (${str(shown)}) has already been paid` }
        }
        s.d.current_bookings.splice(i, 1)
        return ok('You have successfully removed one booking')
      }
      return failed(`Booking with bid=${bid} not found`)
    },
  },
  wait_payment_password: {
    params: [],
    run: async (s) => {
      s.d.enter_password = true
      return ok('The user has already entered the correct password')
    },
  },
  checkout_bookings: {
    params: [],
    run: async (s) => {
      if (!s.d.enter_password) return failed('This operation need user to enter the passward first')
      s.d.enter_password = false
      let all: PyNum = 0
      const seats: Record<string, Record<string, number>> = {}
      for (const b of s.d.current_bookings) {
        if (b.paid) continue
        all = add(all, b.total_price)
        const counts = (seats[b.fid] ??= {})
        counts[b.seat_class] = (counts[b.seat_class] ?? 0) + 1
      }
      if (num(all) > num(s.d.my_balance)) return failed('Your balance is insufficient')
      for (const b of s.d.current_bookings) b.paid = true
      s.d.my_balance = sub(s.d.my_balance, all)
      const id = `booking_rec_${uuid(s.rng)}`
      s.d.bookings_history.push({ id, timestamp: await s.os.step(), total_price: all, bookings: seats })
      return ok('You have successfully checkout all bookings')
    },
  },
  check_balance: { params: [], run: async (s) => ok(`$ ${str(s.d.my_balance)}`) },
  get_booking_history: {
    params: [],
    run: async (s) => ok(s.d.bookings_history.map((r) => ({ brid: r.id, timestamp: r.timestamp, total_price: r.total_price, bookings: clone(r.bookings) }))),
  },
  cancel_booking: {
    params: [['bids', 'list[str]']],
    run: async (s, { bids }) => {
      let total: PyNum = 0
      const refunds: Record<string, Record<string, number>> = {}
      let removed = 0
      for (const bid of bids as string[]) {
        const i = s.d.current_bookings.findIndex((b) => b.bid === bid)
        if (i < 0) return failed(`Booking ${bid} not found`)
        const b = s.d.current_bookings[i]!
        if (!b.paid) return failed(`Booking ${bid} has not been paid yet`)
        total = add(total, mul(b.total_price, F(0.95)))
        const counts = (refunds[b.fid] ??= {})
        counts[b.seat_class] = (counts[b.seat_class] ?? 0) + 1
        s.d.current_bookings.splice(i, 1)
        removed += 1
      }
      if (removed > 0) {
        const id = `refund_rec_${uuid(s.rng)}`
        s.d.refund_history.push({ id, timestamp: await s.os.step(), total_price: total, bookings: refunds })
        s.d.my_balance = add(s.d.my_balance, total)
      }
      return ok(`Successfully cancelled ${removed} booking(s). Refunded $${fixed(total, 2)}`)
    },
  },
  search_airports: {
    params: [['airport_name', 'str']],
    run: async (s, { airport_name }) => {
      const q = (airport_name as string).toLowerCase()
      const matched = s.d.airports.filter((a) => a.name.toLowerCase().includes(q)).map(airportRow)
      return matched.length === 0 ? failed(`No airports found matching '${airport_name}'`) : ok(matched)
    },
  },
  star_airport: {
    params: [['aid', 'str']],
    run: async (s, { aid }) => {
      const a = s.d.airports.find((x) => x.aid === aid)
      if (!a) return failed(`Airport with aid=${aid} not found`)
      if (s.d.my_starred_airports.includes(aid)) return failed(`Airport '${a.name}' is already starred`)
      s.d.my_starred_airports.push(aid)
      return ok(`Successfully starred airport '${a.name}'`)
    },
  },
  unstar_airport: {
    params: [['aid', 'str']],
    run: async (s, { aid }) => {
      const a = s.d.airports.find((x) => x.aid === aid)
      if (!a) return failed(`Airport with aid=${aid} not found`)
      if (!s.d.my_starred_airports.includes(aid)) return failed(`Airport '${a.name}' is not starred`)
      s.d.my_starred_airports = s.d.my_starred_airports.filter((x) => x !== aid)
      return ok(`Successfully unstarred airport '${a.name}'`)
    },
  },
  get_my_starred_airports: {
    params: [],
    run: async (s) => ok(s.d.airports.filter((a) => s.d.my_starred_airports.includes(a.aid)).map(airportRow)),
  },
  get_fids_by_arrival: {
    params: [['arrival', 'str']],
    run: async (s, { arrival }) => {
      const fids = s.d.by_arrival[arrival]
      return fids === undefined ? failed(`Arrival '${arrival}' not found`) : ok(fids)
    },
  },
  get_fids_by_departure: {
    params: [['departure', 'str']],
    run: async (s, { departure }) => {
      const fids = s.d.by_departure[departure]
      return fids === undefined ? failed(`Departure \`${departure}\` not found`) : ok(fids)
    },
  },
}

export const LightFlight: App<FlightSession, FlightData> = {
  name: 'LightFlight',
  tools,
  load: (data, os) => new FlightSession(data, os),
  save: (s) => s.data(),
  sessionDict: (s) => ({
    my_balance: s.d.my_balance,
    bookings: sorted(clone(s.d.current_bookings), (b) => b.fid),
    passengers: clone(s.d.passengers),
  }),
}

