/**
 * The one add/edit dialog, shared by the message-bubble capture and the
 * Settings page.
 *
 * Fields: name, target session, content. The confirm button is enabled only
 * when the whole draft is valid — non-blank name, unused name, a chosen target
 * session, non-blank content — and the host re-checks the same rules, so a
 * race between two tabs is still refused with a readable reason rather than
 * silently overwriting.
 *
 * A bubble capture locks the target to the bubble's own session (that IS the
 * shortcut source); a manual create picks one from the client session list.
 *
 * @module dsh-shortcut/client/components/EditorDialog
 */

import { useEffect, useRef, useState } from 'react'
import { Button, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { bannerStore, editorStore, useEditor } from '../editor.ts'
import { useEntries } from '../entries.ts'
import { errorText } from '../locale.ts'
import type { Translate } from '../locale.ts'
import { titleOf, useSessionRows } from '../sessions.ts'
import { validateDraft } from '../../share.ts'
import css from '../styles.module.css'
import type { ReactNode } from 'react'

/** Props for the dialog host: the framework's localizer. */
export interface EditorDialogProps {
  t: Translate
}

/**
 * Render the global dialog.
 * @param props - the localizer.
 * @returns the modal when open, otherwise null.
 */
export function ShortcutEditorDialog({ t }: EditorDialogProps): ReactNode {
  const state = useEditor()
  const list = useEntries()
  const rows = useSessionRows()
  const [sessionMenu, setSessionMenu] = useState(false)
  const nameRef = useRef<HTMLInputElement | null>(null)

  // A reopened dialog must not inherit the previous picker state, and the name
  // field is where the reader starts: an empty name is always the first gap.
  useEffect(() => {
    if (!state.open) return
    setSessionMenu(false)
    const handle = requestAnimationFrame(() => { nameRef.current?.focus() })
    return () => { cancelAnimationFrame(handle) }
  }, [state.open])

  const checked = validateDraft(list.entries, {
    name: state.name,
    sessionId: state.sessionId,
    text: state.text,
  }, state.id)
  const canSubmit = checked.ok && !state.submitting
  const editing = state.mode === 'edit'

  const submit = async (): Promise<void> => {
    const entry = await editorStore.submit()
    if (entry === undefined) return
    bannerStore.show(
      editing ? t('toast.updated', { name: entry.name }) : t('toast.created', { name: entry.name }),
      { tone: 'success' },
    )
  }

  const sessionItems: MenuEntry[] = rows.length === 0
    ? [{ type: 'label', id: 'no-sessions', text: t('dialog.noSessions') }]
    : rows.map(row => ({ id: row.id, label: row.title }))
  const selectedTitle = state.sessionId === '' ? t('dialog.sessionPlaceholder') : titleOf(rows, state.sessionId)

  const picker = state.sessionFixed
    ? (
        <div className={css.sessionFixedRow} data-dsh-shortcut-session-fixed="">
          <span className={css.sessionFixedValue}>{selectedTitle}</span>
          <span className={css.sessionFixedTag}>{t('dialog.sessionFixed')}</span>
        </div>
      )
    : (
        <Menu
          open={sessionMenu}
          onClose={() => { setSessionMenu(false) }}
          anchor={(
            <button
              type="button"
              className={css.sessionPicker}
              data-dsh-shortcut-session-picker=""
              aria-label={t('dialog.sessionPick')}
              onClick={() => { setSessionMenu(value => !value) }}
            >
              <span className={state.sessionId === '' ? css.sessionPickerEmpty : css.sessionPickerValue}>
                {selectedTitle}
              </span>
            </button>
          )}
          items={sessionItems}
          onSelect={(id) => {
            if (!rows.some(row => row.id === id)) return
            editorStore.patch({ sessionId: id })
            setSessionMenu(false)
          }}
          side="bottom"
          align="start"
          portal
        />
      )

  const problem = state.problem !== undefined && state.problem !== 'name-taken'
    ? errorText(t, state.problem)
    : undefined

  return (
    <Modal
      open={state.open}
      onClose={() => { editorStore.close() }}
      title={editing ? t('dialog.editTitle') : t('dialog.createTitle')}
      closeLabel={t('dialog.cancel')}
      footer={(
        <div className={css.dialogFooter}>
          <Button variant="outline" onClick={() => { editorStore.close() }}>{t('dialog.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            data-dsh-shortcut-confirm=""
            onClick={() => { void submit() }}
          >
            {state.submitting ? t('dialog.saving') : editing ? t('dialog.save') : t('dialog.confirm')}
          </Button>
        </div>
      )}
    >
      <div className={css.form}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('dialog.nameLabel')}</span>
          <Input
            ref={nameRef}
            value={state.name}
            maxLength={60}
            placeholder={t('dialog.namePlaceholder')}
            data-dsh-shortcut-name=""
            onChange={(event) => { editorStore.patch({ name: event.currentTarget.value }) }}
          />
        </label>
        {state.problem === 'name-taken' && <p className={css.problem}>{t('dialog.nameTaken')}</p>}

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('dialog.sessionLabel')}</span>
          {picker}
        </div>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('dialog.textLabel')}</span>
          <textarea
            className={css.textarea}
            rows={5}
            value={state.text}
            placeholder={t('dialog.textPlaceholder')}
            data-dsh-shortcut-text=""
            onChange={(event) => { editorStore.patch({ text: event.currentTarget.value }) }}
          />
        </label>
        {problem !== undefined && <p className={css.problem}>{problem}</p>}
      </div>
    </Modal>
  )
}
