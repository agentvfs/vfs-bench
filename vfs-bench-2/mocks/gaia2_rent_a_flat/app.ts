/**
 * gaia2-cli's `rent-a-flat` app (apps/apartment.py), each command statement
 * for statement over the run's state, the hidden ENV commands included.
 *
 * Upstream reads each listing into an `Apartment` dataclass and writes it
 * back with `asdict`, so a listing here is a dict with the dataclass's
 * fields in their order, its defaults filled in, and nothing else.
 */
import { CliError, PyError, PyFloat, copy, get, jsonLoads, num, truthy, type Command, type Py, type PyDict } from '../gaia2/store.ts'
import { strRepr, typeName } from '../gaia2/pyrepr.ts'

const APP_NAME = 'RentAFlat'
export { APP_NAME }

/** `Apartment`'s fields, in order: the first eight have no default. */
const FIELDS = [
  'name',
  'location',
  'zip_code',
  'price',
  'bedrooms',
  'bathrooms',
  'property_type',
  'square_footage',
  'furnished_status',
  'floor_level',
  'pet_policy',
  'lease_term',
  'apartment_id',
  'amenities',
  'saved',
] as const
const REQUIRED = FIELDS.slice(0, 8)

type Apartment = PyDict

/** `Apartment(**data)`, its TypeError where a field with no default is missing. */
function apartment(data: PyDict): Apartment {
  const missing = REQUIRED.filter((f) => !Object.hasOwn(data, f)).map((f) => `'${f}'`)
  if (missing.length > 0) {
    const names =
      missing.length === 1
        ? missing[0]!
        : missing.length === 2
          ? `${missing[0]} and ${missing[1]}`
          : `${missing.slice(0, -1).join(', ')}, and ${missing[missing.length - 1]}`
    const s = missing.length === 1 ? '' : 's'
    throw new PyError('TypeError', `Apartment.__init__() missing ${missing.length} required positional argument${s}: ${names}`)
  }
  const defaults: PyDict = { furnished_status: '', floor_level: '', pet_policy: '', lease_term: '', apartment_id: '', amenities: [], saved: false }
  const out: Apartment = {}
  for (const f of FIELDS) out[f] = Object.hasOwn(data, f) ? data[f]! : defaults[f]!
  return out
}

/** `asdict(apartment)`. */
const asdict = (apt: Apartment): PyDict => copy(apt)

/** `_load_apartments`. */
function loadApartments(state: PyDict): Map<string, Apartment> {
  const apartments = new Map<string, Apartment>()
  const raw = get(state, 'apartments', {}) as Record<string, PyDict>
  for (const [aptId, aptData] of Object.entries(raw)) {
    aptData.apartment_id = aptId
    apartments.set(aptId, apartment(aptData))
  }
  return apartments
}

/** `_load_saved`: the state's own list, and the saved flag set on its listings. */
function loadSaved(state: PyDict, apartments: Map<string, Apartment>): string[] {
  const saved = get(state, 'saved_apartments', []) as string[]
  for (const aptId of saved) {
    const apt = apartments.get(aptId)
    if (apt !== undefined) apt.saved = true
  }
  return saved
}

/** `_build_state`. */
function buildState(apartments: Map<string, Apartment>, saved: string[]): PyDict {
  const out: PyDict = {}
  for (const [aid, a] of apartments) out[aid] = asdict(a)
  return { apartments: out, saved_apartments: saved }
}

/** `apartments[aid]`, a KeyError where it is not there. */
function at(apartments: Map<string, Apartment>, aid: string): Apartment {
  const apt = apartments.get(aid)
  if (apt === undefined) throw new PyError('KeyError', strRepr(aid))
  return apt
}

/** `load_app_state(APP_NAME) or {}`. */
async function load(c: Parameters<Command['run']>[0]): Promise<PyDict> {
  return await c.state()
}

/** `[am.lower() for am in value]`: iterating a JSON value as Python does. */
function lowered(value: Py): string[] {
  let items: Py[]
  if (Array.isArray(value)) items = value
  else if (typeof value === 'string') items = [...value]
  else if (value !== null && typeof value === 'object' && !(value instanceof PyFloat)) {
    items = Object.keys(value)
  } else throw new PyError('TypeError', `'${typeName(value)}' object is not iterable`)
  return items.map((am) => {
    if (typeof am !== 'string') throw new PyError('AttributeError', `'${typeName(am)}' object has no attribute 'lower'`)
    return am.toLowerCase()
  })
}

