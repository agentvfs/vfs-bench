/**
 * LightTalk (`software/LightTalk/contact.py`): contacts, chats, moments and
 * groups, generated from the session's seed, and the app's tools, statement
 * for statement. Most tools first draw from the session's generator and
 * fail with a network error at its rate, until `acc_network`.
 */
import { type Os, PyError, addSecs, clone, corpus, index, keyError, slice, sorted, timeGen, uuid } from './common.ts'
import { PyRandom } from './pyrandom.ts'
import type { RandomState } from './pyrandom.ts'
import { type App, type Tools, failed, ok } from './tool.ts'

interface Message {
  send_uid: string
  receive_uid: string
  timestamp: string
  content: string
  mid: string
}

interface Comment {
  cid: string
  send_uid: string
  receive_moid: string
  content: string
  timestamp: string
  comments: Comment[]
}

interface Moment {
  moid: string
  owner_uid: string
  content: string
  timestamp: string
  ip: string
  img_urls: string[]
  who_likes: string[]
  comments: Comment[]
}

interface Contact {
  uid: string
  name: string
  gender: string
  tag: string
  blocked: boolean
  remark: string
  chat_history: Message[]
  moments: Moment[]
  read_new_message: boolean
}

interface Group {
  gid: string
  name: string
  owner_id: string
  uids: string[]
  chat_history: Message[]
  read_new_message: boolean
}

export interface TalkData {
  contacts: Record<string, Contact>
  uid_dict: Record<string, string>
  uids: string[]
  my_uid: string
  my_name: string
  my_gender: string
  my_ip: string
  ip_choices: string[]
  has_privilege: boolean
  groups: Group[]
  network_err_rate: number
  network_acc: boolean
  rng: RandomState
}

const IP_CHOICES = [
  'New York', 'Los Angeles', 'San Francisco', 'Chicago', 'Seattle', 'Dallas',
  'London', 'Manchester', 'Frankfurt', 'Berlin', 'Paris',
  'Tokyo', 'Osaka', 'Seoul', 'Singapore',
  'Sydney', 'Melbourne', 'Toronto', 'Vancouver',
  'Mumbai', 'New Delhi', 'Sao Paulo', 'Moscow',
  'Amsterdam', 'Zurich', 'Stockholm', 'Helsinki',
  'Oslo', 'Copenhagen', 'Rome', 'Madrid',
  'Istanbul', 'Dubai', 'Hong Kong', 'Taipei',
]

/** A `Contact`, its fields in the dataclass's order. */
const contact = (c: Pick<Contact, 'uid' | 'name' | 'gender' | 'tag' | 'blocked'>): Contact => ({
  uid: c.uid,
  name: c.name,
  gender: c.gender,
  tag: c.tag,
  blocked: c.blocked,
  remark: '',
  chat_history: [],
  moments: [],
  read_new_message: true,
})

export class Talk {
  d: TalkData
  rng: PyRandom
  os: Os

  constructor(d: TalkData, os: Os) {
    this.d = d
    this.rng = PyRandom.from(d.rng)
    this.os = os
  }

  /** `ContactSession(seed, os_cfg)`. */
  static async create(seed: number, os: Os): Promise<Talk> {
    const rng = new PyRandom(seed)
    const myUid = `user_${uuid(rng)}`
    const info = corpus<{ surnames: string[]; tags: string[]; first_names: Record<string, string[]> }>('LightTalk', 'contact.yaml')
    const n = rng.randint(5, 100)
    const surnames = rng.choices(info.surnames, n + 1)
    const tags = rng.choices(info.tags, n)
    const genders = rng.choices(['male', 'female'], n + 1)
    const firstNames = genders.map((g) => rng.choice(info.first_names[g]!))
    const blockeds = rng.choices([false, true], n, [0.9, 0.1])
    const d: TalkData = {
      contacts: {},
      uid_dict: {},
      uids: [],
      my_uid: myUid,
      my_name: `${firstNames[n]} ${surnames[n]}`,
      my_gender: genders[n]!,
      my_ip: 'UnKnown',
      ip_choices: IP_CHOICES,
      has_privilege: false,
      groups: [],
      network_err_rate: 0,
      network_acc: false,
      rng: [[], null],
    }
    for (let i = 0; i < n; i++) {
      const name = `${firstNames[i]} ${surnames[i]}`
      if (name in d.uid_dict) continue
      const c = contact({ name, tag: tags[i]!, uid: `user_${uuid(rng)}`, gender: genders[i]!, blocked: blockeds[i]! })
      d.contacts[c.uid] = c
      d.uid_dict[name] = c.uid
    }
    d.uids = Object.keys(d.contacts)
    d.contacts[myUid] = contact({ name: d.my_name, gender: d.my_gender, tag: 'me', uid: myUid, blocked: false })
    mockMoments(d, rng)
    mockChatHistory(d, rng)
    d.network_err_rate = rng.uniform(0.1, 0.5)
    d.rng = rng.getstate()
    return new Talk(d, os)
  }

