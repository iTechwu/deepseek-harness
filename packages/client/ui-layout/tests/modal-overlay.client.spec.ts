// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { installModalOverlayIsolation } from '../src/client/modal-overlay.ts'

const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.replaceChildren()
})

describe('ui-layout modal overlay isolation', () => {
  it('keeps an owned portal menu interactive while isolating unrelated portals', async () => {
    const frame = document.createElement('div')
    frame.innerHTML = '<button id="other-owner">Other</button><section role="dialog" aria-modal="true"><button id="menu-owner">Menu</button></section>'
    document.body.append(frame)
    disposers.push(installModalOverlayIsolation(frame))
    await Promise.resolve()
    const menu = document.createElement('div')
    menu.dataset.dshPortalOwner = 'menu-owner'
    menu.innerHTML = '<button>Option</button>'
    const unrelated = document.createElement('div')
    unrelated.dataset.dshPortalOwner = 'other-owner'
    unrelated.innerHTML = '<button>Unrelated</button>'
    document.body.append(menu, unrelated)
    await Promise.resolve()
    await Promise.resolve()
    expect(menu.inert).not.toBe(true)
    expect(unrelated.inert).toBe(true)
    const option = menu.querySelector('button')!
    option.focus()
    expect(document.activeElement).toBe(option)
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(frame.querySelector('#menu-owner'))
    unrelated.querySelector('button')!.focus()
    expect(document.activeElement).toBe(frame.querySelector('#menu-owner'))
  })

  it('skips hidden and disabled controls, handles empty dialogs, and restores focus when hidden', async () => {
    const frame = document.createElement('div')
    frame.innerHTML = '<button>Open</button>'
    document.body.append(frame)
    const trigger = frame.querySelector('button')!
    trigger.focus()
    disposers.push(installModalOverlayIsolation(frame))
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.innerHTML = '<button hidden>Hidden</button><button aria-hidden="true">Aria hidden</button><div style="display:none"><button>Concealed</button></div><button style="visibility:hidden">Invisible</button><fieldset disabled><input></fieldset><button id="available">Available</button>'
    frame.append(dialog)
    await Promise.resolve()
    await Promise.resolve()
    const available = dialog.querySelector<HTMLButtonElement>('#available')!
    expect(document.activeElement).toBe(available)
    available.disabled = true
    available.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(dialog)
    dialog.hidden = true
    await Promise.resolve()
    await Promise.resolve()
    expect(document.activeElement).toBe(trigger)
  })

  it('does not activate externally inert dialogs or run queued focus after disposal', async () => {
    const frame = document.createElement('div')
    frame.innerHTML = '<button>Open</button><section role="dialog" aria-modal="true"><button>Hidden operation</button></section>'
    const dialog = frame.querySelector('section')!
    dialog.inert = true
    document.body.append(frame)
    const trigger = frame.querySelector('button')!
    trigger.focus()
    const dispose = installModalOverlayIsolation(frame)
    disposers.push(dispose)
    await Promise.resolve()
    expect(document.activeElement).toBe(trigger)
    dialog.inert = false
    dialog.setAttribute('aria-modal', 'true')
    await Promise.resolve()
    dispose()
    await Promise.resolve()
    expect(document.activeElement).toBe(trigger)
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(trigger)
  })

  it('isolates the background, traps focus, and restores the trigger', async () => {
    const frame = document.createElement('div')
    const background = document.createElement('main')
    const trigger = document.createElement('button')
    background.append(trigger)
    const overlay = document.createElement('div')
    frame.append(background, overlay)
    document.body.append(frame)
    trigger.focus()

    const dispose = installModalOverlayIsolation(frame)
    disposers.push(dispose)
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const close = document.createElement('button')
    const refresh = document.createElement('button')
    dialog.append(close, refresh)
    overlay.append(dialog)
    await Promise.resolve()
    await Promise.resolve()

    expect(background.inert).toBe(true)
    expect(document.activeElement).toBe(close)
    refresh.focus()
    refresh.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(close)
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(refresh)

    dialog.remove()
    await Promise.resolve()
    await Promise.resolve()
    expect(background.inert).not.toBe(true)
    expect(document.activeElement).toBe(trigger)
    dispose()
  })

  it('reacts when an existing overlay node becomes a modal dialog', async () => {
    const frame = document.createElement('div')
    const background = document.createElement('main')
    const trigger = document.createElement('button')
    background.append(trigger)
    const overlay = document.createElement('div')
    frame.append(background, overlay)
    document.body.append(frame)
    trigger.focus()

    const dispose = installModalOverlayIsolation(frame)
    disposers.push(dispose)
    const dialog = document.createElement('section')
    const close = document.createElement('button')
    dialog.append(close)
    overlay.append(dialog)
    await Promise.resolve()
    await Promise.resolve()

    expect(background.inert).not.toBe(true)

    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    await Promise.resolve()
    await Promise.resolve()

    expect(background.inert).toBe(true)
    expect(document.activeElement).toBe(close)
    dispose()
  })

  it('isolates a settings dialog inside the sidebar and restores nested dialog triggers', async () => {
    const frame = document.createElement('div')
    frame.innerHTML = '<aside><button id="settings-trigger">Settings</button><div id="settings-seat"></div></aside><main><button>Chat</button></main><div id="overlay"></div>'
    document.body.append(frame)
    const trigger = frame.querySelector<HTMLButtonElement>('#settings-trigger')!
    trigger.focus()
    disposers.push(installModalOverlayIsolation(frame))
    const parent = document.createElement('section')
    parent.setAttribute('role', 'dialog')
    parent.setAttribute('aria-modal', 'true')
    parent.innerHTML = '<button id="parent-close">Close settings</button><div><button id="consent-trigger">Install</button></div>'
    frame.querySelector('#settings-seat')!.append(parent)
    await Promise.resolve()
    await Promise.resolve()
    expect(frame.querySelector<HTMLElement>('main')!.inert).toBe(true)
    const parentClose = parent.querySelector<HTMLButtonElement>('#parent-close')!
    expect(document.activeElement).toBe(parentClose)
    const consentTrigger = parent.querySelector<HTMLButtonElement>('#consent-trigger')!
    consentTrigger.focus()
    const child = document.createElement('section')
    child.setAttribute('role', 'alertdialog')
    child.setAttribute('aria-modal', 'true')
    child.innerHTML = '<button>Cancel</button><button>Approve</button>'
    consentTrigger.parentElement!.append(child)
    await Promise.resolve()
    await Promise.resolve()
    expect(document.activeElement).toBe(child.firstElementChild)
    expect(parentClose.inert).toBe(true)
    expect(consentTrigger.inert).toBe(true)
    expect(parent.inert).not.toBe(true)
    child.remove()
    await Promise.resolve()
    await Promise.resolve()
    expect(document.activeElement).toBe(consentTrigger)
    expect(parentClose.inert).not.toBe(true)
    expect(frame.querySelector<HTMLElement>('main')!.inert).toBe(true)
    parent.remove()
    await Promise.resolve()
    await Promise.resolve()
    expect(document.activeElement).toBe(trigger)
    expect(frame.querySelector<HTMLElement>('main')!.inert).not.toBe(true)
  })

  it('supports body portals and restores pre-existing inert state on disposal', async () => {
    const frame = document.createElement('div')
    frame.innerHTML = '<button>Open</button><div id="overlay"></div>'
    const preserved = document.createElement('div')
    preserved.inert = true
    document.body.append(frame, preserved)
    const trigger = frame.querySelector('button')!
    trigger.focus()
    const dispose = installModalOverlayIsolation(frame)
    disposers.push(dispose)
    const portal = document.createElement('section')
    portal.setAttribute('role', 'dialog')
    portal.setAttribute('aria-modal', 'true')
    portal.innerHTML = '<button>Close</button>'
    document.body.append(portal)
    await Promise.resolve()
    await Promise.resolve()
    expect(frame.inert).toBe(true)
    expect(document.activeElement).toBe(portal.firstElementChild)
    dispose()
    expect(frame.inert).not.toBe(true)
    expect(preserved.inert).toBe(true)
    expect(document.activeElement).toBe(trigger)
    portal.remove()
    await Promise.resolve()
    await Promise.resolve()
    expect(document.activeElement).toBe(trigger)
  })
})
