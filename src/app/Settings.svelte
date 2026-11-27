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
  const labelOf = (theme: Theme) => themes.find(([value]) => value === theme)![1]

  // The theme menu: a button that opens a listbox.
  let open = $state(false)
  let active = $state(0)
  let button: HTMLButtonElement | undefined = $state()
  let list: HTMLUListElement | undefined = $state()

  function openMenu() {
    active = themes.findIndex(([value]) => value === settings.theme)
    open = true
  }
  function closeMenu(focusButton = true) {
    open = false
    if (focusButton) button?.focus()
  }
  function choose(theme: Theme) {
    closeMenu()
    if (theme !== settings.theme) void change({ theme })
  }
  function buttonKey(event: KeyboardEvent) {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      openMenu()
    }
  }
  function listKey(event: KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowDown: () => (active = Math.min(active + 1, themes.length - 1)),
      ArrowUp: () => (active = Math.max(active - 1, 0)),
      Home: () => (active = 0),
      End: () => (active = themes.length - 1),
      Enter: () => choose(themes[active][0]),
      ' ': () => choose(themes[active][0]),
      Escape: () => closeMenu(),
      Tab: () => closeMenu(),
    }
    if (!keys[event.key]) return
    if (event.key !== 'Tab') event.preventDefault()
    keys[event.key]()
  }
  $effect(() => {
    if (open) list?.focus()
  })
  // A click outside the menu closes it.
  function outside(event: PointerEvent) {
    const target = event.target as Node
    if (open && !list?.contains(target) && !button?.contains(target)) closeMenu(false)
  }

  async function change(update: Partial<Settings>) {
    settings = { ...settings, ...update }
    settings = await saveChange(settings)
  }
</script>

<svelte:window onpointerdown={outside} />

{#snippet swatch(theme: Theme)}
  <span class="swatch {theme}" aria-hidden="true"><span class="dot"></span>Aa</span>
{/snippet}

<main class="settings">
  <div class="row">
    <div class="text">
      <p class="label" id="appearance">Appearance</p>
      <p class="note">Light or dark, or as your system is now.</p>
    </div>
    <div class="menu">
      <button
        bind:this={button}
        class="select"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="appearance theme-value"
        onclick={() => (open ? closeMenu() : openMenu())}
        onkeydown={buttonKey}
      >
        {@render swatch(settings.theme)}
        <span id="theme-value">{labelOf(settings.theme)}</span>
        <svg class="chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
      </button>
      {#if open}
        <ul
          bind:this={list}
          class="options"
          role="listbox"
          tabindex="-1"
          aria-labelledby="appearance"
          aria-activedescendant="theme-{themes[active][0]}"
          onkeydown={listKey}
        >
          {#each themes as [value, label], index (value)}
            <!-- svelte-ignore a11y_click_events_have_key_events (the listbox has the keys) -->
            <li
              id="theme-{value}"
              role="option"
              aria-selected={settings.theme === value}
              class:active={index === active}
              onpointerenter={() => (active = index)}
              onclick={() => choose(value)}
            >
              {@render swatch(value)}
              {label}
              {#if settings.theme === value}
                <svg class="check" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.5 5.75 10 11 4.5" /></svg>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
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
    box-sizing: border-box;
    /* Room for the open theme menu: the window gets the height of the page (src/app/settings.ts). */
    min-height: 192px;
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

  .menu {
    position: relative;
  }
  .select {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 8px 0 6px;
    border: none;
    border-radius: 8px;
    background: var(--code-bg);
    color: var(--text);
    font: 600 13px/1 var(--font-text);
  }
  .select:focus-visible,
  .options:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .chevron,
  .check {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .chevron {
    color: var(--text-muted);
  }
  .options {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 1;
    min-width: 168px;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(20, 22, 30, 0.12);
    animation: fade 200ms ease-out;
  }
  .options:focus-visible {
    outline: none;
  }
  .options li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 6px;
    border-radius: var(--radius);
    font-size: 13px;
    font-weight: 600;
  }
  .options li.active {
    background: var(--code-bg);
  }
  .check {
    margin-left: auto;
    color: var(--text-muted);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  /* A small picture of a theme, in the colors of src/styles/tokens.css. Two background layers:
     the text color, clipped to the text, on the page color. So the split System swatch can
     show both. */
  .swatch {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    width: 36px;
    height: 22px;
    padding: 0 6px;
    box-sizing: border-box;
    border-radius: var(--radius);
    box-shadow: inset 0 0 0 1px var(--border);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: transparent;
    background: var(--swatch-text), var(--swatch-bg);
    -webkit-background-clip: text, border-box;
    background-clip: text, border-box;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--swatch-accent);
  }
  .swatch.light {
    --swatch-bg: #ffffff;
    --swatch-text: linear-gradient(#2a2b2f, #2a2b2f);
    --swatch-accent: #5e6ad2;
  }
  .swatch.dark {
    --swatch-bg: #17181b;
    --swatch-text: linear-gradient(#d6d7da, #d6d7da);
    --swatch-accent: #7c85e0;
  }
  .swatch.system {
    --swatch-bg: linear-gradient(135deg, #ffffff 50%, #17181b 50%);
    --swatch-text: linear-gradient(135deg, #2a2b2f 50%, #d6d7da 50%);
    --swatch-accent: #5e6ad2;
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
