# Logging

Every wrapper accepts an optional `Logger`. Defaults to `NoopLogger`
(silent). When you do care about observability, you have three options
shipped out of the box plus any custom sink you want to write.

## The interface

```ts
interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info (message: string, context?: Record<string, unknown>): void;
  warn (message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
```

Any object with that shape works — `pino`, `bunyan`, `winston` are easy
to adapt.

## Built-in implementations

### `NoopLogger`

Default. Discards every call. Zero overhead.

### `ConsoleLogger(level?, prefix?)`

```ts
import { ConsoleLogger } from 'firescore';

const logger = new ConsoleLogger('debug', '[myapp/firescore]');
```

Levels filter: `debug < info < warn < error`. A `ConsoleLogger('warn')`
silences `debug` and `info`.

### `MemoryLogger`

Records every entry in an in-memory array. Handy for tests.

```ts
import { MemoryLogger } from 'firescore';

const logger = new MemoryLogger();
// ... run code ...
const bails = logger.entries.filter(e => e.message === 'firestore.retry.bail');
expect(bails).toHaveLength(1);
logger.clear();
```

## Plugging your own

```ts
import pino from 'pino';
import type { Logger } from 'firescore';

const pinoLogger = pino({ level: 'debug' });

const logger: Logger = {
  debug: (m, ctx) => pinoLogger.debug(ctx ?? {}, m),
  info:  (m, ctx) => pinoLogger.info(ctx ?? {}, m),
  warn:  (m, ctx) => pinoLogger.warn(ctx ?? {}, m),
  error: (m, ctx) => pinoLogger.error(ctx ?? {}, m),
};

new FirInstance(creds, 'prod', { logger });
```

## What firescore emits

| Event                                  | Level | Where                           |
|----------------------------------------|-------|---------------------------------|
| `firestore.retry.attempt`              | warn  | `executeWithRetry`              |
| `firestore.retry.succeeded`            | info  | `executeWithRetry`              |
| `firestore.retry.bail`                 | warn  | `executeWithRetry`              |
| `firestore.batch.set.committed`        | debug | `setDocumentsInBatches`         |
| `firestore.batch.update.committed`     | debug | `batchUpdateDocuments`          |
| `firestore.batch.delete.committed`     | debug | `batchDeleteDocuments`          |
| `firestore.queryPaginate.page`         | debug | `queryPaginate`                 |
| `firestore.listener.document.error`    | error | `onDocumentSnapshot`            |
| `firestore.listener.collection.error`  | error | `onCollectionSnapshot`          |
| `storage.upload.done`                  | debug | `FirStorageWrapper.uploadFile`  |

The event name is always the first argument; the context object carries
structured fields.

## Swapping at runtime

```ts
instance.setLogger(new ConsoleLogger('debug'));
```

New wrappers created from the instance will pick up the new logger.
Already-constructed wrappers keep their own reference to the original — if
you need to swap globally, re-construct them.
