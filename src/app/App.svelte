<script lang="ts">
  // The window chrome: tab bar, the "changed on disk" bar and the welcome screen.
  // The logic is in tabs.ts. This component only shows it.
  import { onMount } from 'svelte'
  import { isMac } from './keys'
  import { folderOf, whenLabel, type RecentFile } from './recent'
  import type { Tabs } from './tabs'

  interface Props {
    tabs: Tabs
    mod: string
    // The home folder, for ~ in paths. null when it is not known.
    home: string | null
    recent: () => RecentFile[]
    onOpen: () => void
    onNew: () => void
    onOpenRecent: (path: string) => void
    onClose: (id: number) => void
    onKeepMine: (id: number) => void
    onLoad: (id: number) => void
    onToggleRaw: () => void
  }

  let { tabs, mod, home, recent, onOpen, onNew, onOpenRecent, onClose, onKeepMine, onLoad, onToggleRaw }: Props = $props()

  let changes = $state(0)
  onMount(() => tabs.subscribe(() => changes++))

  const name = (path: string | null) => (path === null ? 'Untitled' : path.split('/').pop())
  const keyLabel = (key: string) => (mod === '⌘' ? `⌘${key}` : `${mod}+${key}`)
  const rawKey = mod === '⌘' ? '⌘⇧M' : `${mod}+Shift+M`
  const view = $derived.by(() => {
    changes
    return {
      list: tabs.tabs.map((t) => ({ id: t.id, path: t.path, dirty: t.dirty, active: t === tabs.active })),
      active: tabs.active ? { id: tabs.active.id, banner: tabs.active.banner, raw: tabs.active.rawText !== null } : null,
      recent: tabs.tabs.length === 0 ? recent() : [],
    }
  })

  const bannerText = {
    changed: 'This file changed on disk.',
    conflict: 'This file changed on disk. Marky did not save.',
    deleted: 'This file was deleted or renamed on disk.',
    'raw-only': 'Marky cannot show this file as a document, so it shows the markdown source. A save writes the source exactly.',
    large: 'This file is large, so Marky shows the markdown source. As a document, it can take some seconds to open.',
  }
</script>

