/**
 * The one add/edit dialog, shared by the message-bubble capture and the
 * Settings page.
 *
 * Fields: name, target (workspace → session → agent), content. The confirm
 * button is enabled only when the whole draft is valid — non-blank name,
 * unused name, a chosen target agent, non-blank content — and the host
 * re-checks the same rules, so a race between two tabs is still refused with a
 * readable reason rather than silently overwriting.
 *
 * A bubble capture locks the target to that bubble's own session and addresess
 * its main agent (that IS the shortcut source); a manual create/edit picks any
 * leaf from the tree picker.
 *
 * @module dsh-shortcut/client/components/EditorDialog
 */

import { useEffect, useRef } from 'react'
import { Button, Input, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { bannerStore, editorStore, useEditor } from '../editor.ts'
import { useEntries } from '../entries.ts'
import { errorText } from '../locale.ts'
import type { Translate } from '../locale.ts'
import { resolveTargetPath } from '../catalog.ts'
import { validateDraft } from '../../share.ts'
import { SessionTreePicker } from './SessionTreePicker.tsx'
import css from '../styles.module.css'
import type { ReactNode } from 'react'

/** Props for the dialog host: the framework's localizer. */
export interface EditorDialogProps {
  /** The framework's localizer for this plugin's namespace. */
  t: Translate
}

/** The target descriptor the current dialog state stands for. */
function draftTarget(state: ReturnType<typeof useEditor>): ShortcutTargetLike {
  return {
    kind: state.target.kind,
    ...(state.target.childSessionId === undefined ? {} : { childSessionId: state.target.childSessionId }),
    ...(state.target.leafLabel === undefined ? {} : { leafLabel: state.target.leafLabel }),
    ...(state.target.ancestors === undefined ? {} : { ancestors: [...state.target.ancestors] }),
  }
}

/** Minimal target shape `resolveTargetPath` accepts (session id is added separately). */
interface ShortcutTargetLike {
  kind: 'main' | 'subagent' | 'member'
  childSessionId?: string
  leafLabel?: string
  ancestors?: string[]
}

/**
 * Render the global dialog.
 * @param props - the localizer.
 * @returns the modal when open, otherwise null.
 */
export function ShortcutEditorDialog({ t }: EditorDialogProps): ReactNode {
  const state = useEditor()
  const list = useEntries()
  const nameRef = useRef<HTMLInputElement | null>(null)

  // The name field is where the reader starts: an empty name is always the
  // first gap. The picker owns its own expanded state.
  useEffect(() => {
    if (!state.open) return
    const handle = requestAnimationFrame(() => { nameRef.current?.focus() })
    return () => { cancelAnimationFrame(handle) }
  }, [state.open])

  const checked = validateDraft(list.entries, {
    name: state.name,
    sessionId: state.sessionId,
    target: draftTarget(state),
    text: state.text,
    navigate: state.navigate,
    anySession: state.anySession,
  }, state.id)
  const canSubmit = checked.ok && !state.submitting
  const editing = state.mode === 'edit'

  const submit = async (): Promise<void> => {
    const entry = await editorStore.submit((target, sessionId) => resolveTargetPath(target, sessionId, t))
    if (entry === undefined) return
    bannerStore.show(
      editing ? t('toast.updated', { name: entry.name }) : t('toast.created', { name: entry.name }),
      { tone: 'success' },
    )
  }

  // One target tree for every flow. A bubble capture only SEEDS the session (and the text);
  // the tree stays editable, so a capture can be retargeted or made session-agnostic before
  // it is saved.
  const targetField = (
    <SessionTreePicker
      t={t}
      selection={state.sessionId === '' ? undefined : { sessionId: state.sessionId, target: state.target }}
      onSelect={(selection) => { editorStore.selectTarget(selection.sessionId, selection.target) }}
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
      className={css.editorDialog ?? ''}
      contentClassName={css.editorDialogBody ?? ''}
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
      {/* Name spans the full width; below it the target tree sits on the left
          and the message body on the right — the dialog stays wide, not tall. */}
      <div className={css.formGrid}>
        <label className={`${css.field} ${css.formWide}`}>
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
        {state.problem === 'name-taken' && (
          <p className={`${css.problem} ${css.formWide}`}>{t('dialog.nameTaken')}</p>
        )}

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('dialog.targetLabel')}</span>
          {targetField}
        </div>

        <label className={`${css.field} ${css.contentField}`}>
          <span className={css.fieldLabel}>{t('dialog.textLabel')}</span>
          <textarea
            className={`${css.textarea} ${css.contentTextarea}`}
            value={state.text}
            placeholder={t('dialog.textPlaceholder')}
            data-dsh-shortcut-text=""
            onChange={(event) => { editorStore.patch({ text: event.currentTarget.value }) }}
          />
        </label>

        {/* Where the text goes: this record's own target, or whichever session is shown
            when the record is triggered. */}
        <div className={`${css.field} ${css.formWide}`} data-dsh-shortcut-any-session="">
          <div className={css.switchRow}>
            <span className={css.fieldLabel}>{t('dialog.anySessionLabel')}</span>
            <Switch
              checked={state.anySession}
              onChange={(next) => { editorStore.patch({ anySession: next }) }}
              label={t('dialog.anySessionLabel')}
            />
          </div>
          <span className={css.switchHint}>{t('dialog.anySessionHint')}</span>
        </div>

        {/* Behaviour after delivery: open the target (default), or stay put. */}
        <div className={`${css.field} ${css.formWide}`} data-dsh-shortcut-navigate="">
          <div className={css.switchRow}>
            <span className={css.fieldLabel}>{t('dialog.navigateLabel')}</span>
            <Switch
              checked={state.navigate}
              onChange={(next) => { editorStore.patch({ navigate: next }) }}
              label={t('dialog.navigateLabel')}
            />
          </div>
          <span className={css.switchHint}>{t('dialog.navigateHint')}</span>
        </div>
      </div>
      {problem !== undefined && <p className={css.problem}>{problem}</p>}
    </Modal>
  )
}
