import { describe, expect, it, vi } from 'vitest';

import { ConsoleLogger, MemoryLogger, NoopLogger } from '../src/index.js';

describe('NoopLogger', () => {
  it('accepts every level silently', () => {
    NoopLogger.debug('a');
    NoopLogger.info('b');
    NoopLogger.warn('c');
    NoopLogger.error('d', { k: 1 });
    // nothing to assert — just proving nothing throws.
  });
});

describe('ConsoleLogger', () => {
  it('filters by minimum level', () => {
    const logger = new ConsoleLogger('warn', '[test]');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e', { k: 1 });

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[test]', 'e', { k: 1 });

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('MemoryLogger', () => {
  it('records every call with level and context', () => {
    const logger = new MemoryLogger();
    logger.info('hello');
    logger.error('boom', { code: 42 });
    logger.warn('careful');

    expect(logger.entries).toHaveLength(3);
    expect(logger.entries[0]).toEqual({ level: 'info', message: 'hello' });
    expect(logger.entries[1]).toEqual({
      level: 'error',
      message: 'boom',
      context: { code: 42 },
    });
    expect(logger.entries[2]).toEqual({ level: 'warn', message: 'careful' });
  });

  it('clears its buffer on demand', () => {
    const logger = new MemoryLogger();
    logger.info('a');
    logger.info('b');
    logger.clear();
    expect(logger.entries).toHaveLength(0);
  });
});
