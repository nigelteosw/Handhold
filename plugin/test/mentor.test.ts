import { expect, test } from 'claude-code/testing'

import { isTrivial } from '../src/mentor/gate'
import { assessAttrs, needsNudge, parseAssessment } from '../src/mentor/assessment'
import { RUBRIC_TEXT, TECHNIQUES } from '../src/mentor/rubric'
import * as churn from './fixtures/churn'
import * as crash from './fixtures/crash'
import * as qbr from './fixtures/qbr'
import * as trivial from './fixtures/trivial'

test('the gate passes trivial lookups and not the essay cases', () => {
  expect(isTrivial(trivial.prompt)).toBe(true)
  expect(isTrivial(qbr.prompt)).toBe(false)
  expect(isTrivial(churn.prompt)).toBe(false)
  expect(isTrivial(crash.prompt)).toBe(false)
})

test('a judge reply parses to the fixture expectation', () => {
  expect(parseAssessment(qbr.judgeReply)).toMatchObject(qbr.expected)
})

test('prose around the judge JSON is ignored', () => {
  const wrapped = 'Sure! ' + qbr.judgeReply + ' Hope that helps'
  expect(parseAssessment(wrapped)).toEqual(parseAssessment(qbr.judgeReply))
})

test('an unknown technique, a score out of range, or non-JSON gives null', () => {
  const base = JSON.parse(qbr.judgeReply)
  expect(parseAssessment(JSON.stringify({ ...base, technique: 'vibes' }))).toBeNull()
  expect(parseAssessment(JSON.stringify({ ...base, scores: { ...base.scores, altitude: 4 } }))).toBeNull()
  expect(parseAssessment('not json')).toBeNull()
})

test('a warranted:false reply needs no nudge', () => {
  const a = parseAssessment(trivial.judgeReply)
  expect(a?.warranted).toBe(false)
  expect(a && needsNudge(a)).toBe(false)
})

test('the rubric names every technique', () => {
  for (const t of TECHNIQUES) expect(RUBRIC_TEXT).toContain(t)
})

test('assessAttrs keys the altitude score as spec section 4', () => {
  const a = parseAssessment(qbr.judgeReply)
  expect(a && assessAttrs(a, 'pre')['handhold.score.altitude']).toBe(1)
})
