const root = document.getElementById('sheet') as HTMLDivElement;
const title = document.getElementById('sheet-title') as HTMLHeadingElement;
const content = document.getElementById('sheet-content') as HTMLDivElement;

root.querySelector('.sheet-backdrop')?.addEventListener('click', closeSheet);
document.getElementById('sheet-close')?.addEventListener('click', closeSheet);

export function openSheet(heading: string, body: Node): void {
  title.textContent = heading;
  content.replaceChildren(body);
  content.scrollTop = 0;
  root.hidden = false;
}

export function closeSheet(): void {
  root.hidden = true;
  content.replaceChildren();
}

export function sheetIsOpen(): boolean {
  return !root.hidden;
}
