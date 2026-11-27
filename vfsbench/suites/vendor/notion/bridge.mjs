// The fake and its MCP client have only container loopback. A controller
// request arrives as JSON through docker exec rather than a published port.
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const {method, path, version, body} = JSON.parse(Buffer.concat(chunks))
const base = 'http://127.0.0.1:5091'
const url = new URL(path, base)
if (url.origin !== base || !url.pathname.startsWith('/v1/')) throw new Error('Invalid service path')
const reply = await fetch(url, {
  method, redirect: 'error',
  headers: {'Authorization': 'Bearer ' + process.env.NOTION_TENANT,
            'Notion-Version': version, 'Content-Type': 'application/json'},
  body: body ?? undefined,
})
console.log(JSON.stringify({status: reply.status, body: await reply.text()}))
