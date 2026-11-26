// Dev preview of the settings window without Tauri.
// ?os=mac (default) | linux: macOS has "Warn Before Quitting", Linux has the About section.
// ?theme=light | dark forces a theme. A click on a theme changes the theme of this page.
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '../src/styles/tokens.css'
import { mount } from 'svelte'
import Settings from '../src/app/Settings.svelte'
import type { Settings as AppSettings } from '../src/app/backend'
import { applyTheme, type Theme } from '../src/app/theme'

const params = new URLSearchParams(location.search)
const theme = (params.get('theme') ?? 'system') as Theme
const mac = params.get('os') !== 'linux'
applyTheme(theme)
mount(Settings, {
  target: document.body,
  props: {
    initial: { warnBeforeQuit: true, theme },
    showQuit: mac,
    about: mac
      ? null
      : { name: 'Marky', version: '0.1.0', copyright: 'Copyright © 2026 iammerlijn', license: 'GPL-3.0', repository: 'https://github.com/iammerlijn/marky' },
    save: async (settings: AppSettings) => applyTheme(settings.theme),
  },
})
await document.fonts.ready
document.body.dataset.ready = 'true'
