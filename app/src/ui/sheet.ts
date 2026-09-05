const root = document.getElementById('sheet') as HTMLDivElement;
const title = document.getElementById('sheet-title') as HTMLHeadingElement;
const content = document.getElementById('sheet-content') as HTMLDivElement;

/** Runs when the current contents go away, so a sheet can drop subscriptions. */
let dispose: (() => void) | null = null;

root.querySelector('.sheet-backdrop')?.addEventListener('click', closeSheet);
document.getElementById('sheet-close')?.addEventListener('click', closeSheet);

export function openSheet(heading: string, body: Node, onClose?: () => void): void {
  dispose?.();
  dispose = onClose ?? null;
  title.textContent = heading;
  content.replaceChildren(body);
  content.scrollTop = 0;
  root.hidden = false;
}

export function closeSheet(): void {
  dispose?.();
  dispose = null;
  root.hidden = true;
  content.replaceChildren();
}

export function sheetIsOpen(): boolean {
  return !root.hidden;
}
