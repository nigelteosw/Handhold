// Wraps a hook so that a throw never breaks the chain. If the hook had already
// called next, its result is replayed (next must not run twice). Otherwise the
// event passes straight on to next(e), as if this plugin had not hooked it.
export function safe<H extends (...args: any[]) => any>(hook: H): H {
  return (async (...args: any[]) => {
    const [$, e, next] = args
    let isCalled = false
    let lastResult: unknown
    const tracked = Object.assign(
      (x: unknown) => {
        isCalled = true
        lastResult = next(x)
        return lastResult
      },
      next,
    )

    try {
      return await hook($, e, tracked, ...args.slice(3))
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error'
      $?.ui?.log?.(`handhold: hook failed (${name})`, { to: 'debug' })
      return isCalled ? lastResult : next(e)
    }
  }) as H
}
