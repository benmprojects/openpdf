# OpenPDF and PDF-XChange Editor: feature parity checklist

Prepared 17/10/2026 for planning the remaining work.

## Sources and method

- PDF-XChange side: the public online manual (help.pdf-xchange.com, Editor and Editor Plus, versions 9 to 11: Tabs Guide, Features Overview, Preferences, Document Properties, Split, Bates, Stamp, Comments pane and Measuring pages) and the product page at pdf-xchange.com for the Standard / Plus differences. Nothing was downloaded, installed or inspected; this checklist is written in our own words and lists what exists and its main options. Where the manual only gave a heading, the options are marked as unconfirmed.
- OpenPDF side: `ROADMAP.md`, `HANDOFF.md` and the source (`DocView.tsx` ribbon, the `*Dialog.tsx` files, `Sidebar.tsx`, `src/main`) as at the current `main`.
- Status: DONE (comparable options), PARTIAL (present, options missing; the gaps are named), MISSING (not found in the source).
- PDF-XChange tab names are used for grouping. OpenPDF's ribbon is organised differently (Draw, Measure, Edit, Layout, Redact, Sign are their own tabs), so each table says where OpenPDF keeps the feature.
- Plus-only items (per the product page) are marked "(Plus)".

## 1. File / Backstage

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Open | Local, recent, restore previous session, cloud accounts, open from URL | PARTIAL | Recent list, tabs, drag and drop, Places (synced OneDrive, SharePoint, Dropbox and Google Drive folders), open from https URL (temporary copy, 250 MB limit, PDF check) and restore of the previous session (setting, plus File > Reopen last session) all work; documents with no file yet are not restored. Missing: direct cloud API sign-in (Out of scope: needs per-provider app registrations and proprietary services) |
| Save / Save As | Save options, save copy | DONE | Atomic write, Save As dialog |
| New document | Blank, from text, RTF, images, scanner, combine files | PARTIAL | File tab > New: a blank document of chosen page size, orientation and page count (opens unsaved). Convert tab: pictures, text, web page, clipboard picture, screenshot, Office files (via LibreOffice), scan. Missing: RTF, Markdown, CSV, XPS, WMF |
| Print | Printer, ranges, copies, scaling, booklet, N-up, comments, preview | DONE | Printer choice, range, odd/even, copies, collate, greyscale, auto-rotate and auto-centre, fit/actual/custom scale, N-up, booklet, two-sided and binding, tiling of large pages with cut marks and labels, preview, system print dialog for printer properties, print what (document, document and comments, comments only; non-printable comments left out), choice of layers (visible as shown now, all, as set in the file; offered when the file has layers). Save as PDF writes the chosen pages with pdf-lib as vector content (text stays searchable, page handling applied; annotations drawn from their appearances) and falls back to pictures if that fails or "Keep text searchable" is turned off. Pages sent to a physical printer, and tiled output, still go as 300 dpi pictures |
| Export | Images, Word, Excel, PowerPoint | DONE | Images (PNG/JPEG/TIFF), text, HTML, Word, Excel, PowerPoint: see the Convert tab section. All are best effort (tables and columns are found from positions, not from tags) |
| Share / e-mail | Send by e-mail, SharePoint check in/out | PARTIAL | Send by e-mail saves the document, shows it in Explorer to drag into a message, or starts a message without it; it cannot attach the file (needs native mail code, MAPI). Missing: check in/out (Out of scope, see section 10) |
| Revert | Discard unsaved changes | DONE | File tab > Revert to saved: asks, then reloads the whole document from its file (page edits, annotation edits, form values, security changes dropped). Undo/redo and recovery snapshots exist; the Forms tab Revert is for form values only |
| Document properties | Description, Fonts, Security, Initial View, Custom, Advanced, Actions, JavaScript | PARTIAL | Done: Description/XMP, Security dialog, Initial View, Fonts, Custom keys, Print presets. Missing: base URL, a Trapped control (the key is only listed as a standard key), document actions and JavaScript from this dialog (Forms > Document JavaScript covers scripts) |
| Rename / move to trash | Rename or delete the file | DONE | File tab > Rename (same folder, never over another file, name checked) and Move to Recycle Bin (asks first; uses the Windows Recycle Bin, never a permanent delete; the document stays open as an unsaved one) |
| Close / Exit | One or all | DONE | Unsaved prompt |
| Preferences | About 35 categories | PARTIAL | Settings has theme, language, author, recovery interval, spellcheck, restore session, updates, tool defaults and presets. Missing: most categories (page display defaults, colour management, file associations UI, identity, launch applications, search providers, performance) |
| Manage settings | Export, import, reset | PARTIAL | Settings export and import (JSON) are done. Missing: a reset-to-defaults command |
| Customise UI | Custom ribbons/toolbars, panes, RTL | MISSING | Fixed ribbon; panes dock left or right only; no quick-access toolbar, custom ribbons or tab groups. Settings export and import exist but do not cover layout |