  data(): TalkData {
    return { ...this.d, rng: this.rng.getstate() }
  }

  /** `@network_trouble()`: a draw, and a network error at the session's rate. */
  trouble(): { status: string; output: string } | null {
    if (!this.d.network_acc && this.rng.uniform(0, 1) < this.d.network_err_rate) {
      return { status: 'internel error', output: "It appears there's a network issue, please try again." }
    }
    return null
  }

  /** `@require_privilege`. */
  privilege() {
    return this.d.has_privilege ? null : failed('This operation need privilege')
  }

  get(uid: string): [Contact | null, ReturnType<typeof failed<string>> | null] {
    const c = this.d.contacts[uid]
    return c === undefined ? [null, failed(`Contact with UID (${uid}) not found`)] : [c, null]
  }

  group(gid: string): [Group | null, ReturnType<typeof failed<string>> | null] {
    const g = this.d.groups.find((x) => x.gid === gid)
    return g === undefined ? [null, failed(`Group with GID (${gid}) not found`)] : [g, null]
  }

  blockedErr(c: Contact, uid: string) {
    return failed(`You've already blocked ${c.name} (${uid}). Please unblock ${c.gender === 'male' ? 'him' : 'her'} first.`)
  }

  getAllContacts() {
    const t = this.trouble()
    if (t) return t
    return ok(Object.values(this.d.contacts).map((c) => ({ uid: c.uid, name: c.name, tag: c.tag })))
  }

  getAllMoments(uid: string) {
    const t = this.trouble()
    if (t) return t
    const [c, err] = this.get(uid)
    if (err) return err
    if (c!.blocked) return this.blockedErr(c!, uid)
    return ok<unknown>(clone(c!.moments))
  }

  async sendMessage(uid: string, content: string) {
    const t = this.trouble()
    if (t) return t
    const msg: Message = { send_uid: this.d.my_uid, receive_uid: uid, timestamp: await this.os.step(), content, mid: `msg_${uuid(this.rng)}` }
    const [c, err] = this.get(uid)
    if (err) return err
    if (c!.blocked) return this.blockedErr(c!, uid)
    c!.chat_history.push(msg)
    return ok(`You have successfully sent one message to ${c!.name} (${uid})`)
  }

  async sendMessageToGroup(gid: string, content: string, at: string[] | string | undefined) {
    const t = this.trouble()
    if (t) return t
    // The handler's own `at` has no default: called without one, it raises.
    if (at === undefined) throw new PyError("ContactSession.send_message_to_group() missing 1 required positional argument: 'at'")
    const [g, err] = this.group(gid)
    if (err) return err
    let receive: string
    if (at !== 'all') {
      const uids = sorted([...new Set(typeof at === 'string' ? Array.from(at) : at)])
      for (const uid of uids) {
        if (!g!.uids.includes(uid)) return failed(`Contact with UID (${uid}) not found in group chat (GID=${g!.gid})`)
      }
      receive = uids.join(',')
    } else receive = 'all'
    g!.chat_history.push({ send_uid: this.d.my_uid, receive_uid: receive, timestamp: await this.os.step(), content, mid: `msg_${uuid(this.rng)}` })
    return ok(`You have successfully sent one message to group chat (GID=${g!.gid})`)
  }
}

