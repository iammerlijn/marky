<script lang="ts">
  // The window chrome: tab bar, the "changed on disk" bar and the empty state.
  // The logic is in tabs.ts. This component only shows it.
  import { onMount } from 'svelte'
  import { isMac } from './keys'
  import type { Tabs } from './tabs'

  interface Props {
    tabs: Tabs
    mod: string
    onOpen: () => void
    onNew: () => void
    onClose: (id: number) => void
    onKeepMine: (id: number) => void
    onLoad: (id: number) => void
  }

  let { tabs, mod, onOpen, onNew, onClose, onKeepMine, onLoad }: Props = $props()

  let changes = $state(0)
  onMount(() => tabs.subscribe(() => changes++))

  const name = (path: string | null) => (path === null ? 'Untitled' : path.split('/').pop())
  const view = $derived.by(() => {
    changes
    return {
      list: tabs.tabs.map((t) => ({ id: t.id, path: t.path, dirty: t.dirty, active: t === tabs.active })),
      active: tabs.active ? { id: tabs.active.id, banner: tabs.active.banner } : null,
    }
  })

  const bannerText = {
    changed: 'This file changed on disk.',
    conflict: 'This file changed on disk. Marky did not save.',
    deleted: 'This file was deleted or renamed on disk.',
    'raw-only': 'Marky cannot show this file as a document, so it shows the markdown source. A save writes the source exactly.',
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
          <span class="dot" aria-hidden="true">●</span>
          <span class="cross" aria-hidden="true">×</span>
        </button>
      </div>
    {/each}
  </nav>
{/if}

{#if view.active?.banner}
  <div class="banner" role="alert">
    <span>{bannerText[view.active.banner]}</span>
    {#if view.active.banner === 'changed' || view.active.banner === 'conflict'}
      <button type="button" onclick={() => onKeepMine(view.active!.id)}>Keep mine</button>
      <button type="button" onclick={() => onLoad(view.active!.id)}>Load from disk</button>
    {/if}
  </div>
{/if}

{#if view.list.length === 0}
  {#if isMac}
    <div class="titlebar" data-tauri-drag-region></div>
  {/if}
  <div class="empty">
    <div class="actions">
      <button type="button" onclick={onOpen}>Open a file <kbd>{mod}</kbd> <kbd>O</kbd></button>
      <button type="button" onclick={onNew}>New file <kbd>{mod}</kbd> <kbd>T</kbd></button>
    </div>
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
    padding: 0 2px 0 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The close cross shows on hover. The dot of unsaved edits always shows. */
  .tab-close {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    margin-right: 4px;
    border-radius: 4px;
    font-weight: 400;
    line-height: 1;
    visibility: hidden;
  }
  .tab:hover .tab-close,
  .tab-close.dirty,
  .tab-close:focus-visible {
    visibility: visible;
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
    display: inline;
    font-size: 9px;
  }
  .tab-close.dirty:hover .dot {
    display: none;
  }
  .tab-close.dirty:hover .cross {
    display: inline;
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
  .banner button,
  .empty button {
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 3px 10px;
    cursor: pointer;
  }

  .empty {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-muted);
  }
  .empty .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty .actions button {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 6px 12px;
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 6px;
  }
</style>