## 2. Home tab (tools, view, quick comment, links)

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Hand, Select text, Select comments | Multi-click word/paragraph select, Alt-drag custom area | DONE | |
| Snapshot | Copy area as image | DONE | 200 dpi PNG |
| Clipboard | Cut, copy, paste | PARTIAL | Copy of text, page copy/paste, and cut, copy and paste of selected annotations (Comment tab or Ctrl+X, Ctrl+C, Ctrl+V; onto the same page they are nudged, onto another they keep their place, several keep their distances). Missing: cut and paste of page objects (picture and shape editing) |
| Find | Search the document, search the internet | DONE | Match case, whole word, regular expressions and pattern presets (phone, e-mail, dates and so on), scope of text, comments or bookmarks, highlight all, results list, find in several files. Not offered: internet search providers |
| Zoom / fit | Slider, presets, actual size, fit page/width/visible | DONE | Presets, fit page/width, Ctrl+/-. Fit visible zooms so the content (blank margins trimmed off a sample of up to 40 pages) fills the width, and scrolls to its left edge |
| Rotate view | 90 degrees | DONE | |
| Pane toggles | Bookmarks, Thumbnails, Comments, Attachments, Content, Properties | PARTIAL | Pages, Bookmarks, Comments, Attachments, Layers, Media, Measure, Fields and Content tabs; see section 12 for the panes not offered |
| Edit text | Edit base content text | PARTIAL | Run and paragraph edit with font match. Missing: text in form XObjects, character spacing and horizontal scaling (lost), non-standard fonts fall back to standard ones |
| Edit objects | Move/resize/rotate/delete content, images | PARTIAL | See section 6 |
| Add text / image / QR code | Insert new content | DONE | Typewriter, text box, Add image (PNG/JPEG). Edit tab, Images, QR / barcode: QR code (levels L to Q to H), Code 128, Code 39, EAN-13 as vector drawings, from typed text or a template ({filename}, {page}, {pages}, {date}), to the current page, every page or a range, in a corner or the centre, as page content or as a Stamp annotation, with a live preview. Encoders written for OpenPDF and checked against reference encoders. Not offered: DataMatrix and other symbologies |
| Quick comment tools | Typewriter, note, highlight, arrow, underline, rectangle, stamp | DONE | In Comment/Draw tabs |
| Links | Add/edit links, links from URLs, remove web-links, links from barcodes, batch link | PARTIAL | Link tool (web address or page) with edit and Open on click. Missing: auto-link URLs in text, remove all web links, links from barcodes, link actions other than URL/page (open file, run JavaScript, named destination), batch link |
| Sign Document | From Home | DONE | Under Sign tab |

## 3. Comment tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Typewriter, Text box, Callout | Fonts, colours, borders | DONE | |
| Sticky note, Attach file, Sound | Icons, attachments | PARTIAL | Notes (with a choice of icon: Comment, Note, Help, Key, Paragraph, Insert, written as /Name), file attachment and sound exist. Missing: sound other than WAV, audio recording |
| Highlight, Underline, Strikeout, Squiggly | From text selection | DONE | |
| Insert text, Replace text (carets) | Caret annotations | DONE | |
| Text correction | Review-style correction tool | DONE | Comment tab > Text correction: the selected text is struck out for deletion or replacement, with the new text (a caret grouped with the strikeout) and an optional comment as the one reply thread; Replace text and Insert text remain |
| Line, Arrow, Rectangle, Oval, Polygon, Polyline, Cloud | Fill, dashes, line endings, opacity | DONE | Fill, dash, opacity, line end styles (open/closed/reversed arrows, circle, square, diamond, slash, butt) on lines, arrows and polylines, cloud intensity (none, small, large) on clouds, polygons and rectangles, blend mode (Normal, Multiply, Screen, Overlay, Darken, Lighten) |
| Pencil / Eraser | Freehand, erase | DONE | |
| Stamp tool | Palette with categories, custom stamps from file/selection/document/clipboard, dynamic stamps with JavaScript (Plus), import/export | DONE | Palette with Standard business, Construction and Sign here categories plus My stamps, recent, search, text stamps with fields (date, time, user name, running number), image stamps, stamps from a PDF page, an area of the page or the clipboard, rotation, opacity, placing on several pages, import/export of collection files. The palette can also be docked as a pane beside the page. Not offered: stamps driven by JavaScript |
| Measure: distance, perimeter, area | Scales, calibrate, snap, labels, export to CSV | DONE | See section 7: angle tool, 15 degree Shift steps and on-page label text added |
| Media: video, sound, 3D | Add/edit | MISSING | Existing audio, video and 3D play or are listed in the Media pane; adding video or 3D to a page is not offered (sound comments are under Sticky note) |
| Summarise comments | Summary PDF | DONE | Summary PDF and CSV |
| Import / export comments | FDF, XFDF | DONE | |
| Show (filter visibility) | By type, author, status, checked | DONE | List filters by type, author, status and colour; group by page, author, type, colour, date and status; hide and show comments on the page (view only). Also: a "checked" flag saved in the file (Marked state model; tick in the list, filter, bulk tick), group and sort by subject, and annotations from other tools can be hidden and shown (view only) |
| Flatten comments | Selected or range | DONE | Forms tab > Flatten (with options) |
| Delete comments | Selected, visible, all | DONE | Delete selected, delete visible, delete all, each with a confirmation; locked comments are kept |
| Comments list / pane | Group, filter, replies, lock, printable flag, layer | PARTIAL | Sort, group, filter, search, replies, status (one or several), select all, next/previous (buttons and arrow keys), lock and printable flags, CSV export, summary PDF, delete selected, visible or all, a window-wide next/previous shortcut (Alt+Down, Alt+Up), the checked tick and the subject; the layer is set in Properties. Missing: reset pop-up positions |
| Comment styles palette | Save and reuse formatting, set as default | PARTIAL | Named styles saved from the Properties panel, applied to selected comments or set as a tool default; they carry line ends, cloud, blend mode and note icon; import and export of style sets as JSON files. Missing: a docked styles pane (left out on purpose) |
| Properties panel / dialog | Appearance, General, Review history, Actions, Locking | PARTIAL | Colour, fill, opacity, width, line style, line ends, cloud border, blend mode, font, size, author, Printable and Locked flags, note icon, subject, layer (an optional content group of the document) and the review history (created, replies, status changes, checks). Missing: other flags |
| Review status and threads | Replies, status | DONE | |

