/** The right-click menu for text boxes: spelling suggestions first, then the usual edit commands. */
import type { MenuItemConstructorOptions } from 'electron'

export interface EditContext {
  misspelledWord: string
  dictionarySuggestions: string[]
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

export function editMenuTemplate(p: EditContext, actions: { replace: (word: string) => void; addWord: (word: string) => void }): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (p.misspelledWord) {
    const suggestions = p.dictionarySuggestions.slice(0, 5)
    if (suggestions.length) for (const s of suggestions) items.push({ label: s, click: () => actions.replace(s) })
    else items.push({ label: 'No suggestions', enabled: false })
    items.push({ label: 'Add to dictionary', click: () => actions.addWord(p.misspelledWord) }, { type: 'separator' })
  }
  items.push(
    { label: 'Cut', role: 'cut', enabled: p.editFlags.canCut },
    { label: 'Copy', role: 'copy', enabled: p.editFlags.canCopy },
    { label: 'Paste', role: 'paste', enabled: p.editFlags.canPaste },
    { type: 'separator' },
    { label: 'Select all', role: 'selectAll', enabled: p.editFlags.canSelectAll }
  )
  return items
}
