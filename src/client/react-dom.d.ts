/**
 * Minimal `react-dom` surface used by this plugin: only `createPortal`, for the
 * tree picker's body-portaled panel. Declared here instead of pulling
 * `@types/react-dom` into the package just for one call.
 */
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react'

  export function createPortal(
    children: ReactNode,
    container: Element | DocumentFragment,
    key?: string | null,
  ): ReactPortal
}