## 4. Organize tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Insert pages | From file with page range and odd/even subset, destination, actions for comments/forms/bookmarks | PARTIAL | Insert from PDF with range, odd or even pages of that range, and position; blank pages (size, count), a clipboard picture or a scan. For pages from a file or the clipboard: comments kept or left out, form fields kept as fields (renamed when the name is taken), made part of the page, or left out, and the source bookmarks for those pages brought in or left out. Missing: inserting text directly |
| Delete pages | Selected, empty pages | DONE | Selected pages, and Delete blank finds and removes empty pages |
| Extract | Range to new document, remove from source | DONE | Extract to a new document or one file per page, with an option to remove the pages from the source |
| Move, Duplicate, Replace, Copy/paste | Page operations | DONE | Also between documents |
| Swap pages | Exchange two pages | DONE | Swap two pages (Organise tab) |
| Merge pages | Combine split pages | DONE | Organise tab > Join pages: two pages at a time become one, side by side or stacked, optionally second page first (right to left). The first page of each pair is rebuilt in place so bookmarks to it still work; comments and fields on joined pages become part of the page |
| Split document | Every n pages, by bookmarks (level), by size | DONE | Also with file name pattern |
| Split pages | Cut each page into tiles by percentage or measure, crop box or physical | DONE | Organise, Split pages: a grid of rows and columns, or pieces of a paper size (A5 to A1, Letter, Tabloid) with an overlap in mm; each tile becomes a page with its own crop box, content shared. Comments go to the tile they sit in |
| Overlay | Layer pages of another document over this one | DONE | Organise, Overlay: choose another PDF and its pages, over or under a page range, fit/fill/actual size, alignment and offset, opacity, optional single-colour tint (compare drawing revisions). Form XObjects; removable with Remove marks |
| Rotate | Dialog: pages, odd/even, landscape/portrait | DONE | |
| Crop | Dialog and crosshair tool; remove cropped content | PARTIAL | Margins, drag crop, remove cropping, Trim white margins (from a render of each page, with space left round the content, per page or the same crop for all), different margins for odd and even pages, and "Remove the cropped area for good" (the page shrinks to the crop box so the edges cannot be restored, and notes wholly outside are deleted). Missing: removing the text and pictures themselves from the content stream (they stay in the file unseen; redaction does that) |
| Resize | Paper size, scaling | DONE | |
| Watermark | Text/image, font, colour, opacity, angle, position, page range, saved settings, remove | DONE | Text or picture, angle, opacity, behind/over, width, pages, removable; position (nine places) with distance from the edge, offset, tiling with gaps, shrink to fit the page, codes in the text (page, date, file) with date format choices, saved settings kept with the program settings |
| Background | Colour, image, placement | DONE | |
| Header and footer | Six positions, fonts, date, page number format, ranges, saved settings | DONE | Six slots, codes (file, page, pages, date, label), font, colour, margin (or one per side), offset, start number, pages, different text on the first page (or no page number on it), shrink long text to fit, date format choices, saved settings kept with the program settings |
| Bates numbering | Single and multiple files, preview, naming, log | DONE | Prefix, suffix, first number, digits; one document or several files in order with a continuing number, output folder, previews and CSV log; also a Batch step |
| Number pages / page labels | Label ranges | DONE | |
| Optimise | File size, image downsampling, linearise | DONE | |
| Compare documents (Plus) | Text and style changes, summary | DONE | Word-level and visual; no style (font/colour) changes |

## 5. Convert tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Scan | Scanner presets, colour mode, dpi, paper size, source, duplex | PARTIAL | WIA: scanner window, glass or feeder, colour mode, dpi, paper size, named presets, duplex where the driver reports it, straighten, remove specks, crop to content, OCR language, scan into the open document. Missing: TWAIN (Out of scope: needs a native TWAIN binding or helper that this project does not add), duplex on drivers that do not report it. Untested on real hardware |
| Combine files into one PDF | Mixed formats | DONE | File and Organise tabs: PDFs, pictures and Office files (LibreOffice) with page ranges, drag/arrow ordering, sort, add folder, bookmarks, new tab or save |
| Create from text / RTF / images / blank |  | PARTIAL | Pictures and plain text become PDFs (page size, font). Missing: RTF, Markdown, CSV, a blank document |
| Rasterise pages | Flatten vector to image | MISSING | No command to flatten pages to pictures (Optimise recompresses existing pictures only) |
| Recompress images |  | PARTIAL | In Optimise (maximum dpi, JPEG quality, recompress); not a standalone tool; no JBIG2 or CCITT |
| Replace fonts | Substitute fonts | MISSING | Fonts are replaced only inside PDF/A conversion; Edit text falls back to standard fonts but there is no document-wide substitution |
| Export to images | Formats, dpi | DONE | |
| Export to Word / Excel / PowerPoint | | DONE | Word, Flowing text: headings, bold/italic/size/colour, real tables (from ruled grids, horizontal rules only, or text lined up in rows and columns), pictures cut from the rendered page in reading order, text columns as Word section columns; Exact layout: each block of text in a frame fixed at its place with pictures floating behind (tables not rebuilt, hidden text of scans left out; fonts not installed can change wrapping). Excel: tables as one sheet per page or one sheet for all, numbers, dollar amounts, percentages and DD/MM/YYYY dates saved as values. PowerPoint: one slide per page as a PNG or JPEG picture (96/150/200 dpi), slide shaped like the first page, page text optionally in the notes. Not offered: editable slide text, merged table cells (a spanning cell goes in one cell), nested tables, lists as Word lists, page headers and footers |
| OCR pages | Languages, page ranges, engine choice (Plus: enhanced), table lines | PARTIAL | Two languages, pages with no text, all or the current page, 200/300/400 dpi, invisible text layer. Missing: table detection, output mode choice, enhanced engine, straightening before recognition (Scan does it) |
| Enhance scanned pages / Deskew | Clean-up, straighten | PARTIAL | Scan straightens, removes specks and crops. Missing: the same clean-up for pages already in a document |
| Convert colours | To grey/CMYK/RGB | MISSING | Greyscale exists only as a print option; no conversion of a document to grey, CMYK or RGB |
| PDF/A, PDF/X conversion |  | PARTIAL | PDF/A-2b best effort. Missing: PDF/X, PDF/A-1 and A-3 |
| Create from Word/Excel | Print driver | PARTIAL | Office files convert through LibreOffice when it is installed; no print driver |

