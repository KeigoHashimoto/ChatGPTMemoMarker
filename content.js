const STORAGE_KEY = `chatgpt-memo-markers:${location.pathname}`;

/**
 * 指定した時間だけ処理を待機します。
 *
 * @param {number} ms - 待機する時間をミリ秒で指定します。
 * @returns {Promise<void>} 指定時間の経過後に解決される Promise を返します。
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 現在の ChatGPT ページに紐づく保存済みメモ一覧を読み込みます。
 *
 * @returns {Promise<Array>} 保存済みメモの配列を返します。読み込みに失敗した場合は空配列を返します。
 */
async function loadItems() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] ?? [];
  } catch (error) {
    console.warn('ChatGPT Memo Marker: load failed', error);
    return [];
  }
}

/**
 * 現在の ChatGPT ページに紐づくメモ一覧をローカルストレージへ保存します。
 *
 * @param {Array} items - 保存するメモ項目の配列です。
 * @returns {Promise<void>} 保存処理の完了後に解決される Promise を返します。
 */
async function saveItems(items) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: items });
  } catch (error) {
    console.warn('ChatGPT Memo Marker: save failed', error);
  }
}

/**
 * ChatGPT の会話メッセージ要素をページ内から取得します。
 *
 * @returns {Element[]} data-message-author-role 属性を持つメッセージ要素の配列を返します。
 */
function getMessageElements() {
  return Array.from(document.querySelectorAll('[data-message-author-role]'));
}

/**
 * メッセージ要素から投稿者ロールを取得します。
 *
 * @param {Element} el - ロールを取得するメッセージ要素です。
 * @returns {string} メッセージの投稿者ロールを返します。取得できない場合は unknown を返します。
 */
function getMessageRole(el) {
  return el.getAttribute('data-message-author-role') ?? 'unknown';
}

/**
 * メッセージが省略表示されている場合に展開ボタンをクリックします。
 *
 * @param {Element} el - 展開対象のメッセージ要素です。
 * @returns {Promise<void>} 展開操作と待機が完了した後に解決される Promise を返します。
 */
async function expandMessageIfNeeded(el) {
  const buttons = Array.from(el.querySelectorAll('button'));

  const expandButton = buttons.find(button => {
    const text = button.innerText.trim();
    return text === '表示を増やす' || text === 'Show more';
  });

  if (expandButton) {
    expandButton.click();
    await sleep(300);
  }
}

/**
 * メッセージ要素の本文を取得し、保存用に整形します。
 *
 * @param {Element} el - 本文を取得するメッセージ要素です。
 * @returns {Promise<string>} 展開済みかつ正規化済みのメッセージ本文を返します。
 */
async function getMessageText(el) {
  await expandMessageIfNeeded(el);
  return normalizeContent(el.innerText);
}

/**
 * UI 表示用の不要な文言や余分な改行を除去して本文を正規化します。
 *
 * @param {string} text - 正規化する文字列です。
 * @returns {string} 不要文言と余分な空白を整理した文字列を返します。
 */
