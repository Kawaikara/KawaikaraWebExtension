/** Provider selectors locate containers only; they never authorize edits to page data. */
export function isProviderInsertionTarget(node: Element | null): node is HTMLElement {
  if (!(node instanceof HTMLElement) || !node.isConnected) return false;
  if (node === document.documentElement || node === document.body) return false;
  if (
    node.isContentEditable ||
    node.closest(
      '[contenteditable]:not([contenteditable="false"]), input, textarea, select, option, button, a, script, style, head, template, iframe, object, embed',
    )
  )
    return false;
  return true;
}

/** Close only the activated, small menu container, never a player or page ancestor.
 * Returns cleanup which restores only our own temporary display override. */
export function closeProviderMenu(
  menu: HTMLElement,
  item: HTMLElement,
  selector?: string,
): (() => void) | undefined {
  if (!menu.isConnected || !item.isConnected || !menu.contains(item)) return;
  let candidate: Element | null;
  try {
    candidate = selector ? menu.closest(selector) : menu;
  } catch {
    return;
  }
  if (!isProviderInsertionTarget(candidate) || !candidate.contains(item)) return;
  let ancestor: Element | null = menu;
  for (let depth = 0; ancestor && ancestor !== candidate && depth < 2; depth++)
    ancestor = ancestor.parentElement;
  if (
    ancestor !== candidate ||
    candidate.matches('main, article, section, form, nav, header, footer') ||
    candidate.querySelector(
      'video, audio, input, textarea, select, iframe, [contenteditable="true"]',
    )
  )
    return;
  const bounds = candidate.getBoundingClientRect();
  // Geometry is a further guard, not permission to hide arbitrary page regions.
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.width > 600 ||
    bounds.height > 700 ||
    bounds.width * bounds.height > window.innerWidth * window.innerHeight * 0.6
  )
    return;
  const previous = candidate.style.getPropertyValue('display');
  const priority = candidate.style.getPropertyPriority('display');
  candidate.style.setProperty('display', 'none', 'important');
  const events = ['pointerdown', 'contextmenu', 'keydown'] as const;
  const restore = () => {
    for (const type of events) document.removeEventListener(type, nextInteraction, true);
    if (
      candidate instanceof HTMLElement &&
      candidate.style.getPropertyValue('display') === 'none' &&
      candidate.style.getPropertyPriority('display') === 'important'
    ) {
      if (previous) candidate.style.setProperty('display', previous, priority);
      else candidate.style.removeProperty('display');
    }
  };
  const nextInteraction = (event: Event) => {
    if (event.isTrusted) restore();
  };
  for (const type of events) document.addEventListener(type, nextInteraction, true);
  return restore;
}