## 6. Edit / content tools (PDF-XChange Home and Format)

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Edit images | Move, resize, rotate, replace, crop, delete | PARTIAL | Move, resize, rotate, flip, crop (numeric), opacity, replace, export, delete. Missing: dragging crop handles, images in form XObjects, other formats |
| Edit shapes / objects | Select, transform, recolour, line width | PARTIAL | Move, resize, delete, line and fill colour, width, opacity. Missing: dash, shading, clip shapes, objects in form XObjects |
| Align, distribute, order |  | PARTIAL | Annotations: done. Page content: bring forward and send backward in the Content pane. Missing: align and distribute of page-content objects |
| Format tab (font, size, colour, spacing, paragraph) | Context-sensitive text formatting | PARTIAL | Font, size, colour, bold and italic while editing a run or paragraph. Missing: spacing, alignment, text inside form XObjects |
| Spell check | Pane and as-you-type | PARTIAL | As-you-type in text boxes. Missing: a document spell-check pane |
| Word count |  | MISSING | No word or character count command |
| Layers | Show/hide, set visibility, assign comments | PARTIAL | Show and hide in the Layers tab (view only; the file is not changed). Missing: set default visibility, edit or merge layers, assign comments to layers |
| Content pane (object tree) | List of page objects | PARTIAL | Text runs, pictures, shapes and forms of the current page: select, hide/show, order, delete. Missing: contents of forms, multi-select, rename, shadings |
| Font replacement and page-content search/replace |  | MISSING | No document-wide search and replace of page content or fonts |

## 7. Measurement

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Distance, perimeter, area | Pop-up result, info pane, saved as measurement annotations | DONE | |
| Calibrate and scales | Calibrate by known distance; scale list (activate, clone, delete, import/export); document scales | DONE | Calibrate by a known distance, saved named scales, preset ratios (1:1 to 1:2000), custom ratio, per-page and whole-document scales written as viewport measures. The saved scale list can be exported to and imported from its own file (Scale dialog) as well as travelling with Settings export |
| Units and precision | Choose units, decimals | DONE | mm, cm, m, km, in, ft, ft-in, yd; decimal places or fractions; unit conversion of results |
| Snapping | Grid, guides, object snap with threshold | DONE | Grid, guides and snap to drawing geometry (endpoint, midpoint, intersection, nearest) |
| Angle constraint | Shift for 15 degree steps | DONE | Shift constrains lines and measurements to 45 degree steps, or 15 degree steps when chosen in the Measure tab |
| Labels and styling | Text labels, colour, border, line ends | DONE | A label per measurement (and a count group name), edited in the Measurements pane, written to the CSV and drawn beside the result on the page and in the saved appearance; styling in Properties |
| Export measurements | CSV | DONE | Measurements pane: list with totals, per-row label, delete, CSV export, copy all |
| Count tool, angle tool, 3D measurement | (Count/angle: not confirmed in the manual pages read) | PARTIAL | Count markers and the angle tool (three points, degrees, listed in the Measurements pane and CSV, saved as a polyline with /OPAngle, so other viewers show it as a plain polyline with its text) are done. Missing: 3D measurement |
| Rulers, grid, guides | | DONE | |