function normalizeContent(text) {
  return text
    .replace(/^\s*(?:\+|✓|笨・)\s*MEMO\s*$/gm, '')
    .replace(/表示を増やす/g, '')
    .replace(/Show more/g, '')
    .trim()
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * 保存するメモの一覧表示用タイトルを本文から生成します。
 *
 * @param {string} text - タイトル生成元の本文です。
 * @returns {string} 先頭 40 文字までのタイトルを返します。本文が空の場合は既定タイトルを返します。
 */
function createTitle(text) {
  return text.replace(/\s+/g, ' ').slice(0, 40) || '無題メモ';
}

/**
 * メモ項目を一意に識別する ID を生成します。
 *
 * @returns {string} ランダム UUID 形式の ID を返します。
 */
function createId() {
  return crypto.randomUUID();
}

/**
 * メモ保存ボタンの表示、説明、操作可否を保存状態に合わせて更新します。
 *
 * @param {HTMLButtonElement} button - 状態を更新するメモ保存ボタンです。
 * @param {boolean} isMarked - メッセージが保存済みかどうかを示します。
 * @returns {void} 戻り値はありません。
 */
function setMarkerButtonState(button, isMarked) {
  button.textContent = isMarked ? '✓ MEMO' : '+ MEMO';
  button.title = isMarked ? '保存済みメモ' : 'このメッセージをメモに保存';
  button.setAttribute(
    'aria-label',
    isMarked ? '保存済みメモ' : 'このメッセージをメモに保存'
  );
  button.classList.toggle('marked', isMarked);
  button.disabled = isMarked;
}

/**
 * 保存済みメモの状態に合わせて、各メッセージの星ボタン表示を更新します。
 *
 * @param {Array} items - 保存済みメモ項目の配列です。
 * @returns {void} 戻り値はありません。
 */
function updateStarButtons(items) {
  const savedContentSet = new Set(
    items.map(item => normalizeContent(item.content))
  );

  document.querySelectorAll('.cg-marker-button').forEach(button => {
    const messageEl = button.closest('[data-message-author-role]');
    if (!messageEl) return;

    const content = normalizeContent(messageEl.innerText);
    const isMarked = savedContentSet.has(content);

    setMarkerButtonState(button, isMarked);
  });
}

/**
 * ChatGPT の各メッセージに保存用の星ボタンを描画します。
 *
 * @returns {Promise<void>} ボタン描画とイベント登録が完了した後に解決される Promise を返します。
 */
async function renderMarkerButtons() {
  const elements = getMessageElements();

  if (elements.length === 0) {
    return;
  }

  const items = await loadItems();
  const savedContentSet = new Set(
    items.map(item => normalizeContent(item.content))
  );

  elements.forEach((el) => {
    if (el.dataset.cgMemoInitialized === '1') return;

    el.dataset.cgMemoInitialized = '1';

    const content = normalizeContent(el.innerText);
    const isSaved = savedContentSet.has(content);
    const role = getMessageRole(el);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
      'cg-marker-button',
      role === 'assistant' ? 'cg-marker-button--assistant' : '',
      isSaved ? 'marked' : ''
    ].filter(Boolean).join(' ');
    setMarkerButtonState(button, isSaved);

    button.addEventListener('click', async (event) => {
      event.stopPropagation();

      if (button.disabled) return;

      const latestContent = await getMessageText(el);
      const normalizedLatestContent = normalizeContent(latestContent);

      const current = await loadItems();

      const exists = current.some(item =>
        normalizeContent(item.content) === normalizedLatestContent
      );

      if (exists) {
        setMarkerButtonState(button, true);
        return;
      }

      const next = [
        ...current,
        {
          id: createId(),
          title: createTitle(latestContent),
          role: getMessageRole(el),
          content: latestContent,
          memo: '',
          url: location.href,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      await saveItems(next);

      setMarkerButtonState(button, true);

      await renderPanel();
    });

    el.prepend(button);
  });
}

/**
 * 保存済みメモを表示・編集するサイドパネルを描画します。
 *
 * @param {?string} selectedId - 詳細表示するメモ ID です。未指定の場合は一覧のみを表示します。
 * @returns {Promise<void>} パネル描画とイベント登録が完了した後に解決される Promise を返します。
 */
async function renderPanel(selectedId = null) {
  let panel = document.querySelector('.cg-memo-panel');

  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'cg-memo-panel';
    document.body.appendChild(panel);
  }

  const items = await loadItems();
  const selectedItem = selectedId
    ? items.find(item => item.id === selectedId)
    : null;

  panel.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'cg-memo-title';
  header.textContent = `ChatGPT Memo (${items.length})`;
  panel.appendChild(header);

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = '保存済みメモはありません';
    panel.appendChild(empty);
    return;
  }

  items.forEach(item => {
    const title = document.createElement('div');
    title.className = 'cg-memo-item-title';
    title.textContent = `${item.title}`;

    title.addEventListener('click', async () => {
      if (selectedItem && selectedItem.id === item.id) {
        await renderPanel();
      } else {
        await renderPanel(item.id);
      }
    });

    panel.appendChild(title);

    if (selectedItem && selectedItem.id === item.id) {
      panel.appendChild(createMemoDetail(selectedItem));
    }
  });
}

function createMemoDetail(selectedItem) {
  const detail = document.createElement('div');
  detail.className = 'cg-memo-detail';

  const content = document.createElement('div');
  content.className = 'cg-saved-content';
  content.textContent = selectedItem.content;

  const memo = document.createElement('textarea');
  memo.className = 'cg-user-memo';
  memo.placeholder = '自分用メモを入力';
  memo.value = selectedItem.memo ?? '';

  memo.addEventListener('input', async () => {
    const current = await loadItems();

    const next = current.map(item => {
      if (item.id !== selectedItem.id) return item;

      return {
        ...item,
        memo: memo.value,
        updatedAt: new Date().toISOString()
      };
    });

    await saveItems(next);
  });

  const copyButton = document.createElement('button');
  copyButton.className = 'cg-copy-button';
  copyButton.textContent = '内容をコピー';

  copyButton.addEventListener('click', async () => {
    const latestItems = await loadItems();
    const latestItem = latestItems.find(item => item.id === selectedItem.id) ?? selectedItem;

    const copyText = [
      '--- 保存したチャット内容 ---',
      '',
      latestItem.content,
      '',
      '--- 自分メモ ---',
      '',
      latestItem.memo || ''
    ].join('\n');

    await navigator.clipboard.writeText(copyText);

    copyButton.textContent = 'コピーしました';
    setTimeout(() => {
      copyButton.textContent = '内容をコピー';
    }, 1200);
  });

  const deleteButton = document.createElement('button');
  deleteButton.className = 'cg-delete-button';
  deleteButton.textContent = 'このメモを削除';

  deleteButton.addEventListener('click', async () => {
    const ok = confirm('このメモを削除しますか？');
    if (!ok) return;

    const current = await loadItems();
    const next = current.filter(item => item.id !== selectedItem.id);

    await saveItems(next);
    updateStarButtons(next);
    await renderPanel();
  });

  detail.appendChild(content);
  detail.appendChild(memo);
  detail.appendChild(copyButton);
  detail.appendChild(deleteButton);
  return detail;
}

/**
 * 拡張機能の初期処理を実行し、パネルと星ボタンの描画および DOM 監視を開始します。
 *
 * @returns {Promise<void>} 初期描画と監視開始が完了した後に解決される Promise を返します。
 */
async function init() {
  await sleep(1000);

  await renderPanel();
  await renderMarkerButtons();

  const observer = new MutationObserver(async () => {
    await renderMarkerButtons();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

init();
