/** Opens the system file picker; resolves to null if the user backs out. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // iOS fires no event when the sheet is dismissed, so a cancelled pick simply
    // leaves the promise pending — harmless, the element is thrown away with it.
    input.click();
  });
}