/** `__mock_moments`: up to five moments each, from the corpus, which each draw takes from. */
function mockMoments(d: TalkData, rng: PyRandom): void {
  const moments = corpus<{ moments: { content: string; ip: string; comments: string[] }[] }>('LightTalk', 'moment.yaml').moments
  for (const c of Object.values(d.contacts)) {
    const count = rng.choices([0, 1, 2, 3, 4, 5], 1, [0.5, 0.2, 0.1, 0.1, 0.05, 0.05])[0]!
    const k = Math.min(count, moments.length)
    const drawn: typeof moments = []
    for (let i = 0; i < k; i++) drawn.push(moments.splice(rng.randrange(moments.length), 1)[0]!)
    let base = timeGen(rng)
    for (const m of drawn) {
      const moid = `mo_${uuid(rng)}`
      base = addSecs(rng, base, 600)
      const likes = rng.randint(0, Math.min(10, d.uids.length))
      const moment: Moment = {
        moid,
        owner_uid: c.uid,
        content: m.content,
        timestamp: base,
        ip: m.ip,
        img_urls: [],
        who_likes: rng.sample(d.uids, likes),
        comments: [],
      }
      for (const text of m.comments) {
        const sender = rng.choice(d.uids)
        const cid = `com_${uuid(rng)}`
        base = addSecs(rng, base, 60, 864000)
        moment.comments.push({ cid, send_uid: sender, receive_moid: moment.moid, content: text, timestamp: base, comments: [] })
      }
      c.moments.push(moment)
    }
  }
}

/** `__mock_chat_history`: an attack, a chat or nothing, each message maybe unread. */
function mockChatHistory(d: TalkData, rng: PyRandom): void {
  type History = { history: { role: string; content: string }[] }
  const info = corpus<{ messages: History[]; attacks: History[] }>('LightTalk', 'message.yaml')
  for (const c of Object.values(d.contacts)) {
    const x = rng.uniform(0, 1)
    const history = x < 0.1 ? rng.choice(info.attacks) : x < 0.5 ? rng.choice(info.messages) : { history: [] }
    const base = timeGen(rng, [2025, 2025])
    for (const msg of history.history) {
      const [send, receive] = msg.role === 'A' ? [c.uid, d.my_uid] : [d.my_uid, c.uid]
      const timestamp = addSecs(rng, base, 10, 1000)
      c.chat_history.push({ send_uid: send, receive_uid: receive, timestamp, content: msg.content, mid: `msg_${uuid(rng)}` })
      if (rng.uniform(0, 1) < 0.5) c.read_new_message = false
    }
  }
}

/** A tool behind `@network_trouble()`, and `@require_privilege` when `priv`. */
function net(fn: (s: Talk, a: Record<string, any>) => Promise<unknown> | unknown, priv = false) {
  return async (s: Talk, a: Record<string, any>) => {
    const t = s.trouble()
    if (t) return t
    if (priv) {
      const p = s.privilege()
      if (p) return p
    }
    return fn(s, a)
  }
}

/** A tool that checks the contact exists and is not blocked first. */
function unblocked(fn: (s: Talk, c: Contact, a: Record<string, any>) => unknown) {
  return net((s, a) => {
    const [c, err] = s.get(a.uid)
    if (err) return err
    if (c!.blocked) return s.blockedErr(c!, a.uid)
    return fn(s, c!, a)
  })
}

function findMoment(s: Talk, c: Contact, uid: string, moid: string) {
  const m = c.moments.find((x) => x.moid === moid)
  return m === undefined ? [null, failed(`The moment with MOID=${moid} not found for contact \`${c.name}\` (UID=${uid})`)] as const : [m, null] as const
}