## 8. Form tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Field types | Text, button, check, radio, list, dropdown, date, barcode, image, digital signature | DONE | Text, check, radio, dropdown, list, button, signature, plus Date (a text field with an AFDate format; filling shows a calendar button and date picker, and the date is written in the field's own form), Image (a button that lets the filler choose a PNG or JPEG, kept in the file and shown again when it is opened) and Barcode (a text field drawn as QR, Code 128, Code 39 or EAN-13; other viewers may show plain text). Not offered: DataMatrix; an image already saved in an image field cannot be cleared |
| Select / edit fields | Move, resize, properties, align, duplicate | PARTIAL | Select, move, resize, delete, properties; multi-select with align, spread, same size; duplicate to other pages. Missing: moving a selection as a group, properties of several fields at once, drag-select |
| Highlight fields, grid, fields pane | | DONE | Highlight; the grid for form design uses View grid; Fields pane (Forms, Fields pane, or the Fields tab of the side pane) lists every field with its type and page, with find, select (goes to the page), rename, delete, properties and tab order Earlier and Later |
| Reset, import, export | FDF, XFDF, CSV, XML | DONE | |
| Email form data |  | MISSING | Submit sends to http or https only; no command to e-mail the form data |
| Populate from CSV (Plus-style) | Merge many records | DONE | Forms, Populate from CSV: the first row names fields, every other row makes one filled PDF (calculations and formats applied, optional flatten), named from a chosen column (unsafe characters replaced, repeats numbered) and written to a folder without overwriting. Import still fills one record |
| Form identification (Plus) | Detect fields | DONE | Detect fields with confirm |
| Calculations, validation, formats | | DONE | Presets and custom scripts in a sandbox |
| JavaScript console, document JS, document actions |  | PARTIAL | Field scripts, a document-level JavaScript editor, Submit and Reset buttons. Missing: console window, open/close/save/print document actions |
| Tab order | | DONE | |
| Fill and save | Fill, flatten | DONE | |
| Placeholder tool (Plus) | Mark where signature/initials go | DONE | Sign tab: Sign here and Initial here markers (stamps) |

## 9. Protect tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Sign document, place signature | Certificate store or file, appearance | DONE | Visible and invisible, time-stamp |
| Certify | Visible or invisible, change permissions | DONE | |
| Timestamp, validate all, clear all |  | PARTIAL | Time-stamp, validate in the Signatures panel. Missing: clear all signatures, LTV |
| Signature and initials library | Drawn/typed/image signatures stored, place and apply all | DONE | Sign tab: draw (smoothed), type (installed script fonts) or import a picture (white to transparent, trim); library with rename/delete; click or drag to place; several pages; flatten. Visual only, not a certificate signature |
| Mark for redaction, apply, find and redact | Patterns: phone, card numbers, SSN, emails, dates | PARTIAL | Area, selected text, search results and Find and redact with pattern presets; mark properties (fill, overlay text, repeat, outline). Missing: apply to a selected mark only |
| Sanitise | Metadata etc. | DONE | |
| Security properties, policies | Passwords, permissions, certificate security | PARTIAL | AES-256/128 passwords and permissions. Missing: saved security policies, certificate encryption |
| DocuSign |  | MISSING | Out of scope: a proprietary online service |

## 10. Share, Review, Accessibility, Bookmarks, Portfolio tabs

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Send by e-mail |  | PARTIAL | See Share / e-mail above: no attaching |
| SharePoint check in/out |  | MISSING | Out of scope for now: needs Microsoft app registrations and sign-in. Files in synced folders open normally |
| Proofing: spell check, word count, text correction |  | PARTIAL | As-you-type spell check only; no word count or text correction |
| Compare documents | | DONE | |
| Comments review (add, next/previous, show, flatten) |  | PARTIAL | Next/previous comment buttons and arrow keys in the pane. Missing: a window-wide shortcut |
| Accessibility: reading order, tags pane, alt text, checker, report |  | PARTIAL | The Standards dialog reports tagging, language and alt text counts. Missing: tags pane, reading order editing, alt text editing, full checker report |
| Bookmarks editing | New, delete, rename, destinations, style (colour/bold/italic), import/export, generate from text, nth-page, case change, sort, validate | PARTIAL | Insert, rename, delete, move, indent, outdent, bold, italic, colour, set to current page or view, generate from headings or per page, import/export text or CSV, expand/collapse; cut, copy and paste (also into another document); extract or print the pages a bookmark covers; Check bookmarks (lists and deletes bookmarks with no destination, a missing page or an undefined name); action dialog: go to a page or a named destination. Missing: case change, sort |
| Portfolio | Create, navigator, edit | PARTIAL | Create, list, add, save, remove. Missing: layout views, folders, thumbnails |
| Page labels | | DONE | |

## 11. View tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Go to / previous view / next view | Page box, first/last | DONE | |
| Zoom tools | Continuous zoom, zoom in/out tool, loupe, pan and zoom | PARTIAL | Marquee zoom, presets, loupe. Missing: pan and zoom window |
| Page display | Single, continuous, two pages, cover, gaps, right-to-left | PARTIAL | Single, continuous, two pages, cover. Missing: gaps toggle, right-to-left |
| Show rulers, grid, guides, snapping, page size/position |  | PARTIAL | Rulers, grid, guides, snap done. Missing: page size and position display, transparency grid |
| Thin lines | Hairline rendering | MISSING | No hairline (thin line) rendering option |
| Split views | Two views of one document | PARTIAL | Horizontal or vertical split with own scroll and zoom; the second view is read-only with no overlays. No four-way split |
| Page transitions, autoscroll |  | MISSING | Presentation mode (F5) exists; no page transitions or autoscroll |
| Document tabs | Group, new window, close options | PARTIAL | Tabs exist. Missing: tab groups, open in new window, drag a tab out |
| Full screen, reading mode, night/high-contrast colours | | DONE | |
| Read aloud | | DONE | |
| Toolbars / ribbon layout |  | MISSING | See File: customise UI |

