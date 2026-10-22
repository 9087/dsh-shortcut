/**
 * The one add/edit dialog, shared by the message-bubble capture and the
 * Settings page.
 *
 * Fields: name, target (workspace → session → agent), prompt. The confirm
 * button is enabled only when the whole draft is valid — non-blank name,
 * unused name, a chosen target agent, non-blank prompt — and the host
 * re-checks the same rules, so a race between two tabs is still refused with a
 * readable reason rather than silently overwriting.
 *
 * The name can be GENERATED from the prompt: the action beside the name label derives a
 * suggestion (first line, trimmed, unique, within the length cap — see `suggestName`) and
 * puts it in the field, where it stays editable. It is a starting point, not a verdict.
 *
 * A bubble capture locks the target to that bubble's own session and addresess
 * its main agent (that IS the shortcut source); a manual create/edit picks any
 * leaf from the tree picker.
 *
 * @module dsh-shortcut/client/components/EditorDialog
 */

import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { bannerStore, editorStore, useEditor } from '../editor.ts'
import { entriesStore, useEntries } from '../entries.ts'
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

  /** Whether the prompt has text to name (the generate action is inert without it). */
  const promptBlank = state.text.trim().length === 0
  /** The naming round trip is in flight: the button says so and cannot be pressed twice. */
  const [generating, setGenerating] = useState(false)

  /** Put a proposed name in the field and leave the caret there, so it stays editable. */
  const applyName = (name: string): void => {
    if (name.length === 0 || !editorStore.getSnapshot().open) return
    editorStore.patch({ name })
    requestAnimationFrame(() => {
      nameRef.current?.focus()
      nameRef.current?.select()
    })
  }

  /**
   * Tell the reader the model could not name, keeping the exact cause visible.
   * @param note - the host's own message, when it gave one.
   */
  const reportNameUnavailable = (note: string | undefined): void => {
    const detail = note === undefined ? '' : ` — ${note.length > 160 ? `${note.slice(0, 160)}…` : note}`
    bannerStore.show(`${t('toast.nameUnavailable')}${detail}`, { holdMs: 8000 })
  }

  /**
   * Name the prompt. The HOST asks the default model, so this is a round trip.
   *
   * A refusal writes NOTHING: quietly filling the field with a truncated prefix is what made
   * "the model never ran" look like success. The name stays as it was (normally empty) and the
   * toast says why.
   */
  const generateName = async (): Promise<void> => {
    if (promptBlank || generating) return
    setGenerating(true)
    try {
      const suggested = await entriesStore.suggestName(state.text, state.id)
      if (suggested.source === 'model') {
        applyName(suggested.name)
        return
      }
      console.warn(`dsh-shortcut: the model did not name this prompt — ${suggested.note ?? 'no reason given'}`)
      reportNameUnavailable(suggested.note)
    } catch (error: unknown) {
      console.warn('dsh-shortcut: the naming request failed', error)
      reportNameUnavailable(error instanceof Error ? error.message : undefined)
    } finally {
      setGenerating(false)
    }
  }

  // One target tree for every flow. A bubble capture only SEEDS the session (and the text),
  // so the tree stays editable — unless the shortcut sends to ANY session, in which case the
  // stored target does not decide the delivery and the tree becomes locked context whose
  // path line says so.
  const targetField = (
    <SessionTreePicker
      t={t}
      selection={state.sessionId === '' ? undefined : { sessionId: state.sessionId, target: state.target }}
      onSelect={(selection) => { editorStore.selectTarget(selection.sessionId, selection.target) }}
      disabled={state.anySession}
      pathOverride={state.anySession ? t('dialog.anySessionValue') : undefined}
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
        <div className={`${css.field} ${css.formWide}`}>
          <span className={css.fieldLabel}>{t('dialog.nameLabel')}</span>
          <div className={css.nameRow}>
            <Input
              ref={nameRef}
              className={css.nameInput ?? ''}
              value={state.name}
              maxLength={60}
              placeholder={t('dialog.namePlaceholder')}
              aria-label={t('dialog.nameLabel')}
              data-dsh-shortcut-name=""
              onChange={(event) => { editorStore.patch({ name: event.currentTarget.value }) }}
            />
            {/* Name the prompt with the model (the host makes the call). Disabled while there
                is no prompt to read or a call is in flight, and it only ever FILLS the field —
                the reader can rewrite the result afterwards. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={promptBlank || generating}
              data-dsh-shortcut-generate-name=""
              data-dsh-shortcut-generating={generating ? '' : undefined}
              onClick={() => { void generateName() }}
            >
              {generating ? t('dialog.generatingName') : t('dialog.generateName')}
            </Button>
          </div>
        </div>
        {state.problem === 'name-taken' && (
          <p className={`${css.problem} ${css.formWide}`}>{t('dialog.nameTaken')}</p>
        )}

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('dialog.targetLabel')}</span>
          {targetField}
        </div>

        <label className={`${css.field} ${css.contentField}`}>
          <span className={css.fieldLabel} data-dsh-shortcut-prompt-label="">{t('dialog.textLabel')}</span>
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
