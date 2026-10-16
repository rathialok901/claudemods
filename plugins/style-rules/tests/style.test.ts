import { expect, test } from 'claude-code/testing'

import { listing, sectionText } from '../hooks/register'

test('section and listing', async () => {
  expect(sectionText(['Short answers'])).toContain('- Short answers')
  expect(listing([])).toContain('/style add')
  expect(listing(['A', 'B'])).toContain('2. B')
})
