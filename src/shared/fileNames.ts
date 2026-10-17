/** Checking a file name typed for renaming a document: shared by the dialog (to explain) and the main process (to enforce). */

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/

/**
 * The file name a typed name stands for, always ending in .pdf, or why it cannot be used. The folder is not part of it:
 * a rename never moves a file to another folder.
 */
export function cleanFileName(input: string): { name: string; error: string | null } {
  const typed = input.trim().replace(/\.pdf$/i, '').trim()
  if (!typed) return { name: '', error: 'Enter a file name.' }
  if (ILLEGAL.test(typed)) return { name: '', error: 'A file name cannot contain any of these: \\ / : * ? " < > |' }
  if (/[. ]$/.test(typed)) return { name: '', error: 'A file name cannot end with a dot or a space.' }
  if (RESERVED.test(typed.split('.')[0])) return { name: '', error: 'Windows does not allow that name. Choose another.' }
  if (typed.length > 120) return { name: '', error: 'That name is too long (120 characters at most).' }
  return { name: `${typed}.pdf`, error: null }
}
