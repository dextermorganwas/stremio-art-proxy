import express from 'express';
import { config } from './config';
import { logger } from './logger';
import { artRouter } from './routes/art';

const app = express();

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.use('/', artRouter);
app.use((_req, res) => res.status(404).send('Not found'));

app.listen(config.port, () => {
  logger.info(`stremio-art-proxy listening on port ${config.port}`);
});
