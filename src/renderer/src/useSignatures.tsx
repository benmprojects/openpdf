import { useMemo, useState, type ReactNode } from 'react'
import { t } from './i18n'
import { CAT_INITIALS, CAT_SIGNATURES, isSignatureCategory } from './signatureLogic'
import { SignatureLibrary, SignatureMaker, type NewSignature } from './SignatureDialogs'
import { BUILTIN_STAMPS, uniqueName, type StampDef } from './stampLogic'
import type { useStamps } from './useStamps'

type Stamps = ReturnType<typeof useStamps>

const PLACEHOLDERS = { sign: 'builtin:sign-here', initial: 'builtin:initial-here' } as const

/**
 * The signature and initials library on the Sign tab. The pictures are kept with the image stamps (categories
 * "Signatures" and "Initials"), so placing, sizing, several pages, saving and flattening all use the stamp code.
 */
export function useSignatures(stamps: Stamps, author: string, notify: (n: { kind: 'error' | 'info'; text: string }) => void) {
  const [open, setOpen] = useState(false)
  const [making, setMaking] = useState<'signature' | 'initials' | null>(null)
  const items = useMemo(() => stamps.stamps.filter((s) => s.kind === 'image' && isSignatureCategory(s.category)), [stamps.stamps])

  /** Click to place at the picture's usual size, or drag a box to size it. */
  const place = (def: StampDef) => {
    setOpen(false)
    stamps.setOpts((o) => ({ ...o, drag: true, angle: 0, opacity: 1 }))
    stamps.pick(def)
    notify({ kind: 'info', text: t('Click on the page to place {name}, or drag a box to set its size.', { name: def.name }) })
  }
  const placeMany = (def: StampDef) => {
    setOpen(false)
    stamps.setOpts((o) => ({ ...o, drag: true, angle: 0, opacity: 1 }))
    stamps.arm(def)
  }
  /** The "Sign here" and "Initial here" markers that show someone else where to sign. */
  const placeholder = (which: keyof typeof PLACEHOLDERS) => {
    const def = BUILTIN_STAMPS.find((s) => s.id === PLACEHOLDERS[which])
    if (!def) return
    stamps.setOpts((o) => ({ ...o, drag: false, angle: 0, opacity: 1 }))
    stamps.pick(def)
    notify({ kind: 'info', text: t('Click on the page where the signature should go.') })
  }

  const save = async (s: NewSignature) => {
    setMaking(null)
    try {
      const taken = items.filter((x) => x.category === s.category).map((x) => x.name)
      const res = await window.openpdf.addStampData([{ name: uniqueName(s.name, taken), category: s.category, data: s.png }])
      await stamps.refresh()
      if (res.refused.length) notify({ kind: 'error', text: t('That picture could not be saved (PNG or JPEG up to 8 MB).') })
      else notify({ kind: 'info', text: t('Saved {name}.', { name: res.added[0]?.name ?? s.name }) })
    } catch (e) {
      notify({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const dialogs: ReactNode = (
    <>
      {open && !making && (
        <SignatureLibrary
          items={items}
          onPlace={place}
          onPlaceMany={placeMany}
          onNew={setMaking}
          onRename={(s) => {
            setOpen(false)
            stamps.edit(s)
          }}
          onDelete={(s) => void stamps.remove(s)}
          onClose={() => setOpen(false)}
        />
      )}
      {making && <SignatureMaker initialKind={making} author={author} existing={items} onSave={(s) => void save(s)} onCancel={() => setMaking(null)} />}
    </>
  )

  return { open: () => setOpen(true), items, placeholder, dialogs, categories: [CAT_SIGNATURES, CAT_INITIALS] }
}
