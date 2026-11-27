import { startServer } from './gws.mjs';

const server = await startServer(0);
console.log(`GWS_URL=http://127.0.0.1:${server.address().port}`);
