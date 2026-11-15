// The catch handler for a registration: when the hook throws, the event passes on to next(e).
// The engine's replay rule applies: if the hook had already called next, the call is replayed,
// so nothing runs twice. Use as: on('event', hook).catch(fallThrough).
export function fallThrough<E, R>(_$: unknown, e: E, next: (e: E) => R): R {
  return next(e)
}
