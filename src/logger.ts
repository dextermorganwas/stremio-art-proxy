import { config } from './config';

const levels = ['error', 'warn', 'info', 'debug'] as const;
type Level = (typeof levels)[number];

function shouldLog(level: Level): boolean {
  const configured = (levels as readonly string[]).includes(config.logLevel) ? (config.logLevel as Level) : 'info';
  return levels.indexOf(level) <= levels.indexOf(configured);
}

function fmt(level: Level, args: unknown[]): unknown[] {
  return [`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args];
}

export const logger = {
  error: (...args: unknown[]) => shouldLog('error') && console.error(...fmt('error', args)),
  warn: (...args: unknown[]) => shouldLog('warn') && console.warn(...fmt('warn', args)),
  info: (...args: unknown[]) => shouldLog('info') && console.log(...fmt('info', args)),
  debug: (...args: unknown[]) => shouldLog('debug') && console.log(...fmt('debug', args)),
};
