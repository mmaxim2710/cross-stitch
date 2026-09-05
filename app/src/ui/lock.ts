const CODE = '7942';
const KEY = 'cross-stitch:unlocked';
const WRONG_MS = 500;

const root = document.getElementById('lock') as HTMLDivElement;
const title = document.getElementById('lock-title') as HTMLParagraphElement;
const dots = document.getElementById('lock-dots') as HTMLDivElement;
const keys = document.getElementById('lock-keys') as HTMLDivElement;

/**
 * A keypad in front of the app. The page itself is public — GitHub Pages always
 * is — and the code sits in the bundle, so this keeps out a stranger who stumbles
 * on the address, nothing more. The unlock is remembered per device; storing the
 * code itself means changing it here locks every device again.
 */
export function unlock(): Promise<void> {
  if (localStorage.getItem(KEY) === CODE) return Promise.resolve();

  return new Promise((resolve) => {
    let entered = '';
    let wrongAt = 0;

    const paint = (): void => {
      const marks = [...dots.children];
      marks.forEach((dot, i) => dot.classList.toggle('on', i < entered.length));
    };

    const reject = (): void => {
      entered = '';
      wrongAt = performance.now();
      root.classList.add('wrong');
      title.textContent = 'Неверный код';
      paint();
      setTimeout(() => root.classList.remove('wrong'), WRONG_MS);
    };

    const press = (key: string): void => {
      // The shake doubles as a pause: keys pressed during it are ignored.
      if (performance.now() - wrongAt < WRONG_MS) return;
      if (key === 'back') {
        entered = entered.slice(0, -1);
        paint();
        return;
      }
      if (entered.length >= CODE.length) return;
      entered += key;
      paint();
      if (entered.length < CODE.length) return;
      if (entered !== CODE) return reject();

      localStorage.setItem(KEY, CODE);
      document.removeEventListener('keydown', onKey);
      root.hidden = true;
      resolve();
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') press('back');
    };

    keys.addEventListener('click', (e) => {
      const key = (e.target as HTMLElement).closest('button')?.dataset.key;
      if (key) press(key);
    });
    document.addEventListener('keydown', onKey);

    paint();
    root.hidden = false;
  });
}
