/**
 * Minimal logger interface consumed by firescore wrappers.
 *
 * Any object matching this shape can be injected — this includes pino,
 * bunyan, winston-style wrappers or a custom sink that ships logs to a
 * remote service.
 *
 * @example
 * ```ts
 * import { FirInstance, ConsoleLogger } from 'firescore';
 *
 * const instance = new FirInstance(creds, 'prod', {
 *   logger: new ConsoleLogger('debug'),
 * });
 * ```
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/** Discards every log call. Used by default. */
export const NoopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Simple `console`-backed logger with level filtering.
 *
 * @example
 * ```ts
 * const logger = new ConsoleLogger('warn', '[myapp]');
 * logger.debug('ignored');       // filtered out
 * logger.error('boom', { id }); // [myapp] boom { id: '...' }
 * ```
 */
export class ConsoleLogger implements Logger {
  private readonly minLevel: number;

  constructor(
    public readonly level: LogLevel = 'info',
    public readonly prefix: string = '[firescore]',
  ) {
    this.minLevel = LEVEL_ORDER[level];
  }

  private shouldLog(l: LogLevel): boolean {
    return LEVEL_ORDER[l] >= this.minLevel;
  }

  private emit(l: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(l)) return;
    const args = context && Object.keys(context).length > 0
      ? [this.prefix, message, context]
      : [this.prefix, message];
    // eslint-disable-next-line no-console
    (console[l] ?? console.log).apply(console, args);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.emit('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.emit('warn', message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.emit('error', message, context);
  }
}

/**
 * In-memory logger that records every call. Useful in tests.
 *
 * @example
 * ```ts
 * const logger = new MemoryLogger();
 * const wrapper = new FirestoreWrapper(instance);
 * // ... run code ...
 * expect(logger.entries.filter(e => e.level === 'warn')).toHaveLength(1);
 * ```
 */
export class MemoryLogger implements Logger {
  readonly entries: Array<{
    level: LogLevel;
    message: string;
    context?: Record<string, unknown>;
  }> = [];

  private record(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    this.entries.push(context ? { level, message, context } : { level, message });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.record('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.record('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.record('warn', message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.record('error', message, context);
  }

  clear(): void {
    this.entries.length = 0;
  }
}
