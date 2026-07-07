import { createApp } from './server.js';

const PORT = Number(process.env.PORT ?? 8080);

const { httpServer } = createApp();

httpServer.listen(PORT, () => {
  console.log(`Leekha server listening on :${PORT}`);
});
