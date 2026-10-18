/**
 * The "快捷方式" Settings page.
 *
 * The canonical management surface: every stored shortcut with its target
 * session and content, an add button, per-row edit (the same dialog a bubble
 * uses) and delete (with confirmation). It reads and mutates through the
 * plugin's shared store, so the sidebar menu is already current when the
 * reader closes Settings.
 *
 * @module dsh-shortcut/client/components/SettingsSection
 */

import { useEffect, useState } from 'react'
import { Button, IconPlusOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { bannerStore, editorStore, mountedHosts, useEditor } from '../editor.ts'
import { entriesStore, useEntries } from '../entries.ts'
import { errorText } from '../locale.ts'
import type { Translate } from '../locale.ts'
import { resolveTargetPath, useCatalogRevision } from '../catalog.ts'
import { ShortcutEditorDialog } from './EditorDialog.tsx'
import { BannerHost } from './BannerHost.tsx'
import { ShortcutFailure } from '../api.ts'
import css from '../styles.module.css'
import type { ReactNode } from 'react'

/** Props the settings section seat supplies: the framework's localizer. */
export interface SettingsSectionProps {
  /** The framework's localizer for this plugin's namespace. */
  t: Translate
}

/**
 * Render the shortcuts management page.
 * @param props - the localizer.
 * @returns the settings section body.
 */
export function ShortcutSettingsSection({ t }: SettingsSectionProps): ReactNode {
  const list = useEntries()
  useCatalogRevision()
  const editor = useEditor()
  const [pendingDelete, setPendingDelete] = useState<string | undefined>(undefined)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    entriesStore.ensureLoaded()
  }, [])

  // On a shell without a sidebar footer seat nothing else hosts the dialog;
  // this page then renders it itself. (Read, not subscribed: the footer mounts
  // during boot, long before Settings can be opened.)
  const ownsDialog = !mountedHosts.footer && editor.open

  const deleting = pendingDelete === undefined
    ? undefined
    : list.entries.find(entry => entry.id === pendingDelete)

  const confirmDelete = async (): Promise<void> => {
    if (deleting === undefined) return
    try {
      await entriesStore.remove(deleting.id)
      setPendingDelete(undefined)
      setDeleteFailure(undefined)
      bannerStore.show(t('toast.deleted', { name: deleting.name }), { tone: 'success' })
    } catch (error: unknown) {
      const code = error instanceof ShortcutFailure ? error.code : 'store-unavailable'
      setDeleteFailure(errorText(t, code))
    }
  }

  return (
    <div className={css.settingsPage} data-dsh-shortcut-settings="">
      <div className={css.settingsHeader}>
        <div className={css.settingsHeaderText}>
          <h2 className={css.settingsTitle}>{t('settings.title')}</h2>
          <p className={css.settingsIntro}>{t('settings.intro')}</p>
        </div>
        <div className={css.settingsHeaderActions}>
          <Button
            variant="primary"
            className={css.settingsAddButton}
            data-dsh-shortcut-settings-add=""
            onClick={() => { editorStore.openCreate() }}
          >
            <IconPlusOutlineRegular size={16} />
            <span>{t('settings.add')}</span>
          </Button>
        </div>
      </div>

      {list.phase === 'error' && (
        <div className={css.errorBanner} data-dsh-shortcut-load-error="">
          <span className={css.errorBannerText}>
            {t('settings.loadFailed', { message: list.failure?.message ?? '' })}
          </span>
          <Button size="sm" variant="outline" onClick={() => { void entriesStore.refresh() }}>
            {t('settings.retry')}
          </Button>
        </div>
      )}

      {list.entries.length === 0
        ? (
            <div className={css.empty} data-dsh-shortcut-empty="">
              <p className={css.emptyTitle}>{t('settings.empty')}</p>
              <p className={css.emptyHint}>{t('settings.emptyHint')}</p>
            </div>
          )
        : (
            <ul className={css.rows}>
              {list.entries.map(entry => (
                <li className={css.row} key={entry.id} data-dsh-shortcut-row={entry.id}>
                  <div className={css.rowMain}>
                    <span className={css.rowName}>{entry.name}</span>
                    <span className={css.rowMeta}>
                      {t('settings.target')}：{resolveTargetPath(entry.target, entry.sessionId, t)}
                    </span>
                    <span className={css.rowText}>{entry.text}</span>
                  </div>
                  <div className={css.rowActions}>
                    <Button
                      size="sm"
                      variant="outline"
                      data-dsh-shortcut-edit={entry.id}
                      onClick={() => { editorStore.openEdit(entry) }}
                    >
                      {t('settings.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={css.rowDanger}
                      data-dsh-shortcut-delete={entry.id}
                      onClick={() => { setDeleteFailure(undefined); setPendingDelete(entry.id) }}
                    >
                      {t('settings.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

      <Modal
        open={deleting !== undefined}
        onClose={() => { setPendingDelete(undefined) }}
        title={t('settings.deleteTitle')}
        closeLabel={t('dialog.cancel')}
        footer={(
          <div className={css.dialogFooter}>
            <Button variant="outline" onClick={() => { setPendingDelete(undefined) }}>{t('dialog.cancel')}</Button>
            <Button
              variant="primary"
              data-dsh-shortcut-delete-confirm=""
              onClick={() => { void confirmDelete() }}
            >
              {t('settings.deleteConfirm')}
            </Button>
          </div>
        )}
      >
        <p className={css.confirmText}>
          {t('settings.deleteBody', { name: deleting?.name ?? '' })}
        </p>
        {deleteFailure !== undefined && <p className={css.problem}>{deleteFailure}</p>}
      </Modal>

      {ownsDialog && <ShortcutEditorDialog t={t} />}
      {!mountedHosts.footer && <BannerHost />}
    </div>
  )
}
