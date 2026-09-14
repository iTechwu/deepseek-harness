const FOCUSABLE_SELECTOR = 'button,a[href],input,select,textarea,[contenteditable="true"],[tabindex]'
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]'

/**
 * Isolate visible dialogs throughout the frame's document, including body portals.
 * @param frame - the mounted application frame that owns this document-wide effect.
 * @returns an idempotent disposer that restores inert state and the outer trigger.
 */
export function installModalOverlayIsolation(frame: HTMLElement): () => void {
  const doc = frame.ownerDocument
  const backgroundState = new Map<HTMLElement, boolean>()
  const stack: { dialog: HTMLElement; returnFocus: HTMLElement | null }[] = []
  let disposed = false

  const visible = (element: HTMLElement): boolean => {
    if (getComputedStyle(element).visibility !== 'visible') return false
    for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || getComputedStyle(node).display === 'none') return false
    }
    return true
  }

  const externallyInert = (element: HTMLElement): boolean => {
    for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
      if (node.inert && (!backgroundState.has(node) || backgroundState.get(node))) return true
    }
    return false
  }

  const rootsOf = (dialog: HTMLElement): HTMLElement[] => {
    const roots = [dialog]
    const portals = Array.from(doc.querySelectorAll<HTMLElement>('[data-dsh-portal-owner]'))
    for (const root of roots) {
      for (const portal of portals) {
        const owner = doc.getElementById(portal.getAttribute('data-dsh-portal-owner') ?? '')
        if (owner !== null && root.contains(owner) && !roots.includes(portal) && visible(portal)) roots.push(portal)
      }
    }
    return roots
  }

  const isolate = (dialog: HTMLElement | null): void => {
    const wanted = new Set<HTMLElement>()
    const roots = dialog === null ? [] : rootsOf(dialog)
    for (const root of roots) {
      for (let branch = root; branch.parentElement !== null; branch = branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          // Decorative masks retain their owner's click-to-dismiss behavior.
          if (sibling instanceof HTMLElement && !roots.some(allowed => sibling.contains(allowed))
            && sibling !== branch && sibling.getAttribute('aria-hidden') !== 'true') wanted.add(sibling)
        }
        if (branch.parentElement === doc.body) break
      }
    }
    for (const [element, wasInert] of backgroundState) {
      if (wanted.has(element)) continue
      element.inert = wasInert
      backgroundState.delete(element)
    }
    for (const element of wanted) {
      if (!backgroundState.has(element)) backgroundState.set(element, element.inert)
      if (!element.inert) element.inert = true
    }
  }

  const focusableItems = (dialog: HTMLElement): HTMLElement[] =>
    rootsOf(dialog).flatMap(root => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)))
      .filter(item => item.tabIndex >= 0 && !item.matches(':disabled') && visible(item) && !item.closest('[inert]'))

  const focusDialog = (dialog: HTMLElement, preferred: HTMLElement | null = null): void => {
    const target = preferred !== null && rootsOf(dialog).some(root => root.contains(preferred)) && visible(preferred) && !preferred.closest('[inert]')
      ? preferred : focusableItems(dialog).at(0)
    if (target !== undefined) target.focus({ preventScroll: true })
    else { dialog.tabIndex = -1; dialog.focus({ preventScroll: true }) }
  }

  const syncModal = (): void => {
    if (disposed) return
    const next = Array.from(doc.querySelectorAll<HTMLElement>(MODAL_SELECTOR))
      .filter(dialog => visible(dialog) && !externallyInert(dialog)).at(-1) ?? null
    const current = stack.at(-1)?.dialog ?? null
    let returnFocus: HTMLElement | null = null
    if (next !== current) {
      const index = stack.findIndex(entry => entry.dialog === next)
      if (next === null || index >= 0) returnFocus = stack.splice(index + 1)[0]?.returnFocus ?? null
      else stack.push({ dialog: next, returnFocus: doc.activeElement instanceof HTMLElement ? doc.activeElement : null })
    }
    isolate(next)
    if (next === current && (next === null || (
      rootsOf(next).some(root => root.contains(doc.activeElement)) && visible(doc.activeElement as HTMLElement)
    ))) return
    queueMicrotask(() => {
      if (disposed || (stack.at(-1)?.dialog ?? null) !== next) return
      if (next !== null) focusDialog(next, returnFocus)
      else if (returnFocus?.isConnected === true && visible(returnFocus) && !returnFocus.closest('[inert]')) returnFocus.focus({ preventScroll: true })
    })
  }

  const trapFocus = (event: KeyboardEvent): void => {
    const dialog = stack.at(-1)?.dialog
    if (event.key !== 'Tab' || dialog === undefined) return
    const items = focusableItems(dialog)
    const first = items.at(0)
    if (first === undefined) { event.preventDefault(); focusDialog(dialog); return }
    const last = items.at(-1) ?? first
    if (event.shiftKey && (doc.activeElement === first || doc.activeElement === dialog)) {
      event.preventDefault()
      last.focus({ preventScroll: true })
    } else if ((!event.shiftKey && doc.activeElement === last) || !rootsOf(dialog).some(root => root.contains(doc.activeElement))) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }

  const containFocus = (): void => {
    const dialog = stack.at(-1)?.dialog
    if (dialog !== undefined && !rootsOf(dialog).some(root => root.contains(doc.activeElement))) focusDialog(dialog)
  }
  const observer = new MutationObserver((records) => {
    const hasModal = (node: Node): boolean => node instanceof HTMLElement
      && (node.matches(MODAL_SELECTOR) || node.querySelector(MODAL_SELECTOR) !== null)
    if (stack.length > 0 || records.some(record => record.type === 'attributes'
      ? hasModal(record.target) : Array.from(record.addedNodes).some(hasModal))) syncModal()
  })
  observer.observe(doc.body, {
    attributeFilter: ['role', 'aria-modal', 'aria-hidden', 'hidden', 'inert', 'style', 'class', 'disabled'],
    attributes: true, childList: true, subtree: true,
  })
  doc.addEventListener('keydown', trapFocus, true)
  doc.addEventListener('focusin', containFocus, true)
  syncModal()

  return () => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    doc.removeEventListener('keydown', trapFocus, true)
    doc.removeEventListener('focusin', containFocus, true)
    const target = stack[0]?.returnFocus
    stack.length = 0
    isolate(null)
    if (target?.isConnected === true && visible(target) && !target.closest('[inert]')) target.focus({ preventScroll: true })
  }
}
