(() => {
  const SELECTORS = [
    'div[data-test-selector="job-step"]',
    'details[data-test-selector="job-step"]',
    'div[data-testid="logs-step"]',
    'div[id^="job-step-"]',
    'details[id^="job-step-"]',
    'div[id^="check-step-"]',
    'details[id^="check-step-"]',
    '.CheckStep.details-reset',
    '.js-checks-log-details'
  ];

  const paneRegistry = new Map();
  const buttonToPane = new WeakMap();

  let scanTimer = null;
  let rootObserver = null;
  let historyInstrumented = false;

  const SCROLL_STICKY_MARGIN = 24;
  const SCROLL_TARGET_RATIO = 0.99;
  const MIN_SCROLL_DELTA = 48;
  const MIN_LOG_LINES = 50;

  function init() {
    if (document.body == null) {
      return;
    }

    instrumentHistory();
    observeRoot();
    scheduleScan();
    window.addEventListener('resize', updateAllButtonVisibility, {
      passive: true
    });
  }

  function instrumentHistory() {
    if (historyInstrumented) {
      return;
    }

    historyInstrumented = true;

    const fire = () => {
      window.dispatchEvent(new Event('github-actions-scroll-helper:navigation'));
    };

    const wrap = (method) => {
      return function wrappedHistoryMethod(...args) {
        const result = method.apply(this, args);
        fire();
        return result;
      };
    };

    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener('popstate', fire, { passive: true });
    window.addEventListener('github-actions-scroll-helper:navigation', () => {
      scheduleScan();
      updateAllButtonVisibility();
    });
  }

  function observeRoot() {
    if (rootObserver != null) {
      return;
    }

    rootObserver = new MutationObserver((mutations) => {
      let shouldScan = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          if (mutation.addedNodes.length > 0) {
            shouldScan = true;
          }
          if (mutation.removedNodes.length > 0) {
            removeStalePanes(Array.from(mutation.removedNodes));
          }
        }

        if (shouldScan) {
          scheduleScan();
        }
      }
    });

    rootObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    window.addEventListener('focus', scheduleScan, { passive: true });
  }

  function scheduleScan() {
    if (scanTimer != null) {
      return;
    }

    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanForPanes();
    }, 150);
  }

  function scanForPanes() {
    const candidates = collectCandidates();
    for (const pane of candidates) {
      if (!paneRegistry.has(pane)) {
        registerPane(pane);
      } else {
        ensureScrollableBinding(pane);
      }
    }
  }

  function collectCandidates() {
    const nodes = new Set();
    for (const selector of SELECTORS) {
      const found = document.querySelectorAll(selector);
      for (const item of found) {
        if (item instanceof HTMLElement) {
          nodes.add(item);
        }
      }
    }
    return Array.from(nodes).filter((node) => {
      // Many elements in the Actions UI reuse the selectors above.
      // Prefer containers that expose log bodies.
      if (node.dataset.gptScrollPane === 'ready') {
        return true;
      }
      if (
        node.querySelector('[data-test-selector="log-step-body"]') ||
        node.querySelector('.js-log-details-container') ||
        node.querySelector('.log-stream')
      ) {
        return true;
      }
      if (node.tagName === 'DETAILS') {
        return true;
      }
      return node.querySelector('summary') != null;
    });
  }

  function registerPane(pane) {
    const summary = pane.querySelector('summary') || pane;
    const container = summary instanceof HTMLElement ? summary : pane;

    if (!(container instanceof HTMLElement)) {
      return;
    }

    const wasStatic = window.getComputedStyle(container).position === 'static';
    if (wasStatic) {
      container.classList.add('github-actions-scroll-helper-anchor');
    }

    const button = createButton();
    container.appendChild(button);
    pane.dataset.gptScrollPane = 'ready';
    paneRegistry.set(pane, {
      pane,
      button,
      container,
      wasStatic,
      autoStick: false,
      resizeObserver: null,
      scrollElement: null,
      scrollListener: null,
      scrollEventTarget: null,
      mutationObserver: null,
      fallbackTarget: null,
      contentObserver: null
    });
    buttonToPane.set(button, pane);

    ensureScrollableBinding(pane);
    const initialRecord = paneRegistry.get(pane);
    updateButtonVisibility(initialRecord);

    if (pane.tagName === 'DETAILS') {
      pane.addEventListener(
        'toggle',
        () => {
          ensureScrollableBinding(pane, true);
          const record = paneRegistry.get(pane);
          updateButtonVisibility(record);
        },
        { passive: true }
      );
    }

    const mutationObserver = new MutationObserver(() => {
      ensureScrollableBinding(pane);
      const currentRecord = paneRegistry.get(pane);
      updateButtonVisibility(currentRecord);
      if (currentRecord && currentRecord.autoStick) {
        scrollToBottom(currentRecord);
      }
    });
    mutationObserver.observe(pane, { childList: true, subtree: true });
    paneRegistry.get(pane).mutationObserver = mutationObserver;
  }

  function ensureScrollableBinding(pane, forceScroll) {
    const record = paneRegistry.get(pane);
    if (!record) {
      return;
    }

    const existing = record.scrollElement;
    if (!existing || !document.body.contains(existing)) {
      const scrollTarget = findScrollableElement(pane);
      if (scrollTarget) {
        bindScroll(record, pane, scrollTarget);
      }
    } else {
      // Re-evaluate fallback target in case DOM changed.
      record.fallbackTarget = findFallbackTarget(pane);
      observeContentSize(record, pane);
    }

    updateButtonVisibility(record);

    const isOpen = pane.tagName !== 'DETAILS' || pane.open;
    if (forceScroll === true && isOpen) {
      scrollToBottom(record);
    }
  }

  function bindScroll(record, pane, scrollElement) {
    const previousTarget = record.scrollEventTarget;
    if (previousTarget && record.scrollListener) {
      previousTarget.removeEventListener('scroll', record.scrollListener);
    }
    if (record.resizeObserver) {
      record.resizeObserver.disconnect();
      record.resizeObserver = null;
    }

    record.scrollElement = scrollElement;
    record.fallbackTarget = findFallbackTarget(pane);
    observeContentSize(record, pane);

    const isDocument = scrollElement === document.scrollingElement;
    const eventTarget = isDocument ? window : scrollElement;

    const onScroll = () => {
      if (!record.autoStick) {
        return;
      }

      if (!isNearBottom(scrollElement)) {
        record.autoStick = false;
        updateButtonState(record.button, record.autoStick);
      }
    };

    eventTarget.addEventListener('scroll', onScroll, { passive: true });
    record.scrollListener = onScroll;
    record.scrollEventTarget = eventTarget;

    if (!isDocument) {
      const resizeObserver = new ResizeObserver(() => {
        if (record.autoStick) {
          scrollToBottom(record);
        }
        updateButtonVisibility(record);
      });
      resizeObserver.observe(scrollElement);
      record.resizeObserver = resizeObserver;
    }

    updateButtonVisibility(record);
  }

  function findScrollableElement(root) {
    if (!(root instanceof HTMLElement)) {
      return null;
    }

    const queue = [root];
    const visited = new Set();

    while (queue.length > 0) {
      const node = queue.shift();
      if (!(node instanceof HTMLElement) || visited.has(node)) {
        continue;
      }
      visited.add(node);

      const style = window.getComputedStyle(node);
      const isScrollable =
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        node.scrollHeight - node.clientHeight > 16;

      if (isScrollable) {
        return node;
      }

      for (const child of node.children) {
        queue.push(child);
      }
    }

    const docElement = document.scrollingElement;
    if (
      docElement instanceof HTMLElement &&
      root.querySelector(
        '[data-test-selector="log-step-body"], .js-log-details-container, .log-stream, .js-checks-log-display-container'
      )
    ) {
      return docElement;
    }

    return null;
  }

  function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'github-actions-scroll-helper-button';
    button.textContent = '⏬';
    button.setAttribute('aria-label', 'Scroll to bottom');
    button.title = 'Scroll to bottom';

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const pane = buttonToPane.get(button);
      if (!pane) {
        return;
      }
      onButtonClick(pane);
    });

    return button;
  }

  function onButtonClick(pane) {
    const record = paneRegistry.get(pane);
    if (!record) {
      return;
    }

    ensureScrollableBinding(pane, true);

    const toggled = !record.autoStick;
    record.autoStick = toggled;
    updateButtonState(record.button, toggled);

    if (toggled) {
      scrollToBottom(record);
    }
  }

  function updateButtonState(button, isActive) {
    if (isActive) {
      button.classList.add('is-active');
      button.setAttribute('aria-pressed', 'true');
    } else {
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
    }
  }

  function scrollToBottom(record) {
    if (!record) {
      return;
    }

    const element = record.scrollElement;

    if (element instanceof HTMLElement) {
      if (element === document.scrollingElement) {
        if (!scrollViaFallback(record)) {
          element.scroll({
            top: element.scrollHeight,
            behavior: 'smooth'
          });
        }
        return;
      }

      element.scroll({
        top: element.scrollHeight,
        behavior: 'smooth'
      });
      return;
    }

    scrollViaFallback(record);
  }

  function scrollViaFallback(record) {
    const target = ensureFallbackTarget(record);
    if (target instanceof HTMLElement) {
      const scrollable = findScrollableAncestor(target);
      if (scrollable && scrollable !== document.scrollingElement) {
        const maxScroll =
          scrollable.scrollHeight - scrollable.clientHeight;
        const goal =
          maxScroll > 0 ? Math.max(0, maxScroll * SCROLL_TARGET_RATIO) : 0;
        scrollable.scroll({
          top: goal,
          behavior: 'auto'
        });
        return true;
      }

      const docElement = document.scrollingElement;
      if (docElement) {
        const maxScroll = docElement.scrollHeight - window.innerHeight;
        const goal =
          maxScroll > 0 ? Math.max(0, maxScroll * SCROLL_TARGET_RATIO) : 0;
        window.scrollTo({
          top: goal,
          behavior: 'auto'
        });
        return true;
      }

      const rect = target.getBoundingClientRect();
      const offset =
        rect.bottom + window.scrollY - window.innerHeight + SCROLL_STICKY_MARGIN;
      const top = Math.max(0, offset);
      window.scrollTo({
        top,
        behavior: 'auto'
      });
      return true;
    }
    if (document.scrollingElement) {
      document.scrollingElement.scroll({
        top: document.scrollingElement.scrollHeight,
        behavior: 'smooth'
      });
      return true;
    }
    return false;
  }

  function ensureFallbackTarget(record) {
    if (!record) {
      return null;
    }
    if (record.fallbackTarget && document.body.contains(record.fallbackTarget)) {
      return record.fallbackTarget;
    }
    const pane = record.pane;
    const fallback = pane ? findFallbackTarget(pane) : null;
    record.fallbackTarget = fallback;
    return fallback;
  }

  function findFallbackTarget(pane) {
    if (!(pane instanceof HTMLElement)) {
      return null;
    }

    const selectors = [
      '.js-checks-log-display-container',
      '.js-log-details-container',
      '.log-stream',
      '[data-test-selector="log-step-body"]',
      'pre'
    ];

    for (const selector of selectors) {
      const container = pane.querySelector(selector);
      if (!(container instanceof HTMLElement)) {
        continue;
      }
      const anchor = findLastLogAnchor(container);
      if (anchor) {
        return anchor;
      }
      const last = deepestVisibleChild(container);
      if (last) {
        return last;
      }
      return container;
    }

    const fallbackAnchor = findLastLogAnchor(pane);
    if (fallbackAnchor) {
      return fallbackAnchor;
    }

    return deepestVisibleChild(pane) || pane;
  }

  function findLastLogAnchor(root) {
    if (!(root instanceof HTMLElement)) {
      return null;
    }
    const anchors = root.querySelectorAll('a[href*="#step:"]');
    if (anchors.length === 0) {
      return null;
    }
    return anchors[anchors.length - 1];
  }

  function findScrollableAncestor(element) {
    let current = element.parentElement;
    while (current instanceof HTMLElement) {
      const style = window.getComputedStyle(current);
      const isScrollable =
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        current.scrollHeight - current.clientHeight > 16;
      if (isScrollable) {
        return current;
      }
      current = current.parentElement;
    }
    return document.scrollingElement instanceof HTMLElement
      ? document.scrollingElement
      : null;
  }

  function findLogContainer(record) {
    if (!record || !record.pane) {
      return null;
    }
    return record.pane.querySelector(
      '.js-checks-log-display-container, .js-log-details-container, .log-stream, [data-test-selector="log-step-body"], pre'
    );
  }

  function countLogLines(record) {
    const container = findLogContainer(record);
    if (!(container instanceof HTMLElement)) {
      return 0;
    }

    const anchors = container.querySelectorAll('a[href*="#step:"]');
    if (anchors.length > 0) {
      return anchors.length;
    }

    const blockElements = container.querySelectorAll('div, span, p, li');
    if (blockElements.length > 0) {
      return blockElements.length;
    }

    const text = container.textContent || '';
    if (!text.trim()) {
      return 0;
    }

    return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  }

  function measureScrollableExtent(record) {
    if (!record) {
      return 0;
    }

    const element = record.scrollElement;
    if (
      element instanceof HTMLElement &&
      element !== document.scrollingElement
    ) {
      return element.scrollHeight - element.clientHeight;
    }

    const fallbackTarget = ensureFallbackTarget(record);
    if (fallbackTarget instanceof HTMLElement) {
      const ancestor = findScrollableAncestor(fallbackTarget);
      if (
        ancestor instanceof HTMLElement &&
        ancestor !== document.scrollingElement
      ) {
        return ancestor.scrollHeight - ancestor.clientHeight;
      }
    }

    const docElement = document.scrollingElement;
    if (docElement) {
      return docElement.scrollHeight - window.innerHeight;
    }

    return 0;
  }

  function updateButtonVisibility(record) {
    if (!record || !record.button) {
      return;
    }

    const pane = record.pane;
    const isDetailsPane =
      pane instanceof HTMLElement && pane.tagName === 'DETAILS';
    const isOpen = !isDetailsPane || (pane && pane.open);
    const extent = isOpen ? measureScrollableExtent(record) : 0;
    const lines = isOpen ? countLogLines(record) : 0;
    const shouldShow =
      isOpen && extent > MIN_SCROLL_DELTA && lines >= MIN_LOG_LINES;

    if (shouldShow) {
      record.button.style.display = '';
      record.button.disabled = false;
    } else {
      record.button.style.display = 'none';
      record.button.disabled = true;
      if (record.autoStick) {
        record.autoStick = false;
        updateButtonState(record.button, false);
      }
    }
  }

  function updateAllButtonVisibility() {
    paneRegistry.forEach((record) => updateButtonVisibility(record));
  }

  function observeContentSize(record, pane) {
    if (record.contentObserver) {
      record.contentObserver.disconnect();
      record.contentObserver = null;
    }

    const container = findLogContainer(record);

    if (!(container instanceof HTMLElement)) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (record.autoStick) {
        scrollToBottom(record);
      }
      updateButtonVisibility(record);
    });
    observer.observe(container);
    record.contentObserver = observer;
    updateButtonVisibility(record);
  }

  function deepestVisibleChild(root) {
    if (!(root instanceof HTMLElement)) {
      return null;
    }

    let current = root;
    while (current && current.lastElementChild instanceof HTMLElement) {
      current = current.lastElementChild;
    }
    return current instanceof HTMLElement ? current : null;
  }

  function isNearBottom(element) {
    if (!(element instanceof HTMLElement)) {
      return true;
    }

    if (element === document.scrollingElement) {
      const totalHeight = element.scrollHeight;
      const viewportBottom = window.scrollY + window.innerHeight;
      return totalHeight - viewportBottom <= SCROLL_STICKY_MARGIN;
    }

    const distance =
      element.scrollHeight - element.clientHeight - element.scrollTop;
    return distance <= SCROLL_STICKY_MARGIN;
  }

  function removeStalePanes(nodes) {
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      for (const pane of paneRegistry.keys()) {
        if (pane === node || pane.contains(node)) {
          cleanupPane(pane);
        }
      }
    }
  }

  function cleanupPane(pane) {
    const record = paneRegistry.get(pane);
    if (!record) {
      return;
    }

    if (record.resizeObserver) {
      record.resizeObserver.disconnect();
    }
    if (record.scrollEventTarget && record.scrollListener) {
      record.scrollEventTarget.removeEventListener(
        'scroll',
        record.scrollListener
      );
    }
    record.scrollEventTarget = null;
    record.scrollListener = null;
    record.scrollElement = null;
    if (record.contentObserver) {
      record.contentObserver.disconnect();
      record.contentObserver = null;
    }
    if (record.button && record.button.parentElement) {
      record.button.parentElement.removeChild(record.button);
    }
    if (record.wasStatic && record.container) {
      record.container.classList.remove('github-actions-scroll-helper-anchor');
    }
    if (record.mutationObserver) {
      record.mutationObserver.disconnect();
    }

    pane.removeAttribute('data-gpt-scroll-pane');
    paneRegistry.delete(pane);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