## 12. Side panes and dialogs

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Thumbnails | Drag reorder, size, context menu | DONE | |
| Bookmarks pane | See section 10 | PARTIAL | See section 10 (bookmarks) |
| Comments pane | See section 3 | PARTIAL | See section 3 |
| Attachments pane | Add, save, open | DONE | Add, save all, remove |
| Layers pane |  | PARTIAL | See section 6 |
| Signatures pane | List, validate, properties | DONE | Panel in a dialog rather than a docked pane |
| Fields pane | List of fields | DONE | Side pane, Fields tab |
| Destinations pane | Named destinations | MISSING | No named destinations pane |
| Stamps pane and palette |  | DONE | Picker pop-up, or docked as a pane (Comment tab > Dock palette), with categories, search and recent stamps |
| Comment styles pane |  | PARTIAL | Styles are managed inside the Properties panel, with import and export of style sets. Missing: a separate docked pane (left out on purpose) |
| Content pane |  | PARTIAL | See section 6 |
| Tags pane |  | MISSING | No tags pane |
| Document recovery pane |  | PARTIAL | Recovery snapshots are offered on restart; no pane |
| Properties pane | Object properties | DONE | Properties panel (Ctrl+E) |
| Search results pane | | DONE | |
| Floating / detachable panes |  | MISSING | Docked left or right only |

## Counts

Counted from the tables above (one count per row), re-audited against the source on 17/10/2026.

DONE 75, PARTIAL 58, MISSING 18 (total 151 rows). Several rows repeat a feature seen from two tabs (Compare, Flatten, bookmarks), so treat the counts as a guide.

## Top 25 gaps for a construction-company office user

This list was written before the later rounds of work. Most items are now done (see the notes on items 16, 19 to 25, and the tables above); the open work is in "Remaining work batches" below.

Ordered by everyday usefulness (marking up drawings, measuring, stamping, combining and printing, forms, signing).

1. Named measurement scales and presets (1:20, 1:50, 1:100, 1:200, 1:500 on A1/A3/A4) with per-page scales, plus precision control; calibrating each sheet by hand is slow.
2. Measurement results as a labelled, exportable list (CSV or Excel) with page, type, length/area and a user label, and "count" markers for items such as pits, trees or signs.
3. Object snapping when measuring on vector drawings (endpoints, intersections, line ends), so quantities are accurate.
4. A proper stamp palette: categories, custom stamps from a PDF, selection or clipboard (vector, so they stay sharp), import/export and sharing of stamp sets, and a construction set (Approved, Issued for Construction, Rev, As Constructed).
5. Dynamic stamps and fields: current date, user name, sequential number filled when the stamp is placed.
6. Signature and initials library: draw, type or import once, then place on any page, with Place and Apply All (and a Placeholder tool to mark where others should sign).
7. Combine-files dialog: mixed PDFs, images and Office files in one list with ordering, then one output (the merge today is PDFs only).
8. Bates and page numbering across several files with continuous numbers, preview and a log (also as a Batch step); useful for tender and RFI bundles.
9. Print improvements: print comments/stamps on or off, print as image for stubborn files, paper-size and orientation per sheet, and a text-preserving print-to-PDF (today the output is raster).
10. Comment tools finishing: line end styles, blend mode (multiply highlights), cloud settings, subject and lock flags, printable flag, and a comment style palette to restyle existing markup in one go.
11. Comments list management: group by colour/subject/date, show/hide on the page from the filter, delete visible or all, next/previous comment navigation, "checked" flag.
12. Overlay pages: lay one PDF's pages over another (for example a revised drawing over the original, or a site plan over a base).
13. Split pages (cut A1 or A0 sheets into A3/A4 tiles) and tiled/poster printing of large sheets.
14. Search with regular expressions and presets (find and redact for phone numbers, emails, dates, card numbers), plus search scope for comments and bookmarks.
15. Redaction extras: apply a selected mark only, overlay text or code, redaction fill style, pattern-based marking.
16. Export to Excel and PowerPoint (and better Word: pictures, tables, columns); Excel matters for schedules and bills of quantities. DONE (best effort; see Convert tab).
17. Auto-generate bookmarks from headings or a table of contents, bookmark colour/bold/italic, import/export; set destination from the current view.
18. Delete blank pages automatically, delete extracted pages from the source, swap pages, insert pages from clipboard or scanner.
19. Add QR codes and barcodes to pages and as form fields. (Done: QR code, Code 128, Code 39 and EAN-13 as page content or stamp annotations, and as a barcode form field; DataMatrix is not offered.)
20. Fillable form gaps: date-picker and image fields, align/distribute/duplicate of fields, fields pane, document and open/save/print scripts, submit action, populate from CSV for many records. (Done except the open/close/save/print document scripts and a console window.)
21. Scanner support: named presets, duplex (where reported), paper size, deskew, speck removal, auto-crop and insert scanned pages into the open document are done (WIA only, hardware-untested). Still missing: TWAIN (needs a native module or helper, not feasible here) and OCR table detection.
22. Document properties: Initial View (open on page, zoom, pane), fonts list, custom properties, Advanced print presets. DONE, except trapped, base URL and document actions.
23. Edit-content depth: image rotate, flip, crop, opacity and export, shape recolour, line width and opacity, text format changes (font, size, colour, bold, italic) and a Content pane are DONE. Still open: text and objects inside form XObjects, draggable crop handles, text spacing and alignment.
24. Open from URL and restore previous session are DONE; send by e-mail is PARTIAL (the file cannot be attached without native mail code). Later, direct SharePoint and OneDrive connection with check in/out (needs app registrations).
25. Workspace comfort: Fit Visible zoom, loupe, split view and settings import/export are DONE. Still open: pan and zoom window, tab groups/new window, right-to-left and gaps options, quick-access toolbar and customisable ribbon (left for later on purpose).

## Remaining work batches

