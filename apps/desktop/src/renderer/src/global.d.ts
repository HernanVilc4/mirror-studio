import type { StudioApi } from '../../preload'

/** Brand kit controller (brand/mirrorstudio-intro.js), loaded as a local script. */
interface MirrorStudioIntroApi {
  play(options: {
    host: HTMLElement; main: HTMLElement; anchor?: HTMLElement | null; ready: Promise<unknown>
    focusTarget?: HTMLElement | null; signal?: AbortSignal
    background?: string; ink?: string; destinationInk?: string; reducedMotion?: boolean
  }): Promise<void>
  forms: { r1: string; r2: string; word: string }
}

declare global {
  interface Window { studio: StudioApi }
  // eslint-disable-next-line no-var
  var MirrorStudioIntro: MirrorStudioIntroApi
}
