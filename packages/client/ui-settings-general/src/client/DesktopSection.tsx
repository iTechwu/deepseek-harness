/** The Desktop section: installed version, update state, and the shell-owned update action. */
import type { PropsLocale, PropsRuntime, InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopUpdatePresentation, DesktopUpdateView } from '../types.ts'
import css from './DesktopSection.module.css'

/** Registrant-private injected share: the shared desktop update observation and command. */
export type DesktopSectionInjected = {
  /** Request the current shell-owned update action. */
  openDesktopUpdate: () => void
  hooks: {
    /** Shared Electron status for both sidebar locations. */
    desktopUpdate: HostObservable<DesktopUpdateView>
  }
}

/** Full component props: section owner share, localized copy, and the injected face. */
export type DesktopSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings'> & InjectFace<DesktopSectionInjected>

/** Update phases where the manual action is offered; the rest render status only. */
const ACTION_PHASES: ReadonlySet<DesktopUpdatePresentation['phase']> = new Set(['idle', 'available', 'ready', 'error'])

/**
 * Render the Desktop section content column: the installed release version and
 * one update row driven by the preload presentation — the same shell-owned
 * action the sidebar badge uses, so concurrent clicks join one operation.
 * @param props - localized copy and the injected desktop update face.
 * @returns the section element tree.
 */
export function DesktopSection({ t, useDesktopUpdate, openDesktopUpdate }: DesktopSectionProps) {
  const view = useDesktopUpdate(state => state)
  const state = view.presentation
  const version = process.env.DSH_CLIENT_VERSION
  const busy = view.opening || (state !== undefined && ['checking', 'downloading', 'verifying', 'installing'].includes(state.phase))
  const phase = state?.phase ?? 'idle'
  const actionLabel = phase === 'ready'
    ? t('desktop.update.ready')
    : phase === 'error'
      ? t('desktop.update.retry')
      : t('desktop.section.check')
  const statusText = phase === 'idle'
    ? t('desktop.section.upToDate')
    : phase === 'downloading' && state?.percent !== undefined
      ? t('desktop.update.progress', { percent: Math.round(state.percent) })
      : t(`desktop.update.${phase}` as 'desktop.update.checking')

  return (
    <div className={css.section}>
      {version !== undefined && <div className={css.version}>{t('general.currentVersion', { version })}</div>}
      <div className={css.updateRow}>
        <span className={css.updateState}>{statusText}</span>
        {ACTION_PHASES.has(phase) && (
          <button type="button" className={css.action} disabled={view.opening || busy} onClick={openDesktopUpdate}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
