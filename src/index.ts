import express from 'express';
import { config } from './config';
import { logger } from './logger';
import { artRouter } from './routes/art';

const app = express();

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.use('/', artRouter);
app.use((_req, res) => res.status(404).send('Not found'));

const server = app.listen(config.port, () => {
  logger.info(`stremio-art-proxy listening on port ${config.port}`);
});

// Graceful shutdown: stop accepting new connections, let in-flight requests
// finish, then exit. Docker sends SIGTERM on `docker stop`/`docker compose down`
// and gives ~10s (default) before a hard SIGKILL, so this needs to be prompt.
function shutdown(signal: string): void {
  logger.info(`received ${signal}, shutting down gracefully...`);

  server.close((err) => {
    if (err) {
      logger.error('error while closing server', err);
      process.exit(1);
    }
    logger.info('shutdown complete');
    process.exit(0);
  });

  // Safety net in case something (e.g. a lingering keep-alive connection)
  // prevents server.close() from ever calling back.
  setTimeout(() => {
    logger.warn('shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