Re-audited 17/10/2026. Every PARTIAL or MISSING row above falls into one of these six batches, ordered by everyday value for an office user who marks up drawings, measures, stamps, combines, prints, fills forms and signs. Rows marked "Out of scope" are listed at the end with the reason. Each brief is written to be handed to an implementer; read CLAUDE.md first (clean room, MIT, PDFium reads and pdf-lib writes, new UI text in `t('...')`, run `bash scripts/check.sh` before committing).

### Batch 1: Markup, measuring and stamps finishing

Status 17/10/2026: done (checked flag, group by subject, Subject, Layer and review history in Properties, style set import and export, note icons, text correction, Alt+Down and Alt+Up between comments, hiding other tools' annotations, label text, angle tool and 15 degree Shift on measurements, scale list import and export, docked stamp palette, cut, copy and paste of annotations). Left out on purpose: a docked styles pane (the brief called it optional). Not yet hand-tested on a real drawing set: the on-screen look of the Help, Key and Paragraph icons, and how other viewers draw an angle.

Code areas: `annotations.ts`, `annotWrite.ts`, `AnnotLayer.tsx`, `CommentsPane.tsx`, `commentList.ts`, `commentStyle.ts`, `PropertiesPanel.tsx`, `MeasureLayer.tsx`, `measure*.ts`, `StampPicker.tsx`. Rows: comments Show, Comments list, Styles palette, Properties, Text correction, Sticky note icons, Measure (label, angle, constraint), Stamp palette pane, Clipboard.
Brief: finish the everyday markup loop. Add a "checked" flag saved in the file (a marked/checked state shown as a tick in the list, filterable), group by subject, and Subject, Layer and a simple review-history list in the Properties panel (read the state and reply dates already stored). Add import and export of comment style sets (JSON file, same shape as the saved presets) and optionally a docked styles pane. Add a choice of note icon (Comment, Note, Help, Key, Paragraph, Insert) written as /Name. Add a text-correction tool that marks text for deletion and insertion as a linked strikeout plus caret with one reply thread. Add a window-wide shortcut for next/previous comment, and let annotations from other tools be hidden through the same hide mechanism. For measuring: draw the label (or the value) as text next to a measurement on the page, add an angle tool (three points, result in degrees, listed in the Measurements pane and CSV), and a 15 degree step option for Shift. Let the saved scale list be exported and imported on its own. Stamps: optionally dock the palette as a side pane. Clipboard: cut, copy and paste of selected annotations (same page or another), keeping the offset.

### Batch 2: Page organisation, print and file handling

Code areas: `PageOpsDialogs.tsx`, `PageMarksDialog.tsx`, `pageOps.ts`, `pageDialogLogic.ts`, `PrintDialog.tsx`, `print.ts`, `src/main/index.ts` (print, file), Sidebar bookmark tools. Rows: Insert, Merge pages, Crop, Watermark, Header and footer, Print, New document, Revert, Rename / move to trash, Bookmarks.
Brief: Print: choice of layers (visible, all, as in the file) and a text-preserving Save as PDF (write the selected pages with pdf-lib instead of rasterising; keep the raster path for stubborn files). Insert: odd/even subset of the source range and an option for what happens to the inserted pages' comments, form fields and bookmarks. Crop: auto-trim white margins (reuse `contentBox.ts`), permanent removal of cropped content, odd/even separately. Watermark and Header/footer: saved presets (stored with Settings), offsets and alignment, tiling, first page different, margin per side, shrink to fit, date format choices (reuse `formatDate` from `stampLogic.ts`). Merge pages (join two half pages side by side or stacked into one). Bookmarks: cut, copy and paste, extract or print the pages of a bookmark, a validate command that lists bookmarks pointing nowhere, and Go-to and Named-destination actions. File: a new blank document (page size and count), a one-click Revert to saved for the whole document (reload from disk after confirmation), and rename or move to the Recycle Bin from the File menu using `shell.trashItem` in the main process. Status 17/10/2026: implemented. Left over: crop does not strip the cropped text and pictures from the content stream (it shrinks the page and drops outside notes), insert has no "insert text directly", bookmarks have no case change or sort, and printing to a physical printer still sends 300 dpi pictures (only Save as PDF keeps the text).

### Batch 3: Forms, links, signing and security

Code areas: `FormLayer.tsx`, `FieldDialog.tsx`, `FieldsPane.tsx`, `formArrange.ts`, `formSubmit.ts`, `docScripts.ts`, `acrobatJs.ts`, `SignDialog.tsx`, `SignaturesDialog.tsx`, `sign.ts`, `SecurityDialog.tsx`, `redact.ts`, `RedactDialogs.tsx`, `DocPropsDialog.tsx`, `docExtras.ts`. Rows: Select / edit fields, Email form data, JavaScript console and document actions, Links, Timestamp / clear all, Redaction, Security policies, Document properties.
Brief: Forms: move a multi-selection as a group, edit common properties of several fields at once, drag-select on the page, clear an image field. Add Email form data (build FDF or XFDF, save it, start a message the way `FileDialogs.tsx` does for Send by e-mail). Add document actions (open, close, before and after save, before and after print) stored in the catalogue /AA and /OpenAction and run in the existing script sandbox, plus a read-only console window showing `console.println` output. Links: add file, JavaScript and named-destination actions to the Link dialog, auto-link URLs found in text, remove all web links, a batch link command and links from barcodes. Signing: a Clear all signatures command (with confirmation, flattening the visible appearance only if asked) and long-term validation data (embed the OCSP and CRL responses found in the chain) when the time-stamp is added. Redaction: apply a single selected mark, not only all marks. Security: saved security policies (named permission and password-method sets stored in Settings; never store the passwords) and certificate encryption only if a permissive library is found. Properties: base URL and a Trapped control.

### Batch 4: View, workspace and application shell

Code areas: `Viewer.tsx`, `pageLayout.ts`, `DocView.tsx` (View tab, panes), `App.tsx` (tabs), `Sidebar.tsx`, `Presentation.tsx`, `AppDialogs.tsx`, `src/main/settings.ts`, `src/main/index.ts` (windows). Rows: Page display, rulers and grid, Thin lines, Zoom tools, Split views, Page transitions, Document tabs, Toolbars, Preferences, Manage settings, Floating panes, Document recovery pane, Destinations pane.
Brief: View: right-to-left page order and a gaps toggle in `pageLayout.ts`; a page size and position readout in the status bar; a transparency grid; a thin-lines option (render with PDFium's no-smooth-path flag or a minimum stroke width, as a per-view setting); a pan and zoom window (small overview with a draggable viewport rectangle); page transitions and autoscroll in presentation mode. Make the second split view able to show comment overlays and fields, and add a four-way split if the cost is modest. Tabs: groups, open in a new window (a second BrowserWindow handed the file) and drag a tab out. Shell: a customisable quick-access toolbar first (saved in Settings), then ribbon customisation, floating or detachable panes, a Destinations pane (list, add, rename, go to, delete named destinations) and a Recovery pane listing snapshots with preview. Preferences: add the missing categories in this order: page display defaults, search providers, identity, launch applications, performance; add Reset settings to defaults.

### Batch 5: Convert, content editing and optimisation

Code areas: `CreateDialog.tsx`, `createPdf.ts`, `src/main/convert.ts`, `OptimiseDialog.tsx`, `optimise.ts`, `pdfa.ts`, `ocrLayer.ts`, `OcrDialog.tsx`, `scanProcess.ts`, `textEdit.ts`, `ObjectEditLayer.tsx`, `ContentPane.tsx`, `imageEdit.ts`, `layers.ts`, `media.ts`. Rows: New document and Create from RTF/text/blank, Rasterise, Convert colours, Replace fonts, Recompress, PDF/A and PDF/X, OCR, Enhance, Create from Word/Excel, Edit text, Edit images, Edit shapes, Align, Format, Layers, Content pane, Media.
Brief: Convert: create from RTF, Markdown and CSV (text-based, through the existing text-to-PDF path); a Rasterise pages command (render with PDFium at a chosen dpi, rebuild pages); Convert colours to grey (and to CMYK or RGB only as an approximate device conversion, stated in the dialog); Replace fonts across the document (map a font to an installed or standard one, using `embeddedFont.ts`); a content find and replace for text and fonts. Optimise: stand-alone Recompress images and, if a permissive encoder exists, CCITT or JBIG2 for black and white scans. Standards: PDF/A-1b and A-3 and a first PDF/X-1a or X-4 check and convert, each described as best effort. OCR and clean-up: table detection hints, a searchable-image versus replace-text output choice, and running straighten, despeckle and crop on pages already in the document. Edit content: draggable crop handles for pictures, dash and shading for shapes, align and distribute of page objects, multi-select and rename in the Content pane, text spacing and alignment, and objects and text inside form XObjects. Layers: set default visibility (written to /OCProperties /D), edit, merge and flatten layers, assign comments to layers. Media: add video and sound (MP4 or WAV, or other formats when listed in `media.ts`) as Screen or RichMedia annotations.

### Batch 6: Accessibility and proofing

Code areas: `standards.ts`, `StandardsDialog.tsx`, a new tags pane in `Sidebar.tsx`, `pdfiumRaw.ts` (structure tree reads), `TextEditLayer.tsx` (spell check), `PortfolioDialog.tsx`, `portfolio.ts`. Rows: Accessibility, Spell check, Word count, Proofing, Tags pane, Portfolio.
Brief: build a Tags pane that shows the structure tree (type, title, alt text, page) read through pdf-lib, with selection that highlights the element on the page; edit alt text and the tag type, reorder siblings (reading order), mark an element as an artefact, and set the document language and title. Extend the Standards dialog into a full accessibility checker with a saved report (HTML or CSV) listing each failure with its page and a Go to button. Add a document spell-check pane (walk the page text, offer suggestions from the existing dictionary, ignore and add to dictionary) and a Word count command (words, characters, pages, from the cached page text in `pdfClient.ts`). Portfolio: layout views (list with thumbnails), folders inside a portfolio and thumbnails of the embedded PDFs.

### Out of scope (not planned)

- Cloud check in/out for SharePoint or other services, and direct cloud API sign-in for Open: needs per-provider app registrations, secrets and sign-in flows tied to proprietary services. Synced folders already open through Places.
- TWAIN scanning: needs a native TWAIN binding or bundled native helper (the project does not add native code). WIA covers most office scanners.
- DocuSign and similar online signing services: proprietary services with their own terms and keys. Certificate and visual signatures are built in.
- Attaching a file directly to an e-mail message: needs native mail code (MAPI) that is not used. The file is shown in Explorer to drag in.
- 3D content authoring: no permissive open component for writing 3D annotations; existing 3D is listed and not played.
- Certificate (public-key) encryption and JBIG2 encoding: only if a permissive pure-JavaScript library is found after a licence check; otherwise leave out.
