import { expect, test } from 'claude-code/testing'

import { FACES, dot, meterFor, moodFor } from '../hooks/register'

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

test('tools map to moods', async () => {
  expect(moodFor('Edit', { file_path: '/x/src/app.ts' })).toEqual(['editing', 'editing app.ts'])
  expect(moodFor('Bash', { command: 'npm test', description: 'Run tests' })).toEqual(['running', 'Run tests'])
  expect(moodFor('WebSearch', {})[0]).toBe('web')
})

test('the band draws a face and yields to a survey', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mascot', surface, component: 'AbovePrompt', props: BAND })
    const face = await ui.find({ type: 'Text', text: FACES.idle[0] })
    expect(face).toBeDefined()
    await ui.unmount()
  }
  const survey = await $.ui.mount({
    plugin: 'mascot',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND, hasSurvey: true },
  })
  expect(await survey.find({ type: 'Text', text: FACES.idle[0] })).toBeUndefined()
  expect(await survey.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await survey.unmount()
})

test('meter figures for the right of the band', async () => {
  expect(
    meterFor({ window: 200000, percent: 4 }, [{ kind: 'five_hour', percentUsed: 12 }, { kind: 'seven_day', percentUsed: 2 }], { usd: 0.11 }),
  ).toEqual({ worst: 12, text: 'ctx 4% · 5h 12% · 7d 2% · $0.11' })
  expect(meterFor({ window: 200000 }, [], undefined)).toBeNull()
  expect(dot(90)).toBe('🔴')
})
