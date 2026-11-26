// The settings window (src-tauri/src/lib.rs opens it).
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '../styles/tokens.css'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { mount } from 'svelte'
import { getAbout, getSettings, onSettingsChanged, setSettings, type Settings as AppSettings } from './backend'
import { isMac, shortcut } from './keys'
import Settings from './Settings.svelte'
import { applyTheme } from './theme'

const settings = await getSettings()
applyTheme(settings.theme)
await onSettingsChanged((changed) => applyTheme(changed.theme))
mount(Settings, {
  target: document.body,
  props: {
    initial: settings,
    showQuit: isMac,
    about: isMac ? null : await getAbout(),
    onChange: (changed: AppSettings) => void setSettings(changed),
  },
})

// Linux: Ctrl+W closes the window and Ctrl+Q quits. On macOS the menu bar handles them.
window.addEventListener('keydown', (event) => {
  const action = shortcut(event)
  if (action === 'close-tab') void getCurrentWindow().close()
  else if (action === 'quit') void invoke('quit_app')
})

await document.fonts.ready
// The window starts hidden, so that it shows with the right theme.
void getCurrentWindow().show()
