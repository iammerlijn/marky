<script lang="ts">
  // The settings window (Cmd+, on macOS, Ctrl+, on Linux). Each change saves at once.
  import { settingsSaver, type About, type Settings } from './backend'
  import type { Theme } from './theme'

  interface Props {
    initial: Settings
    // Only macOS asks before Cmd+Q quits (src-tauri/src/lib.rs).
    showQuit: boolean
    // Linux has no About panel: the settings window shows the information. null on macOS.
    about: About | null
    // Rejects when the save fails. Then the controls show the old settings again.
    save: (settings: Settings) => Promise<unknown>
  }

  let { initial, showQuit, about, save }: Props = $props()

  // svelte-ignore state_referenced_locally
  let settings = $state({ ...initial })
  // svelte-ignore state_referenced_locally
  const saveChange = settingsSaver(initial, save)
  const themes: [Theme, string][] = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ]

  // The theme control: a radio group. The arrow keys choose the next or the previous theme.
  const segments: HTMLButtonElement[] = []
  const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
  function choose(theme: Theme) {
    if (theme !== settings.theme) void change({ theme })
  }
  function themeKey(event: KeyboardEvent, index: number) {
    const step = steps[event.key]
    if (!step) return
    event.preventDefault()
    const next = (index + step + themes.length) % themes.length
    segments[next].focus()
    choose(themes[next][0])
  }

  async function change(update: Partial<Settings>) {
    settings = { ...settings, ...update }
    settings = await saveChange(settings)
  }
</script>

<main class="settings">
  <div class="row">
    <div class="text">
      <p class="label" id="appearance">Appearance</p>
      <p class="note">Light or dark, or as your system is now.</p>
    </div>
    <div class="segmented" role="radiogroup" aria-labelledby="appearance">
      {#each themes as [value, label], index (value)}
        <button
          bind:this={segments[index]}
          type="button"
          role="radio"
          aria-checked={settings.theme === value}
          tabindex={settings.theme === value ? 0 : -1}
          onclick={() => choose(value)}
          onkeydown={(e) => themeKey(e, index)}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>

  {#if showQuit}
    <div class="row">
      <div class="text">
        <label class="label" for="warn-quit">Warn Before Quitting</label>
        <p class="note">Ask before ⌘Q quits Marky.</p>
      </div>
      <input
        id="warn-quit"
        type="checkbox"
        checked={settings.warnBeforeQuit}
        onchange={(e) => change({ warnBeforeQuit: e.currentTarget.checked })}
      />
    </div>
  {/if}

  {#if about}
    <section class="about">
      <h2>About</h2>
      <p class="name">{about.name} <span>{about.version}</span></p>
      <p>{about.copyright}</p>
      <p>License: {about.license}</p>
      <p class="link">{about.repository}</p>
    </section>
  {/if}
</main>

<style>
  /* Native controls follow the theme. */
  :global(:root) {
    color-scheme: light dark;
  }
  :global(:root[data-theme='light']) {
    color-scheme: light;
  }
  :global(:root[data-theme='dark']) {
    color-scheme: dark;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-text);
    font-size: 14px;
    line-height: 1.5;
    user-select: none;
    -webkit-user-select: none;
    cursor: default;
  }

  .settings {
    display: flex;
    flex-direction: column;
    padding: 8px 24px 24px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--text-muted);
  }
  p {
    margin: 0;
  }

  /* A setting: the label and a note on the left, the control on the right. */
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 0;
    border-bottom: 1px solid var(--border);
  }
  .label {
    display: block;
    font-weight: 600;
  }
  .note {
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-muted);
  }
  /* Drawn here: the checkbox of macOS has a fixed small size. */
  .row input {
    appearance: none;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    margin: 0;
    border: 1.5px solid var(--text-muted);
    border-radius: 5px;
    cursor: pointer;
    transition:
      background 200ms ease,
      border-color 200ms ease;
  }
  .row input:checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .row input:checked::after {
    content: '';
    width: 5px;
    height: 10px;
    margin-top: -2px;
    border: solid #fff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .row input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* The theme control: a track with the three themes, the chosen theme raised. */
  .segmented {
    --track: var(--code-bg);
    --raised: var(--bg);
    display: flex;
    flex: none;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--track);
  }
  /* Dark: the track is darker than the page and the chosen theme lighter. Keep the two blocks
     the same, as in src/styles/tokens.css. */
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .segmented {
      --track: color-mix(in srgb, var(--bg), black 35%);
      --raised: var(--code-bg);
    }
  }
  :global(:root[data-theme='dark']) .segmented {
    --track: color-mix(in srgb, var(--bg), black 35%);
    --raised: var(--code-bg);
  }
  .segmented button {
    height: 26px;
    padding: 0 9px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text-muted);
    font: 400 13px/1 var(--font-text);
    cursor: pointer;
    transition:
      background 200ms ease,
      color 200ms ease;
  }
  .segmented button:hover {
    color: var(--text);
  }
  .segmented button[aria-checked='true'] {
    border-color: var(--border);
    background: var(--raised);
    color: var(--text);
  }
  .segmented button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .about {
    margin-top: 16px;
    font-size: 13px;
    color: var(--text-muted);
  }
  .about .name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .about .name span {
    font-weight: 400;
    color: var(--text-muted);
  }
  /* Marky has no browser opener: select the address to copy it. */
  .link {
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
  }
</style>
