const STORAGE_KEY = `chatgpt-memo-markers:${location.pathname}`;
let isPanelCollapsed = true;
let activePanelItemId = null;

function savePanelCollapsedState() {
  // Keep panel open/closed state only for the current page lifetime.
}

/**
 * 指定した時間だけ処理を待機します。
 *
 * @param {number} ms - 待機する時間をミリ秒で指定します。
 * @returns {Promise<void>} 指定時間の経過後に解決される Promise を返します。
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function canUseChromeStorage() {
  return typeof chrome !== 'undefined' && chrome.storage?.local;
}

function isExtensionContextError(error) {
  return String(error?.message ?? error).includes('Extension context invalidated');
}

function loadItemsFromLocalStorage() {
  try {
    const storedItems = localStorage.getItem(STORAGE_KEY);
    return storedItems ? JSON.parse(storedItems) : [];
  } catch (error) {
    console.warn('ChatGPT Memo Marker: local fallback load failed', error);
    return [];
  }
}

function saveItemsToLocalStorage(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.warn('ChatGPT Memo Marker: local fallback save failed', error);
  }
}

/**
 * 現在の ChatGPT ページに紐づく保存済みメモ一覧を読み込みます。
 *
 * @returns {Promise<Array>} 保存済みメモの配列を返します。読み込みに失敗した場合は空配列を返します。
 */
async function loadItems() {
  try {
    if (!canUseChromeStorage()) {
      return loadItemsFromLocalStorage();
    }

    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] ?? [];
  } catch (error) {
    if (isExtensionContextError(error)) {
      return loadItemsFromLocalStorage();
    }

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
    if (!canUseChromeStorage()) {
      saveItemsToLocalStorage(items);
      return;
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: items });
  } catch (error) {
    if (isExtensionContextError(error)) {
      saveItemsToLocalStorage(items);
      return;
    }

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

function getControlLabel(control) {
  return [
    control.getAttribute('aria-label'),
    control.getAttribute('title'),
    control.textContent
  ].filter(Boolean).join(' ').trim();
}

function getDirectChild(container, descendant) {
  let current = descendant;

  while (current && current.parentElement !== container) {
    current = current.parentElement;
  }

  return current?.parentElement === container ? current : null;
}

function isVisibleElement(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function findHeaderActionsMount() {
  const controls = Array.from(document.querySelectorAll('button, a'))
    .filter(control => !control.closest('.cg-memo-header-host') && isVisibleElement(control));
  const shareControl = controls.find(control =>
    /\bShare\b|\u5171\u6709|\u30b7\u30a7\u30a2/.test(getControlLabel(control))
  );
  const fallbackControl = controls.find(control =>
    /\bShare\b|\u5171\u6709|\u30b7\u30a7\u30a2|PDF|\bMore\b|\u22ef|\u2026/.test(getControlLabel(control))
  );
  const anchorControl = shareControl ?? fallbackControl;

  if (!anchorControl) {
    return null;
  }

  let current = anchorControl.parentElement;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const directControls = Array.from(current.children)
      .filter(child => child.matches?.('button, a, div'));

    if (style.display.includes('flex') && style.flexDirection !== 'column' && directControls.length >= 2) {
      return {
        container: current,
        before: shareControl && current.contains(shareControl)
          ? getDirectChild(current, shareControl)
          : null
      };
    }

    current = current.parentElement;
  }

  return {
    container: anchorControl.parentElement,
    before: shareControl?.parentElement === anchorControl.parentElement ? shareControl : null
  };
}

function ensurePanelMount() {
  let host = document.querySelector('.cg-memo-header-host');
  const mount = findHeaderActionsMount();
  const target = mount?.container;

  if (!host) {
    host = document.createElement('div');
    host.className = 'cg-memo-header-host';
  }

  if (target && (host.parentElement !== target || (mount.before && host.nextSibling !== mount.before))) {
    target.insertBefore(host, mount.before);
    host.classList.remove('cg-memo-header-host--fallback');
  } else if (!target && host.parentElement !== document.body) {
    document.body.appendChild(host);
    host.classList.add('cg-memo-header-host--fallback');
  }

  return host;
}

function getMemoPanel() {
  let panel = document.querySelector('.cg-memo-panel');

  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'cg-memo-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ChatGPT Memo');
    document.body.appendChild(panel);
  }

  return panel;
}

