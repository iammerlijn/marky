<script lang="ts">
  // The settings window (Cmd+, on macOS, Ctrl+, on Linux). Each change saves at once.
  import { saveOrKeep, type About, type Settings } from './backend'
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
  const themes: [Theme, string][] = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ]

  async function change(update: Partial<Settings>) {
    const old = settings
    settings = { ...settings, ...update }
    settings = await saveOrKeep(old, settings, save)
  }
</script>

<main class="settings">
  <section>
    <h2 id="appearance">Appearance</h2>
    <div class="choices" role="radiogroup" aria-labelledby="appearance">
      {#each themes as [value, label] (value)}
        <label class="choice" class:on={settings.theme === value}>
          <input type="radio" name="theme" {value} checked={settings.theme === value} onchange={() => change({ theme: value })} />
          {label}
        </label>
      {/each}
    </div>
  </section>

  {#if showQuit}
    <section>
      <label class="check">
        <input type="checkbox" checked={settings.warnBeforeQuit} onchange={(e) => change({ warnBeforeQuit: e.currentTarget.checked })} />
        Warn Before Quitting
      </label>
      <p class="note">Ask before ⌘Q quits Marky.</p>
    </section>
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
    gap: 24px;
    padding: 24px;
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

  .choices {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--code-bg);
    border-radius: 8px;
  }
  .choice {
    flex: 1;
    padding: 6px 12px;
    border-radius: var(--radius);
    text-align: center;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .choice:hover {
    color: var(--text);
  }
  .choice.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--border);
  }
  .choice:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  /* The label is the button. The radio input stays for the keyboard and screen readers. */
  .choice input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .check input {
    margin: 0;
    accent-color: var(--accent);
  }
  .note {
    margin: 4px 0 0 21px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .about {
    padding-top: 16px;
    border-top: 1px solid var(--border);
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
