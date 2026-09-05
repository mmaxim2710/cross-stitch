-- Маски прогресса. Одна строка на схему: приложение на одного человека,
-- разделения по пользователям нет.
CREATE TABLE IF NOT EXISTS progress (
  pattern_id TEXT PRIMARY KEY,
  version    INTEGER NOT NULL,
  -- base64, а не BLOB: D1 отдаёт бинарь как массив чисел в JSON, что втрое
  -- дороже самой строки. Маска для 154×154 — 4 КБ текста.
  bits       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Схемы хранятся здесь, а не на Pages: Pages всегда публичен, схемы чужие.
CREATE TABLE IF NOT EXISTS patterns (
  id           TEXT PRIMARY KEY,
  name         TEXT    NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  stitch_count INTEGER NOT NULL,
  json         TEXT    NOT NULL,
  updated_at   INTEGER NOT NULL
);