<!-- On macOS the tab bar is in the title bar (tauri.conf.json): its empty part moves the window. -->
{#if view.list.length > 0}
  <nav class="tab-bar" class:mac={isMac} aria-label="Open files" data-tauri-drag-region>
    {#each view.list as tab (tab.id)}
      <div class="tab" class:active={tab.active} title={tab.path ?? 'Not saved yet'}>
        <button class="tab-name" type="button" onclick={() => tabs.activate(tab.id)} aria-current={tab.active ? 'page' : undefined}>
          {name(tab.path)}
        </button>
        <button class="tab-close" class:dirty={tab.dirty} type="button" onclick={() => onClose(tab.id)} aria-label={`Close ${name(tab.path)}`}>
          <svg class="dot" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3" fill="currentColor" /></svg>
          <svg class="cross" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg>
        </button>
      </div>
    {/each}
    <button
      class="raw-toggle"
      class:on={view.active?.raw}
      type="button"
      onclick={onToggleRaw}
      aria-label="Markdown source"
      aria-pressed={view.active?.raw ?? false}
      title={`Markdown source (${rawKey})`}
    >
      <!-- The markdown mark. -->
      <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
        <rect x="0.75" y="0.75" width="20.5" height="12.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M4 10V4l2.5 3L9 4v6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        <path d="M15 4v5.5m-2.5-2.5 2.5 2.75L17.5 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
    </button>
  </nav>
{/if}

{#if view.active?.banner}
  <div class="banner" role="alert">
    <span>{bannerText[view.active.banner]}</span>
    {#if view.active.banner === 'changed' || view.active.banner === 'conflict'}
      <button type="button" onclick={() => onKeepMine(view.active!.id)}>Keep mine</button>
      <button type="button" onclick={() => onLoad(view.active!.id)}>Load from disk</button>
    {/if}
    {#if view.active.banner === 'large'}
      <button type="button" onclick={onToggleRaw}>Show as Document</button>
    {/if}
  </div>
{/if}

{#if view.list.length === 0}
  {#if isMac}
    <div class="titlebar" data-tauri-drag-region>Marky</div>
  {/if}
  <div class="welcome">
    <div class="welcome-column">
      <div class="welcome-head">
        <svg class="app-icon" width="64" height="64" viewBox="100 100 824 824" aria-hidden="true">
          <rect x="100" y="100" width="824" height="824" rx="150" fill="#ffffff" />
          <rect x="262" y="300" width="300" height="64" rx="32" fill="#2a2b2f" />
          <rect x="342" y="420" width="220" height="64" rx="32" fill="#5e6ad2" />
          <rect x="342" y="540" width="170" height="64" rx="32" fill="#2a2b2f" />
          <rect x="262" y="660" width="250" height="64" rx="32" fill="#2a2b2f" />
        </svg>
        <div>
          <h1>Marky</h1>
          <p>Open a markdown file to start.</p>
        </div>
      </div>

      <div class="actions">
        <button class="primary" type="button" onclick={onOpen}>
          <span>Open file…</span>
          <span class="shortcut">{keyLabel('O')}</span>
        </button>
        <button type="button" onclick={onNew}>
          <span>New file</span>
          <span class="shortcut">{keyLabel('N')}</span>
        </button>
      </div>

      {#if view.recent.length > 0}
        <section class="recent" aria-labelledby="recent-title">
          <h2 id="recent-title">Recent</h2>
          <ul>
            {#each view.recent as file (file.path)}
              <li>
                <button type="button" onclick={() => onOpenRecent(file.path)} title={file.path}>
                  <span class="recent-file">
                    <span class="recent-name">{name(file.path)}</span>
                    <span class="recent-folder">{folderOf(file.path, home)}</span>
                  </span>
                  <span class="recent-when">{whenLabel(file.at)}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>
    <p class="drop-hint">Drop a markdown file anywhere in this window to open it.</p>
  </div>
{/if}

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 40px;
    padding: 0 8px;
    overflow-x: auto;
    background: var(--code-bg);
    font-size: 13px;
  }
  /* Room for the window buttons. In full screen macOS hides them (main.ts sets the class). */
  .tab-bar.mac {
    padding-left: 80px;
  }
  :global(.fullscreen) .tab-bar.mac {
    padding-left: 8px;
  }
  .titlebar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--code-bg);
    font-size: 13px;
    color: var(--text-muted);
    user-select: none;
    -webkit-user-select: none;
  }
  .tab {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    max-width: 220px;
    height: 28px;
    border-radius: 8px;
    color: var(--text-muted);
  }
  .tab:hover {
    background: color-mix(in srgb, var(--border) 60%, transparent);
  }
  .tab.active {
    background: var(--bg);
    color: var(--text);
    font-weight: 600;
    box-shadow: 0 0 0 1px var(--border);
  }
  .tab button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }
  .tab-name {
    padding: 0 6px 0 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-close {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    margin-right: 6px;
    border-radius: 4px;
  }
  .tab-close svg {
    width: 10px;
    height: 10px;
  }
  .tab-close:hover {
    background: var(--border);
  }
  /* The dot shows unsaved edits. On hover it becomes the close cross. */
  .tab-close .dot,
  .tab-close.dirty .cross {
    display: none;
  }
  .tab-close.dirty .dot {
    display: block;
  }
  .tab-close.dirty:hover .dot {
    display: none;
  }
  .tab-close.dirty:hover .cross {
    display: block;
  }
  /* At the right end of the tab bar. Sticky, so that it stays visible when the tabs scroll. */
  .raw-toggle {
    position: sticky;
    right: 0;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 36px;
    height: 28px;
    margin-left: auto;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: var(--code-bg);
    color: var(--text-muted);
    cursor: pointer;
  }
  .raw-toggle:hover {
    background: color-mix(in srgb, var(--border) 60%, var(--code-bg));
    color: var(--text);
  }
  .raw-toggle.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--border);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--code-bg);
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .banner span {
    flex: 1;
  }
  .banner button {
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 3px 10px;
    cursor: pointer;
  }

  .welcome {
    min-height: 100vh;
    box-sizing: border-box;
    padding-top: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .welcome-column {
    flex: 1;
    width: min(480px, 100% - 48px);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 36px;
  }
  .welcome-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    text-align: center;
  }
  .app-icon {
    border-radius: 12px;
    box-shadow: 0 1px 2px rgba(20, 22, 30, 0.08), 0 6px 16px rgba(20, 22, 30, 0.08);
  }
  .welcome h1 {
    margin: 0 0 4px;
    font-size: 22px;
    line-height: 1.3;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .welcome-head p {
    margin: 0;
    font-size: 14px;
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .actions button,
  .recent button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    height: 32px;
    padding: 0 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .actions button {
    font-size: 14px;
  }
  .actions button:hover,
  .recent button:hover {
    background: var(--code-bg);
  }
  /* The light accent in both modes: white text on it has 4.7:1 (docs/style.md). */
  .actions button.primary {
    background: #5e6ad2;
    color: #ffffff;
    font-weight: 600;
  }
  .actions button.primary:hover {
    background: #5360c8;
  }
  .actions button.primary:focus-visible {
    outline-offset: 2px;
  }
  .shortcut {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-muted);
  }
  .primary .shortcut {
    color: #ffffff;
  }
  .recent {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .recent h2 {
    margin: 0;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .recent ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .recent-file {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .recent-name {
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .recent-folder,
  .recent-when {
    font-size: 12px;
    color: var(--text-muted);
  }
  .recent-folder {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent-when {
    flex-shrink: 0;
  }
  .drop-hint {
    margin: 0;
    height: 48px;
    display: flex;
    align-items: center;
    font-size: 13px;
    color: var(--text-muted);
  }
</style>
