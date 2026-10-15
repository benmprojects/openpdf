/** Grid and guide lines over a page, drawn in the unrotated page frame (they turn with the view). */
export interface Guide {
  id: number
  /** 'x': a vertical line at x = pos; 'y': a horizontal line at y = pos. Page points. */
  axis: 'x' | 'y'
  pos: number
}

interface Props {
  size: { width: number; height: number }
  zoom: number
  grid: number | null
  guides: Guide[]
  /** Guides can be grabbed (select tool only). */
  interactive: boolean
  onGuideDown: (e: React.MouseEvent, g: Guide) => void
}

export function GuideLayer({ size, zoom, grid, guides, interactive, onGuideDown }: Props) {
  const w = size.width
  const h = size.height
  const lines: React.ReactNode[] = []
  if (grid && grid * zoom >= 4) {
    for (let x = grid, i = 1; x < w; x += grid, i++) lines.push(<line key={`gx${i}`} x1={x} y1={0} x2={x} y2={h} className={i % 5 ? 'grid-minor' : 'grid-major'} />)
    for (let y = grid, i = 1; y < h; y += grid, i++) lines.push(<line key={`gy${i}`} x1={0} y1={y} x2={w} y2={y} className={i % 5 ? 'grid-minor' : 'grid-major'} />)
  }
  return (
    <svg className="guide-svg" width={w * zoom} height={h * zoom} viewBox={`0 0 ${w} ${h}`}>
      <g strokeWidth={1 / zoom}>{lines}</g>
      {guides.map((g) => {
        const [x1, y1, x2, y2] = g.axis === 'x' ? [g.pos, 0, g.pos, h] : [0, g.pos, w, g.pos]
        return (
          <g key={g.id} className="guide">
            <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1 / zoom} />
            {interactive && (
              <line
                className={g.axis === 'x' ? 'guide-hit x' : 'guide-hit y'}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                strokeWidth={7 / zoom}
                onMouseDown={(e) => onGuideDown(e, g)}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
