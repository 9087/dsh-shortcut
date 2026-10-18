/**
 * "About this menu": what the shortcut menu is, which plugin provides it, and
 * how records are added, edited and deleted.
 *
 * The menu's last item opens this instead of delivering anything, so a reader
 * who wonders where the row came from (or how to manage it) gets the answer
 * without leaving the conversation or guessing at the package name.
 *
 * @module dsh-shortcut/client/components/AboutDialog
 */

import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../locale.ts'
import css from '../styles.module.css'
import type { ReactNode } from 'react'

/** Props for the about dialog. */
export interface AboutDialogProps {
  /** Whether the dialog is showing. */
  open: boolean
  /** Close request (backdrop, Escape, the X, or the button). */
  onClose: () => void
  /** The framework's localizer. */
  t: Translate
}

/**
 * Render the about dialog.
 * @param props - open state, close handler and localizer.
 * @returns the modal, which portals itself to the document body.
 */
export function ShortcutAboutDialog({ open, onClose, t }: AboutDialogProps): ReactNode {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('about.title')}
      closeLabel={t('about.close')}
      footer={(
        <div className={css.dialogFooter}>
          <Button
            variant="primary"
            data-dsh-shortcut-about-close=""
            onClick={onClose}
          >
            {t('about.close')}
          </Button>
        </div>
      )}
    >
      <div className={css.aboutBody} data-dsh-shortcut-about="">
        <p className={css.aboutLead}>{t('about.plugin')}</p>
        <ul className={css.aboutList}>
          <li className={css.aboutItem}>{t('about.add')}</li>
          <li className={css.aboutItem}>{t('about.edit')}</li>
          <li className={css.aboutItem}>{t('about.delete')}</li>
          <li className={css.aboutItem}>{t('about.use')}</li>
        </ul>
        <p className={css.aboutNote}>{t('about.storage')}</p>
      </div>
    </Modal>
  )
}
