// The settings window (src-tauri/src/lib.rs opens it).
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '../styles/tokens.css'
import { invoke } from '@tauri-apps/api/core'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { mount } from 'svelte'
import { getAbout, getSettings, onSettingsChanged, setSettings, type Settings as AppSettings } from './backend'
import { isMac, shortcut } from './keys'
import Settings from './Settings.svelte'
import { followTheme } from './theme'

const settings = await followTheme(getSettings, onSettingsChanged)
mount(Settings, {
  target: document.body,
  props: {
    initial: settings,
    showQuit: isMac,
    about: isMac ? null : await getAbout(),
    save: (changed: AppSettings) =>
      setSettings(changed).catch(async (error) => {
        await message(`Marky could not save the settings.\n\n${error}`, { kind: 'error' })
        throw error
      }),
  },
})

// Linux: Ctrl+W closes the window and Ctrl+Q quits. On macOS the menu bar handles them.
window.addEventListener('keydown', (event) => {
  const action = shortcut(event)
  if (action === 'close-tab') void getCurrentWindow().close()
  else if (action === 'quit') void invoke('quit_app')
})

await document.fonts.ready
// The window gets the height of the page. The size in show_settings (src-tauri/src/lib.rs) is
// only a first guess: the space of the title bar and the fonts are not the same on each system.
const win = getCurrentWindow()
const missing = document.body.offsetHeight - window.innerHeight
if (window.innerHeight > 0 && missing !== 0) {
  const size = (await win.innerSize()).toLogical(await win.scaleFactor())
  await win.setSize(new LogicalSize(size.width, size.height + missing))
}
// The window starts hidden, so that it shows with the right theme.
void win.show()
