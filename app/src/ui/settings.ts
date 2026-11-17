import { buildBackup, downloadBackup, restoreBackup } from '../state/backup';
import { loadBoundaryStyle, saveBoundaryStyle } from '../state/appearance';
import { Api, loadSettings, saveSettings } from '../sync/api';
import { LABELS, type Sync } from '../sync/sync';
import { pickFile } from './files';
import { openSheet } from './sheet';

function field(label: string, value: string, placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  return input;
}

function labelled(text: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = text;
  wrap.append(caption, control);
  return wrap;
}

/**
 * Server address, token, sync state and the manual backup — everything that is
 * set once and then forgotten.
 */
export function openSettings(sync: Sync, onRestored: () => void, onAppearanceChanged: () => void): void {
  const box = document.createElement('div');
  box.className = 'settings';

  const appearance = document.createElement('div');
  appearance.className = 'sheet-actions';
  const appearanceHeading = document.createElement('h3');
  appearanceHeading.textContent = 'Вид холста';
  const boundaries = document.createElement('select');
  boundaries.setAttribute('aria-label', 'Границы секций');
  boundaries.append(
    new Option('Старые — тонкая сетка 10 × 10', 'classic'),
    new Option('Новые — жирные границы секций', 'sections'),
  );
  boundaries.value = loadBoundaryStyle();
  boundaries.onchange = () => {
    saveBoundaryStyle(boundaries.value === 'classic' ? 'classic' : 'sections');
    onAppearanceChanged();
  };
  appearance.append(appearanceHeading, labelled('Границы секций', boundaries));

  const status = document.createElement('p');
  status.className = 'status';
  const showStatus = (): void => {
    status.textContent = sync.message ? `${LABELS[sync.state]}: ${sync.message}` : LABELS[sync.state];
    status.dataset.state = sync.state;
  };
  const unsubscribe = sync.onChange(showStatus);
  showStatus();

  const current = loadSettings();
  const url = field('Адрес воркера', current?.url ?? '', 'https://cross-stitch.<логин>.workers.dev');
  const token = field('Токен', current?.token ?? '', 'токен из wrangler secret');

  const note = document.createElement('p');
  note.className = 'note';

  const save = document.createElement('button');
  save.textContent = 'Проверить и сохранить';
  save.onclick = async () => {
    const address = url.value.trim().replace(/\/+$/, '');
    const secret = token.value.trim();
    if (!address || !secret) {
      note.textContent = 'Нужны и адрес, и токен.';
      return;
    }
    save.disabled = true;
    note.textContent = 'Проверяем…';
    try {
      const api = new Api({ url: address, token: secret });
      // Health first: it needs no token, so a failure here means a wrong address
      // and the token is not to blame.
      await api.health();
      await api.listPatterns();
      saveSettings({ url: address, token: secret });
      sync.reconfigure();
      void sync.run();
      note.textContent = 'Готово, синхронизация включена.';
    } catch (err) {
      note.textContent = `Не вышло: ${err instanceof Error ? err.message : err}`;
    } finally {
      save.disabled = false;
    }
  };

  const forget = document.createElement('button');
  forget.textContent = 'Отключить синхронизацию';
  forget.onclick = () => {
    saveSettings(null);
    url.value = '';
    token.value = '';
    sync.reconfigure();
    note.textContent = 'Синхронизация выключена, прогресс остаётся на устройстве.';
  };

  const syncNow = document.createElement('button');
  syncNow.textContent = 'Синхронизировать сейчас';
  syncNow.onclick = () => void sync.run();

  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Сохранить бэкап в файл';
  exportBtn.onclick = async () => {
    try {
      downloadBackup(await buildBackup());
    } catch (err) {
      note.textContent = `Не удалось выгрузить: ${err instanceof Error ? err.message : err}`;
    }
  };

  const importBtn = document.createElement('button');
  importBtn.textContent = 'Восстановить из файла';
  importBtn.onclick = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    if (!confirm('Восстановление перезапишет схемы и прогресс на устройстве. Продолжить?')) return;
    try {
      const { patterns, progress } = await restoreBackup(file);
      note.textContent = `Восстановлено: схем ${patterns}, прогресса ${progress}.`;
      onRestored();
    } catch (err) {
      note.textContent = `Не удалось восстановить: ${err instanceof Error ? err.message : err}`;
    }
  };

  const server = document.createElement('div');
  server.className = 'sheet-actions';
  server.append(
    labelled('Адрес воркера', url),
    labelled('Токен', token),
    save,
    syncNow,
    forget,
    note,
  );

  const heading = document.createElement('h3');
  heading.textContent = 'Бэкап';
  const backup = document.createElement('div');
  backup.className = 'sheet-actions';
  backup.append(heading, exportBtn, importBtn);

  box.append(appearance, status, server, backup);
  openSheet('Настройки', box, unsubscribe);
}
