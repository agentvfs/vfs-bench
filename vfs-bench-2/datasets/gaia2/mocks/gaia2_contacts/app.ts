/**
 * gaia2-cli's `contacts` app (apps/contacts.py), each command statement for
 * statement over the run's state.
 */
import { CliError, get, jsonLoads, slice, str, valueError, type Command, type PyDict } from '../gaia2/store.ts'

const APP_NAME = 'Contacts'
export { APP_NAME }

const GENDERS = new Set(['Male', 'Female', 'Other', 'Unknown'])
const STATUSES = new Set(['Student', 'Employed', 'Unemployed', 'Retired', 'Unknown'])
const FIELDS = new Set([
  'first_name',
  'last_name',
  'gender',
  'age',
  'nationality',
  'city_living',
  'country',
  'status',
  'job',
  'description',
  'phone',
  'email',
  'address',
])

/** `_load_state`. */
function loaded(state: PyDict): PyDict {
  return Object.keys(state).length === 0 ? { contacts: {}, view_limit: 10 } : state
}

/** `_contact_dict`. */
function contactDict(c: PyDict): PyDict {
  return {
    contact_id: get(c, 'contact_id', ''),
    first_name: get(c, 'first_name', ''),
    last_name: get(c, 'last_name', ''),
    is_user: get(c, 'is_user', false),
    gender: get(c, 'gender', 'Unknown'),
    age: get(c, 'age'),
    nationality: get(c, 'nationality'),
    city_living: get(c, 'city_living'),
    country: get(c, 'country'),
    status: get(c, 'status', 'Unknown'),
    job: get(c, 'job'),
    description: get(c, 'description'),
    phone: get(c, 'phone'),
    email: get(c, 'email'),
    address: get(c, 'address'),
  }
}

/** `validate_email_address`, whose ValueError no command catches. */
function validateEmail(value: string, param: string): void {
  if (!value.includes('@')) throw valueError(`'${value}' is not a valid email address for ${param}.`)
}

const contactsOf = (state: PyDict) => get(state, 'contacts', {}) as Record<string, PyDict>

