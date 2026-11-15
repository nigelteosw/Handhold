// The catch handler for a registration: when the hook throws, the event passes on to next(e).
// The engine's replay rule applies: if the hook had already called next, the call is replayed,
// so nothing runs twice. Use as: on('event', hook).catch(fallThrough).
export const fallThrough = (_$: unknown, e: unknown, next: (e: unknown) => unknown): unknown => next(e)
