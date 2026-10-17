/**
 * The shortcut glyph: a bookmark with a plus. Drawn here rather than imported
 * so the footer trigger, the menu and the injected bubble button share one
 * shape; sized by CSS in each host.
 *
 * @module dsh-shortcut/client/components/ShortcutIcon
 */

import type { ReactNode } from 'react'

/** Render the shortcut glyph. */
export function ShortcutIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M3.5 2.75h9v10.5L8 10.4l-4.5 2.85V2.75Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M8 5.1v3.4M6.3 6.8h3.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}
