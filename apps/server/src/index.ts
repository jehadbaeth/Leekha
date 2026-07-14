import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createApp } from './server.js';

const PORT = Number(process.env.PORT ?? 8080);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const webDist = process.env.WEB_DIST_PATH ?? join(__dirname, '../web-dist');

const { httpServer } = createApp({
  webDist,
  redisUrl: process.env.REDIS_URL,
  databasePath: process.env.DATABASE_PATH ?? join(__dirname, '../data/leekha.db'),
});

httpServer.listen(PORT, () => {
  console.log(`Leekha server listening on :${PORT}`);
});
