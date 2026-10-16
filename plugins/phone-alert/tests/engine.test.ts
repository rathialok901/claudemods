import { expect, mock, test } from 'claude-code/testing'

test('alerts for a long turn and an unanswered approval only while you are away', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const runs: string[][] = []
  let idle = 600
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const stdout = e.argv[0] === 'ioreg' ? `"HIDIdleTime" = ${idle * 1e9}` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.check', () => ({ decision: 'ask' }) as never)
  const curls = () => runs.filter(r => r[0] === 'curl').map(r => r.join(' '))

  const setup = await $.command.run({ command: 'phone-alert', args: 'ntfy claude-testtopic' } as never)
  expect(JSON.stringify(setup)).toContain('claude-testtopic')

  // Away for 10 minutes: a 4-minute turn alerts.
  await $.turn.complete({ durationMs: 245_000, reason: 'answer', isAborted: false, answer: 'ok' } as never)
  await clock.advance(0)
  expect(curls().length).toBe(1)
  expect(curls()[0]).toContain('https://ntfy.sh/claude-testtopic')
  expect(curls()[0]).toContain('Title: Claude Code: done')

  // At the Mac: nothing.
  idle = 10
  await $.turn.complete({ durationMs: 245_000, reason: 'answer', isAborted: false, answer: 'ok' } as never)
  await clock.advance(0)
  expect(curls().length).toBe(1)

  // Short turns never alert.
  idle = 600
  await $.turn.complete({ durationMs: 5_000, reason: 'answer', isAborted: false, answer: 'ok' } as never)
  await clock.advance(0)
  expect(curls().length).toBe(1)

  // An approval left open: alerts on the next check once you're away.
  idle = 10
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'tu1' } as never)
  await clock.advance(30_000)
  expect(curls().length).toBe(1)
  idle = 600
  await clock.advance(30_000)
  expect(curls().length).toBe(2)
  expect(curls()[1]).toContain('Priority: high')

  // Turned off: nothing.
  await $.command.run({ command: 'phone-alert', args: 'off' } as never)
  await $.turn.complete({ durationMs: 245_000, reason: 'answer', isAborted: false, answer: 'ok' } as never)
  await clock.advance(0)
  expect(curls().length).toBe(2)
})
