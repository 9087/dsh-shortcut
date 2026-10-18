/**
 * The shortcut glyph, drawn from the shell's own icon set so the sidebar row
 * matches the controls beside it: a paper plane (send) at the medium weight and
 * 16px edge the shell's Settings icon uses.
 *
 * The injected bubble button uses the same set in `bubble-capture.ts` (a plain
 * plus at the regular weight, matching the copy/branch icons in that row); both
 * are the product's artwork, not a hand-drawn composite, which is what keeps
 * the stroke, optical size and colour identical to the rest of the UI.
 *
 * @module dsh-shortcut/client/components/ShortcutIcon
 */

import { IconPaperPlaneOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'

/** Edge in px. The shell's sidebar icons are 16px; one step larger keeps this
 *  row's label (14px) from visually outweighing the glyph, which was the
 *  complaint the first hand-drawn 16px bookmark kept drawing. */
export const SHORTCUT_ICON_SIZE = 18

/** Render the shortcut glyph. */
export function ShortcutIcon(): ReactNode {
  return <IconPaperPlaneOutlineMedium size={SHORTCUT_ICON_SIZE} />
}
