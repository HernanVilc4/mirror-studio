// The kit's own controller (public/mirrorstudio-intro.js, an unchanged copy of the kit file) is loaded by
// index.html as a classic script before the app. It also carries the exact traced shapes of the two erres and
// of the name, so the symbol is never redrawn by hand.
const intro = globalThis.MirrorStudioIntro
if (!intro) throw new Error('No se pudo cargar la marca (mirrorstudio-intro.js)')

const { forms } = intro

type SvgProps = Omit<React.SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox'>

/**
 * "Doble Erre" symbol in one ink (currentColor). `size` is the width in px.
 * `micro` is the kit's 16–32 px drawing: the second erre moves 18,17 units for more air between them.
 */
export function Isotipo({ size, micro = size <= 32, ...rest }: { size: number; micro?: boolean } & SvgProps) {
  const [w, h] = micro ? [390, 288] : [372, 271]
  return (
    <svg aria-hidden width={size} height={(size * h) / w} viewBox={`0 0 ${w} ${h}`} fill="currentColor" {...rest}>
      <path d={forms.r1} />
      <path d={forms.r2} transform={micro ? 'translate(18 17)' : undefined} />
    </svg>
  )
}

/** The name, exactly "MirrorStudio", as the kit's traced letters (no font needed, also offline). */
export function Wordmark({ height, ...rest }: { height: number } & SvgProps) {
  return (
    <svg role="img" aria-label="MirrorStudio" width={(height * 399) / 54} height={height} viewBox="0 0 399 54" fill="currentColor" {...rest}>
      <path fillRule="evenodd" d={forms.word} />
    </svg>
  )
}

/** rgb()/rgba() from getComputedStyle → #RRGGBB, which the intro controller requires. */
export const cssColorToHex = (c: string) => {
  const m = c.match(/\d+(\.\d+)?/g)
  return m && m.length >= 3 ? '#' + m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase() : null
}
