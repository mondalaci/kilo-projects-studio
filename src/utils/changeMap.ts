/**
 * The change map's drawing, kept pure so its geometry can be checked without a
 * browser: which rows are marked, where the half-width blocks land, and that a
 * change in a very long file still gets at least a hairline.
 */

export interface ChangeMark {
  /** The row removed lines. */
  del: boolean
  /** The row added lines. */
  add: boolean
}

export interface ChangePalette {
  del: string
  add: string
}

/** The subset of the 2D context this needs, so a test can stand in for it. */
export interface ChangeMapTarget {
  // Widened to match the real context, which also accepts a gradient or pattern.
  fillStyle: string | CanvasGradient | CanvasPattern
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
}

/**
 * Draw `marks` scaled into a `width` × `height` strip: removals on the left half,
 * additions on the right, so a line that replaced another shows both.
 */
export function drawChangeMap(
  ctx: ChangeMapTarget,
  width: number,
  height: number,
  marks: ChangeMark[],
  palette: ChangePalette,
): void {
  ctx.clearRect(0, 0, width, height)
  if (!marks.length || width <= 0 || height <= 0) return

  const scale = height / marks.length
  for (let index = 0; index < marks.length; index++) {
    const mark = marks[index]
    if (!mark.del && !mark.add) continue
    const y = index * scale
    // At least a hairline, or a change in a long file would round away.
    const rowHeight = Math.max(1, Math.ceil(scale))
    if (mark.del) {
      ctx.fillStyle = palette.del
      ctx.fillRect(0, y, width / 2, rowHeight)
    }
    if (mark.add) {
      ctx.fillStyle = palette.add
      ctx.fillRect(width / 2, y, width / 2, rowHeight)
    }
  }
}
