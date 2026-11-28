<script lang="ts">
  // The find bar, below the tab bar. Cmd/Ctrl+F opens it, Cmd+Option+F (macOS) or Ctrl+H (Linux)
  // opens it with the replace field. It searches the view of the active tab: the document
  // (src/editor/plugins/find.ts) or the source view (src/app/raw.ts).
  import { tick } from 'svelte'
  import type { Finder, Query } from '../editor/plugins/find'

  interface Props {
    // The view of the active tab, or null without tabs.
    finder: () => Finder | null
    onClose: () => void
  }

  let { finder, onClose }: Props = $props()

  let shown = $state(false)
  let replacing = $state(false)
  let text = $state('')
  let replacement = $state('')
  let caseSensitive = $state(false)
  let wholeWord = $state(false)
  let status = $state({ current: 0, total: 0 })
  let field: HTMLInputElement | undefined = $state()

  const query = (): Query => ({ text, caseSensitive, wholeWord })
  const label = $derived(
    !text
      ? ''
      : status.total === 0
        ? 'No results'
        : status.current
          ? `${status.current} of ${status.total}`
          : `${status.total} ${status.total === 1 ? 'match' : 'matches'}`,
  )

  export async function open(replace: boolean) {
    if (!finder()) return
    shown = true
    replacing = replace
    await tick()
    field?.focus()
    field?.select()
    refresh()
  }

  // The active tab or its view changed: search there. A closed bar removes the highlights.
  export function refresh() {
    const target = finder()
    if (!target) shown = false
    target?.search(shown ? query() : null)
    update()
  }

  // The matches or the selection changed.
  export function update() {
    status = finder()?.status() ?? { current: 0, total: 0 }
  }

  function search() {
    const target = finder()
    target?.search(query())
    target?.go(1, true)
    update()
  }

  function act(action: (target: Finder) => void) {
    const target = finder()
    if (target) action(target)
    update()
  }

  function close() {
    finder()?.search(null)
    shown = false
    onClose()
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Enter' && event.target === field) {
      event.preventDefault()
      act((target) => target.go(event.shiftKey ? -1 : 1))
    } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault()
      act((target) => target.replace(replacement))
    }
  }
</script>

{#if shown}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="find-bar" role="search" onkeydown={onKey}>
    <div class="row">
      <input bind:this={field} bind:value={text} oninput={search} placeholder="Find" aria-label="Find" spellcheck="false" />
      <span class="count" aria-live="polite">{label}</span>
      <button
        class="icon"
        class:on={caseSensitive}
        type="button"
        aria-pressed={caseSensitive}
        title="Match case"
        aria-label="Match case"
        onclick={() => ((caseSensitive = !caseSensitive), search())}>Aa</button
      >
      <button
        class="icon word"
        class:on={wholeWord}
        type="button"
        aria-pressed={wholeWord}
        title="Whole word"
        aria-label="Whole word"
        onclick={() => ((wholeWord = !wholeWord), search())}>ab</button
      >
      <button class="icon" type="button" title="Previous match (Shift+Enter)" aria-label="Previous match" onclick={() => act((t) => t.go(-1))}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5" /></svg>
      </button>
      <button class="icon" type="button" title="Next match (Enter)" aria-label="Next match" onclick={() => act((t) => t.go(1))}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
      </button>
      <button class="icon close" type="button" title="Close (Esc)" aria-label="Close" onclick={close}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6m0-6-6 6" /></svg>
      </button>
    </div>
    {#if replacing}
      <div class="row">
        <input bind:value={replacement} placeholder="Replace" aria-label="Replace" spellcheck="false" />
        <button class="text" type="button" onclick={() => act((t) => t.replace(replacement))}>Replace</button>
        <button class="text" type="button" onclick={() => act((t) => t.replaceAll(replacement))}>Replace All</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .find-bar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 16px;
    background: var(--code-bg);
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  input {
    width: 240px;
    height: 28px;
    box-sizing: border-box;
    margin-right: 4px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  input::placeholder {
    color: var(--text-muted);
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .count {
    min-width: 76px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  button {
    font: inherit;
    color: var(--text-muted);
    background: none;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    font-weight: 600;
  }
  .icon:hover {
    background: color-mix(in srgb, var(--border) 60%, transparent);
    color: var(--text);
  }
  .icon.on {
    background: var(--bg);
    color: var(--accent);
    box-shadow: 0 0 0 1px var(--border);
  }
  .word {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .icon svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .close {
    margin-left: auto;
  }
  .text {
    height: 28px;
    padding: 0 10px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .text:hover {
    border-color: var(--text-muted);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
</style>
