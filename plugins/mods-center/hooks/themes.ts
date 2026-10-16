// Colour themes for the control center. Hex colours are drawn in true colour where the
// terminal has it and the nearest of its 256 colours elsewhere.

export type Theme = {
  label: string
  title: readonly string[]
  groups: { look: string; smart: string; safety: string; status: string }
  on: string
  off: string
  info: string
  warn: string
  border: string
  accent: string
  bars: { context: string; budget: string; limits: string }
}

export const THEMES: Record<string, Theme> = {
  classic: {
    label: '🌈 Classic',
    title: ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'],
    groups: { look: 'magenta', smart: 'cyan', safety: 'yellow', status: 'blue' },
    on: 'green',
    off: 'red',
    info: 'cyan',
    warn: 'yellow',
    border: 'cyan',
    accent: 'magenta',
    bars: { context: 'green', budget: 'magenta', limits: 'blue' },
  },
  neon: {
    label: '⚡ Neon',
    title: ['#ff00ff', '#ff3cac', '#00f0ff', '#39ff14', '#fff200', '#ff6ec7'],
    groups: { look: '#ff00ff', smart: '#00f0ff', safety: '#fff200', status: '#39ff14' },
    on: '#39ff14',
    off: '#ff3131',
    info: '#00f0ff',
    warn: '#fff200',
    border: '#ff00ff',
    accent: '#00f0ff',
    bars: { context: '#39ff14', budget: '#ff00ff', limits: '#00f0ff' },
  },
  pastel: {
    label: '🍬 Pastel',
    title: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff'],
    groups: { look: '#ffc6ff', smart: '#9bf6ff', safety: '#ffd6a5', status: '#bdb2ff' },
    on: '#a0e8af',
    off: '#ffadad',
    info: '#9bf6ff',
    warn: '#ffd6a5',
    border: '#bdb2ff',
    accent: '#ffc6ff',
    bars: { context: '#caffbf', budget: '#ffc6ff', limits: '#9bf6ff' },
  },
  ocean: {
    label: '🌊 Ocean',
    title: ['#00b4d8', '#48cae4', '#90e0ef', '#0096c7', '#00b4d8', '#caf0f8'],
    groups: { look: '#48cae4', smart: '#00b4d8', safety: '#90e0ef', status: '#0077b6' },
    on: '#2ec4b6',
    off: '#ef476f',
    info: '#48cae4',
    warn: '#ffd166',
    border: '#0096c7',
    accent: '#90e0ef',
    bars: { context: '#2ec4b6', budget: '#48cae4', limits: '#0096c7' },
  },
  sunset: {
    label: '🌅 Sunset',
    title: ['#ff595e', '#ff924c', '#ffca3a', '#ff924c', '#ff595e', '#c9184a'],
    groups: { look: '#ff595e', smart: '#ff924c', safety: '#ffca3a', status: '#c9184a' },
    on: '#ffca3a',
    off: '#c9184a',
    info: '#ff924c',
    warn: '#ffca3a',
    border: '#ff595e',
    accent: '#ff924c',
    bars: { context: '#ffca3a', budget: '#ff595e', limits: '#ff924c' },
  },
  mono: {
    label: '◻️ Mono',
    title: ['white', 'gray', 'white', 'gray', 'white', 'gray'],
    groups: { look: 'white', smart: 'white', safety: 'white', status: 'white' },
    on: 'white',
    off: 'gray',
    info: 'gray',
    warn: 'white',
    border: 'gray',
    accent: 'white',
    bars: { context: 'white', budget: 'white', limits: 'white' },
  },
}

export const THEME_ORDER = ['classic', 'neon', 'pastel', 'ocean', 'sunset', 'mono']

export function themeOf(name: string | undefined): Theme {
  return THEMES[name ?? 'classic'] ?? (THEMES.classic as Theme)
}

export function nextTheme(name: string): string {
  const i = THEME_ORDER.indexOf(name)

  return THEME_ORDER[(i + 1) % THEME_ORDER.length] ?? 'classic'
}
