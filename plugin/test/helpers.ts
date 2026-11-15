import { test } from 'claude-code/testing'

import { readConfig } from '../src/shared/config'

// The config the tests run with: the manifest defaults.
export const defaultConfig = readConfig({})

// The `on` a test body receives, typed from the kit's own test signature.
export type KitOn = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]
