import type { Register } from 'claude-code'

import { registerCapture } from '../src/capture/hooks'
import { readConfig } from '../src/shared/config'

export const register: Register = (on, options) => {
  registerCapture(on, readConfig(options as Record<string, unknown>))
}