function removeMemoPanel() {
  document.querySelector('.cg-memo-panel')?.remove();
}

function positionMemoPanel(host) {
  const panel = document.querySelector('.cg-memo-panel');
  const button = host.querySelector('.cg-memo-header-button');

  if (!panel || !button) {
    return;
  }

  const rect = button.getBoundingClientRect();
  const margin = 8;
  const panelWidth = Math.min(360, window.innerWidth - margin * 2);
  const top = Math.min(rect.bottom + margin, window.innerHeight - margin);
  const left = Math.min(
    Math.max(margin, rect.right - panelWidth),
    window.innerWidth - panelWidth - margin
  );

  panel.style.width = `${panelWidth}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.maxHeight = `${Math.max(160, window.innerHeight - top - margin)}px`;
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
  if (selectedId !== null) {
    activePanelItemId = selectedId;
  }

  const items = await loadItems();
  const selectedItem = activePanelItemId
    ? items.find(item => item.id === activePanelItemId)
    : null;

  if (activePanelItemId && !selectedItem) {
    activePanelItemId = null;
  }

  const host = ensurePanelMount();
  host.innerHTML = '';

  const triggerButton = document.createElement('button');
  triggerButton.type = 'button';
  triggerButton.className = 'cg-memo-header-button';
  triggerButton.textContent = `ChatGPT Memo (${items.length})`;
  triggerButton.setAttribute('aria-haspopup', 'dialog');
  triggerButton.setAttribute('aria-expanded', String(!isPanelCollapsed));

  triggerButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    isPanelCollapsed = !isPanelCollapsed;
    savePanelCollapsedState();
    await renderPanel();
  });

  host.appendChild(triggerButton);

  if (isPanelCollapsed) {
    removeMemoPanel();
    return;
  }

  const panel = getMemoPanel();
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'cg-memo-title';

  const titleText = document.createElement('span');
  titleText.textContent = `ChatGPT Memo (${items.length})`;
  header.appendChild(titleText);

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'cg-memo-toggle-button';
  toggleButton.textContent = '閉じる';
  toggleButton.setAttribute(
    'aria-label',
    'メモ一覧パネルを閉じる'
  );

  toggleButton.addEventListener('click', async () => {
    isPanelCollapsed = true;
    savePanelCollapsedState();
    await renderPanel();
  });

  header.appendChild(toggleButton);
  panel.appendChild(header);

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = '保存済みメモはありません';
    panel.appendChild(empty);
    positionMemoPanel(host);
    return;
  }

  items.forEach(item => {
    const title = document.createElement('div');
    title.className = 'cg-memo-item-title';
    title.textContent = `${item.title}`;

    title.addEventListener('click', async () => {
      if (activePanelItemId === item.id) {
        activePanelItemId = null;
      } else {
        activePanelItemId = item.id;
      }
      await renderPanel();
    });

    panel.appendChild(title);

    if (selectedItem && selectedItem.id === item.id) {
      panel.appendChild(createMemoDetail(selectedItem));
    }
  });

  positionMemoPanel(host);
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

  document.addEventListener('click', async (event) => {
    if (isPanelCollapsed) return;
    if (event.target.closest('.cg-memo-header-host')) return;
    if (event.target.closest('.cg-memo-panel')) return;

    isPanelCollapsed = true;
    savePanelCollapsedState();
    await renderPanel();
  });

  window.addEventListener('resize', () => {
    if (isPanelCollapsed) return;

    const host = document.querySelector('.cg-memo-header-host');
    if (host) {
      positionMemoPanel(host);
    }
  });

  const observer = new MutationObserver(async () => {
    await renderMarkerButtons();

    const host = document.querySelector('.cg-memo-header-host');
    if (!host || host.classList.contains('cg-memo-header-host--fallback')) {
      await renderPanel();
    } else if (!isPanelCollapsed) {
      positionMemoPanel(host);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

init();