export function commands(): Command[] {
  return [
    {
      name: 'get-contacts',
      async run(c) {
        const offset = c.int('offset', 0)!
        const state = loaded(await c.state())
        const list = Object.values(contactsOf(state))
        const viewLimit = get(state, 'view_limit', 10) as number
        const result = {
          contacts: slice(list, offset, offset + viewLimit).map(contactDict),
          metadata: { range: [offset, Math.min(offset + viewLimit, list.length)], total: list.length },
        }
        await c.log('get_contacts', { offset }, result)
        return result
      },
    },
    {
      name: 'get-contact',
      async run(c) {
        const contactId = c.str('contact_id')!
        const contacts = contactsOf(loaded(await c.state()))
        if (!Object.hasOwn(contacts, contactId)) throw new CliError(`Contact ${contactId} does not exist.`)
        const result = contactDict(contacts[contactId]!)
        await c.log('get_contact', { contact_id: contactId }, result)
        return result
      },
    },
    {
      name: 'get-current-user-details',
      async run(c) {
        const contacts = contactsOf(loaded(await c.state()))
        for (const contact of Object.values(contacts)) {
          if (get(contact, 'is_user', false)) {
            const result = contactDict(contact)
            await c.log('get_current_user_details', {}, result)
            return result
          }
        }
        throw new CliError('User Contact does not exist.')
      },
    },
    {
      name: 'add-new-contact',
      async run(c) {
        const firstName = c.str('first_name')!
        const lastName = c.str('last_name')!
        const gender = c.str('gender')
        const age = c.int('age')
        const nationality = c.str('nationality')
        const cityLiving = c.str('city_living')
        const country = c.str('country')
        const status = c.str('status')
        const job = c.str('job')
        const description = c.str('description')
        const phone = c.str('phone')
        const email = c.str('email')
        const address = c.str('address')
        const state = loaded(await c.state())
        const contacts = contactsOf(state)
        const namesToId = new Map<string, string>()
        for (const [cid, contact] of Object.entries(contacts)) {
          namesToId.set(`${String(get(contact, 'first_name', '')).toLowerCase()} ${String(get(contact, 'last_name', '')).toLowerCase()}`, cid)
        }
        const key = `${firstName.toLowerCase()} ${lastName.toLowerCase()}`
        if (namesToId.has(key)) throw new CliError(`Contact already exists with contact id - ${namesToId.get(key)}.`)
        let resolvedGender = 'Unknown'
        if (gender !== null) {
          if (!GENDERS.has(gender)) throw new CliError(`'${gender}' is not a valid Gender`)
          resolvedGender = gender
        }
        let resolvedStatus = 'Unknown'
        if (status !== null) {
          if (!STATUSES.has(status)) throw new CliError(`'${status}' is not a valid Status`)
          resolvedStatus = status
        }
        if (age !== null && !(age >= 1 && age <= 100)) throw new CliError(`Invalid age. ${age}`)
        if (email !== null) validateEmail(email, 'email')
        const contactId = c.uuidHex()
        contacts[contactId] = {
          contact_id: contactId,
          first_name: firstName,
          last_name: lastName,
          is_user: false,
          gender: resolvedGender,
          age,
          nationality,
          city_living: cityLiving,
          country,
          status: resolvedStatus,
          job,
          description,
          phone,
          email,
          address,
        }
        state.contacts = contacts
        await c.save(state)
        const args = {
          first_name: firstName,
          last_name: lastName,
          gender,
          age,
          nationality,
          city_living: cityLiving,
          country,
          status,
          job,
          description,
          phone,
          email,
          address,
        }
        await c.log('add_new_contact', args, contactId, true)
        return { status: 'success', contact_id: contactId }
      },
    },
    {
      name: 'edit-contact',
      async run(c) {
        const contactId = c.str('contact_id')!
        const updates = c.str('updates')!
        let updatesDict: PyDict
        try {
          updatesDict = jsonLoads(updates) as PyDict
        } catch (error) {
          throw new CliError(`Invalid JSON for updates: ${str(error)}`)
        }
        const state = loaded(await c.state())
        const contacts = contactsOf(state)
        if (!Object.hasOwn(contacts, contactId)) throw new CliError('Contact does not exist.')
        const contact = contacts[contactId]!
        for (const key of Object.keys(updatesDict)) {
          if (!FIELDS.has(key)) throw new CliError(`${key} is not a valid attribute of Contact.`)
        }
        if ('gender' in updatesDict && !GENDERS.has(updatesDict.gender as string)) {
          throw new CliError(`'${String(updatesDict.gender)}' is not a valid Gender`)
        }
        if ('status' in updatesDict && !STATUSES.has(updatesDict.status as string)) {
          throw new CliError(`'${String(updatesDict.status)}' is not a valid Status`)
        }
        if ('age' in updatesDict && updatesDict.age !== null) {
          const age = updatesDict.age as number
          if (!(age >= 1 && age <= 100)) throw new CliError(`Invalid age. ${String(age)}`)
        }
        if ('first_name' in updatesDict && updatesDict.first_name === null) throw new CliError('Invalid first name.')
        if ('last_name' in updatesDict && updatesDict.last_name === null) throw new CliError('Invalid last name.')
        if ('email' in updatesDict && updatesDict.email !== null) validateEmail(String(updatesDict.email), 'email')
        for (const [key, value] of Object.entries(updatesDict)) contact[key] = value
        contacts[contactId] = contact
        state.contacts = contacts
        await c.save(state)
        const result = `Contact ${contactId} updated successfully.`
        await c.log('edit_contact', { contact_id: contactId, updates: updatesDict }, result, true)
        return { status: 'success', message: result }
      },
    },
    {
      name: 'delete-contact',
      async run(c) {
        const contactId = c.str('contact_id')!
        const state = loaded(await c.state())
        const contacts = contactsOf(state)
        if (!Object.hasOwn(contacts, contactId)) throw new CliError('Contact does not exist.')
        delete contacts[contactId]
        state.contacts = contacts
        await c.save(state)
        const result = `Contact ${contactId} successfully deleted.`
        await c.log('delete_contact', { contact_id: contactId }, result, true)
        return { status: 'success', message: result }
      },
    },
    {
      name: 'search-contacts',
      async run(c) {
        const query = c.str('query')!
        const contacts = contactsOf(loaded(await c.state()))
        const q = query.toLowerCase()
        const results: PyDict[] = []
        for (const contact of Object.values(contacts)) {
          const first = String(contact.first_name || '').toLowerCase()
          const last = String(contact.last_name || '').toLowerCase()
          const phone = String(contact.phone || '').toLowerCase()
          const email = String(contact.email || '').toLowerCase()
          if (
            first.includes(q) ||
            last.includes(q) ||
            phone.includes(q) ||
            email.includes(q) ||
            `${first} ${last}`.includes(q) ||
            `${last} ${first}`.includes(q)
          ) {
            results.push(contactDict(contact))
          }
        }
        await c.log('search_contacts', { query }, results)
        return results
      },
    },
  ]
}