export function commands(): Command[] {
  return [
    {
      name: 'list-all-apartments',
      async run(c) {
        const state = await load(c)
        const apartments = loadApartments(state)
        loadSaved(state, apartments)
        const result: PyDict = {}
        for (const [aid, a] of apartments) result[aid] = asdict(a)
        await c.log('list_all_apartments', {}, result)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'get-apartment-details',
      async run(c) {
        const apartmentId = c.str('apartment_id')!
        const state = await load(c)
        const apartments = loadApartments(state)
        loadSaved(state, apartments)
        if (!apartments.has(apartmentId)) throw new CliError('Apartment does not exist')
        const result = asdict(apartments.get(apartmentId)!)
        await c.log('get_apartment_details', { apartment_id: apartmentId }, result)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'save-apartment',
      async run(c) {
        const apartmentId = c.str('apartment_id')!
        const state = await load(c)
        const apartments = loadApartments(state)
        const saved = loadSaved(state, apartments)
        if (!apartments.has(apartmentId)) throw new CliError('Apartment does not exist')
        if (!saved.includes(apartmentId)) {
          saved.push(apartmentId)
          apartments.get(apartmentId)!.saved = true
        }
        await c.save(buildState(apartments, saved))
        await c.log('save_apartment', { apartment_id: apartmentId }, null, true)
        return { status: 'success', message: 'Successfully saved apartment' }
      },
    },
    {
      name: 'remove-saved-apartment',
      async run(c) {
        const apartmentId = c.str('apartment_id')!
        const state = await load(c)
        const apartments = loadApartments(state)
        const saved = loadSaved(state, apartments)
        if (!saved.includes(apartmentId)) throw new CliError('Apartment not in saved list')
        saved.splice(saved.indexOf(apartmentId), 1)
        at(apartments, apartmentId).saved = false
        await c.save(buildState(apartments, saved))
        await c.log('remove_saved_apartment', { apartment_id: apartmentId }, null, true)
        return { status: 'success', message: 'Successfully removed apartment from favorites' }
      },
    },
    {
      name: 'list-saved-apartments',
      async run(c) {
        const state = await load(c)
        const apartments = loadApartments(state)
        const saved = loadSaved(state, apartments)
        const result: PyDict = {}
        for (const aid of saved) result[aid] = asdict(at(apartments, aid))
        await c.log('list_saved_apartments', {}, result)
        return { status: 'success', data: result }
      },
    },
    {
      name: 'search-apartments',
      async run(c) {
        const name = c.str('name')
        const location = c.str('location')
        const zipCode = c.str('zip_code')
        const minPrice = c.float('min_price')
        const maxPrice = c.float('max_price')
        const bedrooms = c.int('number_of_bedrooms')
        const bathrooms = c.int('number_of_bathrooms')
        const propertyType = c.str('property_type')
        const squareFootage = c.int('square_footage')
        const furnishedStatus = c.str('furnished_status')
        const floorLevel = c.str('floor_level')
        const petPolicy = c.str('pet_policy')
        const leaseTerm = c.str('lease_term')
        const amenities = c.str('amenities')
        const savedOnly = c.flag('saved_only')
        const state = await load(c)
        const all = loadApartments(state)
        const savedList = loadSaved(state, all)

        let amenitiesList: Py = null
        if (amenities !== null) {
          try {
            amenitiesList = jsonLoads(amenities)
          } catch (error) {
            if (!(error instanceof PyError && error.type === 'json.decoder.JSONDecodeError')) throw error
            amenitiesList = amenities.split(',').map((a) => a.trim())
          }
        }

        let toSearch: Map<string, Apartment>
        if (savedOnly) {
          toSearch = new Map()
          for (const aid of savedList) toSearch.set(aid, at(all, aid))
        } else toSearch = all

        const nameLower = name ? name.toLowerCase() : null
        const locationLower = location ? location.toLowerCase() : null
        const propertyTypeLower = propertyType ? propertyType.toLowerCase() : null
        const furnishedLower = furnishedStatus ? furnishedStatus.toLowerCase() : null
        const petLower = petPolicy ? petPolicy.toLowerCase() : null
        const leaseLower = leaseTerm ? leaseTerm.toLowerCase() : null
        const amenitiesLower = truthy(amenitiesList) ? lowered(amenitiesList) : null

        const filtered: PyDict = {}
        for (const [aptId, apt] of toSearch) {
          if (truthy(minPrice) && num(apt.price) < num(minPrice)) continue
          if (truthy(maxPrice) && num(apt.price) > num(maxPrice)) continue
          if (truthy(bedrooms) && num(apt.bedrooms) !== bedrooms) continue
          if (truthy(bathrooms) && num(apt.bathrooms) !== bathrooms) continue
          if (truthy(squareFootage) && num(apt.square_footage) < squareFootage!) continue

          if (zipCode && apt.zip_code !== zipCode) continue
          if (floorLevel && apt.floor_level !== floorLevel) continue

          if (nameLower && !String(apt.name).toLowerCase().includes(nameLower)) continue
          if (locationLower && !String(apt.location).toLowerCase().includes(locationLower)) continue
          if (propertyTypeLower && String(apt.property_type).toLowerCase() !== propertyTypeLower) continue
          if (furnishedLower && truthy(apt.furnished_status) && String(apt.furnished_status).toLowerCase() !== furnishedLower) continue
          if (petLower && truthy(apt.pet_policy) && String(apt.pet_policy).toLowerCase() !== petLower) continue
          if (leaseLower && truthy(apt.lease_term) && String(apt.lease_term).toLowerCase() !== leaseLower) continue

          if (amenitiesLower !== null && amenitiesLower.length > 0) {
            const aptAmenities = ((apt.amenities as string[] | null) || []).map((t) => t.toLowerCase())
            if (!amenitiesLower.every((am) => aptAmenities.includes(am))) continue
          }
          filtered[aptId] = asdict(apt)
        }

        const eventArgs: PyDict = {
          name,
          location,
          zip_code: zipCode,
          min_price: minPrice,
          max_price: maxPrice,
          number_of_bedrooms: bedrooms,
          number_of_bathrooms: bathrooms,
          property_type: propertyType,
          square_footage: squareFootage,
          furnished_status: furnishedStatus,
          floor_level: floorLevel,
          pet_policy: petPolicy,
          lease_term: leaseTerm,
          amenities: amenitiesList,
          saved_only: savedOnly,
        }
        await c.log('search_apartments', eventArgs, filtered)
        return { status: 'success', data: filtered }
      },
    },
    // Hidden ENV-tool commands (used by gaia2-eventd, not visible to agents).
    {
      name: 'add-new-apartment',
      async run(c) {
        const name = c.str('name')!
        const location = c.str('location')!
        const zipCode = c.str('zip_code')!
        const price = c.float('price')!
        const bedrooms = c.int('number_of_bedrooms')!
        const bathrooms = c.int('number_of_bathrooms')!
        const squareFootage = c.int('square_footage')!
        const propertyType = c.str('property_type', '')!
        const furnishedStatus = c.str('furnished_status', '')!
        const floorLevel = c.str('floor_level', '')!
        const petPolicy = c.str('pet_policy', '')!
        const leaseTerm = c.str('lease_term', '')!
        const amenities = c.str('amenities')

        let amenitiesList: Py = []
        if (amenities) {
          try {
            amenitiesList = jsonLoads(amenities)
          } catch (error) {
            if (!(error instanceof PyError && error.type === 'json.decoder.JSONDecodeError')) throw error
            amenitiesList = []
          }
        }

        const state = await load(c)
        const apartments = loadApartments(state)
        const saved = loadSaved(state, apartments)

        const aptId = c.uuidHex()
        apartments.set(
          aptId,
          apartment({
            name,
            location,
            zip_code: zipCode,
            price,
            bedrooms,
            bathrooms,
            property_type: propertyType,
            square_footage: squareFootage,
            furnished_status: furnishedStatus,
            floor_level: floorLevel,
            pet_policy: petPolicy,
            lease_term: leaseTerm,
            amenities: amenitiesList,
            apartment_id: aptId,
          }),
        )
        await c.save(buildState(apartments, saved))
        await c.log(
          'add_new_apartment',
          {
            name,
            location,
            zip_code: zipCode,
            price,
            number_of_bedrooms: bedrooms,
            number_of_bathrooms: bathrooms,
            square_footage: squareFootage,
            property_type: propertyType,
            furnished_status: furnishedStatus,
            floor_level: floorLevel,
            pet_policy: petPolicy,
            lease_term: leaseTerm,
            amenities: amenitiesList,
          },
          aptId,
          true,
        )
        return { status: 'success', apartment_id: aptId }
      },
    },
    {
      name: 'update-apartment',
      async run(c) {
        const apartmentId = c.str('apartment_id')!
        const newPrice = c.float('new_price')!
        const state = await load(c)
        const apartments = loadApartments(state)
        const saved = loadSaved(state, apartments)
        if (!apartments.has(apartmentId)) throw new CliError('Apartment does not exist')
        apartments.get(apartmentId)!.price = newPrice
        await c.save(buildState(apartments, saved))
        await c.log('update_apartment', { apartment_id: apartmentId, new_price: newPrice }, apartmentId, true)
        return { status: 'success', apartment_id: apartmentId }
      },
    },
    {
      name: 'delete-apartment',
      async run(c) {
        const apartmentId = c.str('apartment_id')!
        const state = await load(c)
        const apartments = loadApartments(state)
        const saved = loadSaved(state, apartments)
        if (!apartments.has(apartmentId)) throw new CliError('Apartment does not exist.')
        apartments.delete(apartmentId)
        if (saved.includes(apartmentId)) saved.splice(saved.indexOf(apartmentId), 1)
        await c.save(buildState(apartments, saved))
        await c.log('delete_apartment', { apartment_id: apartmentId }, apartmentId, true)
        return { status: 'success', apartment_id: apartmentId }
      },
    },
  ]
}
