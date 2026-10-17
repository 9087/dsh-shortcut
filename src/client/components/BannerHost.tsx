/**
 * The single transient banner host. The primitives `Toast` portals itself to
 * the document body, so mounting it from the sidebar footer is enough for a
 * delivery made anywhere in the page.
 *
 * @module dsh-shortcut/client/components/BannerHost
 */

import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { bannerStore, useBanner } from '../editor.ts'
import type { ReactNode } from 'react'

/** Render the current banner, if any. */
export function BannerHost(): ReactNode {
  const banner = useBanner()
  if (banner === null) return null
  return (
    <Toast
      key={banner.key}
      text={banner.text}
      {...(banner.tone === undefined ? {} : { tone: banner.tone })}
      {...(banner.holdMs === undefined ? {} : { holdMs: banner.holdMs })}
      onDone={() => { bannerStore.dismiss(banner.key) }}
    />
  )
}