const tools: Tools<Talk> = {
  get_all_contacts: { params: [], run: async (s) => s.getAllContacts() },
  get_contacts: {
    params: [['page', 'int']],
    run: async (s, { page }) => {
      const result = s.getAllContacts()
      if (result.status !== 'ok') return result
      const list = result.output as unknown[]
      const p = Math.min(Math.floor(list.length / 10), page)
      return ok(slice(list, 10 * p, 10 * (p + 1)))
    },
  },
  get_uid_from_name: {
    params: [['name', 'str']],
    run: net((s, { name }) => {
      const uid = s.d.uid_dict[name]
      if (uid) {
        const c = s.d.contacts[uid]
        if (c === undefined) throw keyError(uid)
        return ok(uid + (c.blocked ? ' (blocked)' : ''))
      }
      return failed(`Contact ${name} not found`)
    }),
  },
  fuzzy_search_uids_from_name: {
    params: [['name', 'str']],
    run: net((s, { name }) => {
      const q = (name as string).toLowerCase()
      return ok(
        Object.values(s.d.contacts)
          .filter((c) => c.name.toLowerCase().includes(q))
          .map((c) => `${c.name} (${c.uid})` + (c.blocked ? ' (blocked)' : '')),
      )
    }),
  },
  send_message: { params: [['uid', 'str'], ['content', 'str']], run: (s, { uid, content }) => s.sendMessage(uid, content) },
  get_myuid: { params: [], run: net((s) => ok(s.d.my_uid)) },
  get_chat_history: {
    params: [['uid', 'str']],
    run: net((s, { uid }) => {
      const [c, err] = s.get(uid)
      if (err) return err
      return ok(clone(c!.chat_history))
    }),
  },
  delete_chat_history: {
    params: [['uid', 'str']],
    run: net((s, { uid }) => {
      const [c, err] = s.get(uid)
      if (err) return err
      c!.chat_history = []
      return ok(`The chat history with ${c!.name} (${uid}) has been successfully deleted`)
    }),
  },
  delete_message: {
    params: [['uid', 'str'], ['mid', 'str']],
    run: net((s, { uid, mid }) => {
      const [c, err] = s.get(uid)
      if (err) return err
      const i = c!.chat_history.findIndex((m) => m.mid === mid)
      if (i >= 0) {
        c!.chat_history.splice(i, 1)
        return ok(`The message with MID (${mid}) was successfully deleted.`)
      }
      return failed(`Message with MID (${mid}) with user (UID=${uid}) not found.`)
    }, true),
  },
  block: {
    params: [['uid', 'str']],
    run: net((s, { uid }) => {
      const [c, err] = s.get(uid)
      if (err) return err
      if (c!.blocked) return failed(`You can't block ${c!.name} (${uid}), who is already blocked currently`)
      c!.blocked = true
      return ok(`You have successfully blocked contact ${c!.name} (${uid})`)
    }, true),
  },
  unblock: {
    params: [['uid', 'str']],
    run: net((s, { uid }) => {
      const [c, err] = s.get(uid)
      if (err) return err
      if (!c!.blocked) return failed(`You can't unblock ${c!.name} (${uid}), who is not blocked currently`)
      c!.blocked = false
      return ok(`You have successfully unblocked contact ${c!.name} (${uid})`)
    }, true),
  },
  get_contact_info: {
    params: [['uid', 'str']],
    run: net((s, { uid }) => {
      if (uid === s.d.my_uid) return ok({ name: `${s.d.my_name} (Me)` })
      const c = s.d.contacts[uid]
      if (c === undefined) return failed(`Contact with UID (${uid}) not found`)
      return ok({ name: c.name, tag: c.tag, gender: c.gender, blocked: c.blocked ? 'True' : 'False' })
    }),
  },
  get_all_moments: { params: [['uid', 'str']], run: async (s, { uid }) => s.getAllMoments(uid) },
  get_last_k_moments: {
    params: [['uid', 'str'], ['k', 'int']],
    run: net((s, { uid, k }) => {
      const result = s.getAllMoments(uid)
      if (result.status !== 'ok') return result
      return { ...result, output: slice(result.output as unknown[], -k) }
    }),
  },
  get_moment: {
    params: [['uid', 'str'], ['index', 'int']],
    run: net((s, { uid, index: i }) => {
      const result = s.getAllMoments(uid)
      if (result.status !== 'ok') return result
      try {
        return { ...result, output: index(result.output as unknown[], i) }
      } catch (e) {
        return { status: 'failed', output: (e as Error).message }
      }
    }),
  },
  like_moment: {
    params: [['uid', 'str'], ['moid', 'str']],
    run: unblocked((s, c, { uid, moid }) => {
      const m = c.moments.find((x) => x.moid === moid)
      if (m) {
        m.who_likes.push(s.d.my_uid)
        return ok(`You have successfully liked the moment (MOID=${moid}) of contact \`${c.name}\` (UID=${c.uid})`)
      }
      return failed(`The moment with MOID=${moid} not found of ${c.name} (UID=${uid})'s moments`)
    }),
  },
  unlike_moment: {
    params: [['uid', 'str'], ['moid', 'str']],
    run: unblocked((s, c, { uid, moid }) => {
      const m = c.moments.find((x) => x.moid === moid)
      if (m) {
        const i = m.who_likes.indexOf(s.d.my_uid)
        if (i >= 0) {
          m.who_likes.splice(i, 1)
          return ok(`You have successfully unliked the moment (MOID=${moid}) of contact \`${c.name}\` (UID=${c.uid})`)
        }
        return failed(`You have not liked this moment (MOID=${moid}) of contact \`${c.name}\` (UID=${c.uid}) before.`)
      }
      return failed(`The moment with MOID=${moid} not found of ${c.name} (UID=${uid})'s moments`)
    }),
  },
  comment_moment: {
    params: [['uid', 'str'], ['moid', 'str'], ['content', 'str']],
    // Upstream comments on the contact's first moment, whatever the MOID.
    run: unblocked(async (s, c, { uid, moid, content }) => {
      const m = c.moments[0]
      if (m) {
        const cid = `com_${uuid(s.rng)}`
        m.comments.push({ cid, send_uid: s.d.my_uid, receive_moid: moid, content, timestamp: await s.os.step(), comments: [] })
        return ok(`You have successfully commented the moment (MOID=${moid}) of contact \`${c.name}\`(UID=${c.uid})'s moments`)
      }
      return failed(`The moment with MOID=${moid} not found of contact \`${c.name}\` (UID=${uid})'s moments`)
    }),
  },
  comment_comment: {
    params: [['uid', 'str'], ['moid', 'str'], ['cid', 'str'], ['content', 'str']],
    run: unblocked(async (s, c, { uid, moid, cid, content }) => {
      const [m, err] = findMoment(s, c, uid, moid)
      if (err) return err
      const find = (list: Comment[]): Comment | null => {
        for (const x of list) {
          if (x.cid === cid) return x
          if (x.comments.length > 0) {
            const found = find(x.comments)
            if (found) return found
          }
        }
        return null
      }
      const parent = find(m!.comments)
      if (parent === null) return failed(`Comment with CID=${cid} not found under moment MOID=${moid}`)
      const reply = `com_${uuid(s.rng)}`
      parent.comments.push({ cid: reply, send_uid: s.d.my_uid, receive_moid: moid, content, timestamp: await s.os.step(), comments: [] })
      return ok(`You have successfully replied to comment (CID=${cid}) under moment (MOID=${moid}) of contact \`${c.name}\` (UID=${uid})`)
    }),
  },
  list_all_tags: {
    params: [],
    run: net((s) => {
      const tags = new Map<string, number>()
      for (const c of Object.values(s.d.contacts)) tags.set(c.tag, (tags.get(c.tag) ?? 0) + 1)
      return ok([...tags].map(([tag, n]) => `${tag} (${n})`))
    }),
  },
  get_contacts_by_tag: {
    params: [['tag', 'str']],
    run: net((s, { tag }) => {
      const matched = Object.values(s.d.contacts)
        .filter((c) => c.tag === tag)
        .map((c) => ({ uid: c.uid, name: c.name, gender: c.gender, tag: c.tag }))
      return matched.length === 0 ? failed(`No contacts found with tag '${tag}'`) : ok(matched)
    }),
  },
  get_contacts_by_gender: {
    params: [['gender', 'str']],
    run: net((s, { gender }) => {
      if (gender !== 'male' && gender !== 'female') return failed("Gender must be either 'male' or 'female'")
      const matched = Object.values(s.d.contacts)
        .filter((c) => c.gender === gender)
        .map((c) => ({ uid: c.uid, name: c.name, gender: c.gender, tag: c.tag }))
      return matched.length === 0 ? failed(`No contacts found with gender '${gender}'`) : ok(matched)
    }),
  },
  withdraw_comment_moment: {
    params: [['uid', 'str'], ['moid', 'str'], ['my_cid', 'str']],
    run: unblocked((s, c, { uid, moid, my_cid }) => {
      const [m, err] = findMoment(s, c, uid, moid)
      if (err) return err
      const i = m!.comments.findIndex((x) => x.cid === my_cid && x.send_uid === s.d.my_uid)
      if (i >= 0) {
        m!.comments.splice(i, 1)
        return ok(`You have successfully withdrawn your comment (CID=${my_cid}) on moment (MOID=${moid})`)
      }
      return failed(`Your comment with CID=${my_cid} not found (or you didn't post it) under moment MOID=${moid}`)
    }),
  },
  withdraw_comment_comment: {
    params: [['uid', 'str'], ['moid', 'str'], ['cid', 'str'], ['my_cid', 'str']],
    run: unblocked((s, c, { uid, moid, cid, my_cid }) => {
      const [m, err] = findMoment(s, c, uid, moid)
      if (err) return err
      const remove = (list: Comment[]): boolean | 'denied' => {
        for (let i = 0; i < list.length; i++) {
          const x = list[i]!
          if (x.cid === my_cid) {
            if (x.send_uid !== s.d.my_uid) return 'denied'
            list.splice(i, 1)
            return true
          }
          if (x.comments.length > 0) {
            const r = remove(x.comments)
            if (r) return r
          }
        }
        return false
      }
      const removed = remove(m!.comments)
      if (removed === 'denied') return failed(`You cannot withdraw comment CID=${my_cid} because it was not posted by you.`)
      if (!removed) return failed(`Your reply with CID=${my_cid} under comment CID=${cid} (or anywhere in moment MOID=${moid}) was not found.`)
      return ok(`You have successfully withdrawn your reply (CID=${my_cid}) to comment (CID=${cid}) under moment (MOID=${moid}) of contact \`${c.name}\` (UID=${uid})`)
    }),
  },
  mark_as_read: {
    params: [['uid', 'str']],
    run: unblocked((_s, c, { uid }) => {
      c.read_new_message = true
      return ok(`You have successfully marked the messages from contact \`${c.name}\` (UID=${uid}) as read`)
    }),
  },
  mark_as_unread: {
    params: [['uid', 'str']],
    run: unblocked((_s, c, { uid }) => {
      c.read_new_message = false
      return ok(`You have successfully marked the messages from contact \`${c.name}\` (UID=${uid}) as unread`)
    }),
  },
  get_my_moments: { params: [], run: net((s) => ok(clone(s.d.contacts[s.d.my_uid]!.moments))) },
  post_moment: {
    params: [['content', 'str'], ['img_urls', 'list[str]']],
    run: net(async (s, { content, img_urls }) => {
      const me = s.d.contacts[s.d.my_uid]
      if (me === undefined) throw keyError(s.d.my_uid)
      const moid = `mo_${uuid(s.rng)}`
      me.moments.push({ moid, owner_uid: s.d.my_uid, content, timestamp: await s.os.step(), ip: s.d.my_ip, img_urls, who_likes: [], comments: [] })
      return ok(`You have successfully post a moment (MOID = ${moid})`)
    }, true),
  },
  delete_moment: {
    params: [['moid', 'str']],
    run: net((s, { moid }) => {
      const me = s.d.contacts[s.d.my_uid]!
      const i = me.moments.findIndex((m) => m.moid === moid)
      if (i >= 0) {
        me.moments.splice(i, 1)
        return ok(`You have successfully deleted one moment (MOID = ${moid})`)
      }
      return failed(`Moment (MOID = ${moid}) not found`)
    }, true),
  },
  get_shared_url_of_moment: {
    params: [['uid', 'str'], ['moid', 'str']],
    run: async (_s, { uid, moid }) => ok(`light://moment.talk.so?uid=${uid}&moid=${moid}`),
  },
  get_shared_url_of_contact: { params: [['uid', 'str']], run: async (_s, { uid }) => ok(`light://contact.talk.so?uid=${uid}`) },
  delete_contact: {
    params: [['uid', 'str']],
    run: net((s, { uid }) => {
      if (uid === s.d.my_uid) return failed("You can't delete yourself.")
      const c = s.d.contacts[uid]
      if (c === undefined) return failed(`Contact with UID (${uid}) not found`)
      delete s.d.contacts[uid]
      return ok(`You have successfully deleted the contact ${c.name} (UID=${c.uid})`)
    }, true),
  },
  ask_for_privilege: {
    params: [],
    run: async (s) => {
      s.d.has_privilege = true
      return ok('You have successfully got the privilege')
    },
  },
  list_ip_choices: { params: [], run: net((s) => ok(s.d.ip_choices)) },
  change_my_ip: {
    params: [['where', 'str']],
    run: net((s, { where }) => {
      if (!s.d.ip_choices.includes(where)) return failed(`Unsupported IP address: ${where}`)
      s.d.my_ip = where
      return ok(`Your IP address has already been set to ${s.d.my_ip}`)
    }),
  },
  edit_remark: {
    params: [['uid', 'str'], ['remark', 'str']],
    run: net((s, { uid, remark }) => {
      const [c, err] = s.get(uid)
      if (err) return err
      c!.remark = remark
      return ok(`The remark for contact ${c!.name} (UID=${c!.uid}) has been successfully updated to: ${c!.remark}`)
    }),
  },
  delete_remark: {
    params: [['uid', 'str']],
    run: net((s, { uid }) => {
      const [c, err] = s.get(uid)
      if (err) return err
      c!.remark = ''
      return ok(`The remark for contact ${c!.name} (UID=${c!.uid}) has been successfully deleted.`)
    }),
  },
  create_group_chat: {
    params: [['uids', 'list[str]']],
    run: net((s, { uids }) => {
      for (const uid of uids as string[]) {
        if (!(uid in s.d.contacts)) return failed(`Contact with UID (${uid}) not found`)
      }
      const members = sorted([...new Set([...(uids as string[]), s.d.my_uid])])
      const gid = `group_${uuid(s.rng)}`
      s.d.groups.push({ gid, name: `Group Chat ${s.d.groups.length + 1}`, owner_id: s.d.my_uid, uids: members, chat_history: [], read_new_message: true })
      return ok(`You have successfully created a group (GID=${gid})`)
    }, true),
  },
  send_message_to_group: {
    params: [['gid', 'str'], ['content', 'str'], ['at', 'list[str]|str', []]],
    run: (s, { gid, content, at }) => s.sendMessageToGroup(gid, content, at),
  },
  get_group_chat_history: {
    params: [['gid', 'str']],
    run: net((s, { gid }) => {
      const [g, err] = s.group(gid)
      // Upstream returns the group here, which is None.
      if (err) return null
      return ok(clone(g!.chat_history))
    }),
  },
  send_image: { params: [['uid', 'str'], ['img_url', 'str']], run: (s, { uid, img_url }) => s.sendMessage(uid, `<img str=${img_url} />`) },
  send_image_to_group: {
    params: [['gid', 'str'], ['img_url', 'str'], ['at', 'list[str]|str', []]],
    // Upstream passes no `at` on.
    run: (s, { gid, img_url }) => s.sendMessageToGroup(gid, `<img str=${img_url} />`, undefined),
  },
  rename_group: {
    params: [['gid', 'str'], ['name', 'str']],
    run: net((s, { gid, name }) => {
      const [g, err] = s.group(gid)
      if (err) return err
      g!.name = name
      return ok(`You have successfully renamed the group chat (GID=${gid}) to '${g!.name}'`)
    }, true),
  },
  delete_group: {
    params: [['gid', 'str']],
    run: net((s, { gid }) => {
      const i = s.d.groups.findIndex((g) => g.gid === gid)
      if (i >= 0) {
        if (s.d.groups[i]!.owner_id !== s.d.my_uid) return failed(`You are not the owner of the group chat (GID=${gid})`)
        s.d.groups.splice(i, 1)
        return ok(`You have successfully deleted the group chat (GID=${gid})`)
      }
      return failed(`Group chat with GID (${gid}) not found`)
    }, true),
  },
  change_owner_of_group: {
    params: [['gid', 'str'], ['uid', 'str']],
    run: net((s, { gid, uid }) => {
      const [g, err] = s.group(gid)
      if (err) return err
      if (g!.owner_id !== s.d.my_uid) return failed(`You are not the owner of the group (GID=${gid})`)
      const [c, err2] = s.get(uid)
      if (err2) return err2
      g!.owner_id = uid
      return ok(`The owner of group chat (GID=${gid}) has already been changed to contact ${c!.name} (UID=${c!.uid})`)
    }, true),
  },
  quit_group: {
    params: [['gid', 'str']],
    run: net((s, { gid }) => {
      const [g, err] = s.group(gid)
      if (err) return err
      if (g!.owner_id === s.d.my_uid) return failed(`You are the owner of the group chat (GID=${gid}), you can't quit.`)
      const i = s.d.groups.findIndex((x) => x.gid === gid)
      if (i >= 0) {
        s.d.groups.splice(i, 1)
        return ok(`You have successfully quit the group chat (GID=${gid})`)
      }
      return { status: 'internel error', output: 'Unknown runtime error' }
    }, true),
  },
  invite_new_member: {
    params: [['gid', 'str'], ['uid', 'str']],
    run: net((s, { gid, uid }) => {
      const [g, err] = s.group(gid)
      if (err) return err
      const [c, err2] = s.get(uid)
      if (err2) return err2
      g!.uids.push(uid)
      g!.uids = sorted(g!.uids)
      return ok(`You have successfully invite a new member ${c!.name} (UID=${uid}) to group chat (GID=${gid})`)
    }),
  },
  list_all_groups: {
    params: [],
    run: net((s) => ok(s.d.groups.map((g) => ({ gid: g.gid, name: g.name, owner_id: g.owner_id, uids: [...g.uids] })))),
  },
  get_group_info: {
    params: [['gid', 'str']],
    run: net((s, { gid }) => {
      const [g, err] = s.group(gid)
      if (err) return err
      return ok({ gid: g!.gid, name: g!.name, owner_id: g!.owner_id, uids: [...g!.uids], read_new_messages: g!.read_new_message })
    }),
  },
  mark_as_read_in_group: {
    params: [['gid', 'str']],
    run: net((s, { gid }) => {
      const [g, err] = s.group(gid)
      if (err) return err
      g!.read_new_message = true
      return ok(`All messages in group chat (GID=${gid}) has been marked as read`)
    }),
  },
  mark_as_unread_in_group: {
    params: [['gid', 'str']],
    run: net((s, { gid }) => {
      const [g, err] = s.group(gid)
      if (err) return err
      g!.read_new_message = false
      return ok(`All messages in group chat (GID=${gid}) has been marked as unread`)
    }),
  },
  acc_network: {
    params: [],
    run: async (s) => {
      s.d.network_acc = true
      return ok('You have successfully accelerated the network for the LightTalk app.')
    },
  },
  get_my_name: { params: [], run: async (s) => ok(s.d.my_name) },
}

export const LightTalk: App<Talk, TalkData> = {
  name: 'LightTalk',
  tools,
  load: (data, os) => new Talk(data, os),
  save: (s) => s.data(),
  sessionDict: (s) => ({
    contacts: clone(s.d.contacts),
    groups: sorted(clone(s.d.groups), (g) => g.name),
  }),
}
