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
| Open | Local, recent, restore previous session, cloud accounts, open from URL | PARTIAL | Recent list, tabs, drag and drop, Places (synced OneDrive/SharePoint/Dropbox/Google Drive folders) exist. Missing: open from URL, restore previous session, direct cloud API sign-in |
| Save / Save As | Save options, save copy | DONE | Atomic write, Save As dialog |
| New document | Blank, from text, RTF, images, scanner, combine files | PARTIAL | Convert tab has images, text, web page, clipboard, screenshot, Office (via LibreOffice), scan. Missing: blank document, RTF, Markdown, CSV, XPS, WMF |
| Print | Printer, ranges, copies, scaling, booklet, N-up, comments, preview | PARTIAL | Printer choice, range, odd/even, copies, fit/actual/custom scale, orientation, N-up, booklet, preview, 300 dpi. Print what: document, document and comments, comments only; comments with the Printable flag off are left out. Pages always print as 300 dpi pictures, so "print as image" is how every job already works. Missing: print with layers choice, output is raster (no selectable text in print-to-PDF), poster/tile printing, advanced printer properties |
| Export | Images, Word, Excel, PowerPoint | PARTIAL | Images (PNG/JPEG/TIFF), text, HTML, Word (best effort). Missing: Excel, PowerPoint; Word has no pictures, tables or columns |
| Share / e-mail | Send by e-mail, SharePoint check in/out | MISSING | No send-by-email, no check in/out |
| Revert | Discard unsaved changes | PARTIAL | Undo/redo and recovery snapshots exist; no one-click "Revert to saved" found |
| Document properties | Description, Fonts, Security, Initial View, Custom, Advanced, Actions, JavaScript | PARTIAL | Description/XMP done; Security via its own dialog. Missing: Fonts list, Initial View, custom keys, Advanced (page scaling, duplex, trapped, base URL), document actions/JavaScript |
| Rename / move to trash | Rename or delete the file | MISSING | Not present |
| Close / Exit | One or all | DONE | Unsaved prompt |
| Preferences | About 35 categories | PARTIAL | Settings has theme, language, author, recovery interval, spellcheck, updates, tool defaults and presets. Missing: most categories (page display defaults, colour management, file associations UI, identity, launch applications, search providers, performance) |
| Manage settings | Export, import, reset | MISSING | Not present |
| Customise UI | Custom ribbons/toolbars, panes, RTL | MISSING | Fixed ribbon; panes dock left/right only; no quick-access toolbar |

## 2. Home tab (tools, view, quick comment, links)

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Hand, Select text, Select comments | Multi-click word/paragraph select, Alt-drag custom area | DONE | |
| Snapshot | Copy area as image | DONE | 200 dpi PNG |
| Clipboard | Cut, copy, paste | PARTIAL | Copy of text and page copy/paste only; no cut/paste of objects |
| Find | Search the document, search the internet | PARTIAL | Match case, whole word, highlight all, find in several files. Missing: regular expressions, search providers, search in comments or bookmarks scope |
| Zoom / fit | Slider, presets, actual size, fit page/width/visible | PARTIAL | Presets, fit page/width, Ctrl+/-. Missing: Fit Visible (trim margins) |
| Rotate view | 90 degrees | DONE | |
| Pane toggles | Bookmarks, Thumbnails, Comments, Attachments, Content, Properties | PARTIAL | See section 12 |
| Edit text | Edit base content text | PARTIAL | Run and paragraph edit with font match. Not in form XObjects; character spacing and horizontal scaling lost; falls back to standard fonts |
| Edit objects | Move/resize/rotate/delete content, images | PARTIAL | See section 6 |
| Add text / image / QR code | Insert new content | PARTIAL | Typewriter, text box, Add image (PNG/JPEG). Missing: QR code, barcode |
| Quick comment tools | Typewriter, note, highlight, arrow, underline, rectangle, stamp | DONE | In Comment/Draw tabs |
| Links | Add/edit links, links from URLs, remove web-links, links from barcodes, batch link | PARTIAL | Link tool (web address or page) and edit. Missing: auto-link URLs in text, remove all web links, link actions other than URL/page (open file, run JavaScript, named destination), batch link |
| Sign Document | From Home | DONE | Under Sign tab |

## 3. Comment tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Typewriter, Text box, Callout | Fonts, colours, borders | DONE | |
| Sticky note, Attach file, Sound | Icons, attachments | PARTIAL | Note icon choice not offered; sound is WAV only; no audio recording |
| Highlight, Underline, Strikeout, Squiggly | From text selection | DONE | |
| Insert text, Replace text (carets) | Caret annotations | DONE | |
| Text correction | Review-style correction tool | MISSING | Replace text covers part of this |
| Line, Arrow, Rectangle, Oval, Polygon, Polyline, Cloud | Fill, dashes, line endings, opacity | DONE | Fill, dash, opacity, line end styles (open/closed/reversed arrows, circle, square, diamond, slash, butt) on lines, arrows and polylines, cloud intensity (none, small, large) on clouds, polygons and rectangles, blend mode (Normal, Multiply, Screen, Overlay, Darken, Lighten) |
| Pencil / Eraser | Freehand, erase | DONE | |
| Stamp tool | Palette with categories, custom stamps from file/selection/document/clipboard, dynamic stamps with JavaScript (Plus), import/export | PARTIAL | 7 text stamps, dated stamps, image stamps from PNG/JPEG library. Missing: stamp categories and palette pane, custom stamps from PDF/selection/clipboard (vector), dynamic stamps with fields (date, sequential number, user name), stamp import/export, favourites, a construction-style set (e.g. "Approved", "Rev A", "Issued for Construction", "As Constructed") |
| Measure: distance, perimeter, area | Scales, calibrate, snap, labels, export to CSV | PARTIAL | See section 7 |
| Media: video, sound, 3D | Add/edit | MISSING | Playback of existing media only (Media pane); cannot add video or 3D |
| Summarise comments | Summary PDF | DONE | Summary PDF and CSV |
| Import / export comments | FDF, XFDF | DONE | |
| Show (filter visibility) | By type, author, status, checked | PARTIAL | List filters by type, author, status, colour; group by page, author, type, colour, date, status; hide and show comments on the page (the view only) from the list. Missing: a "checked" flag saved in the file, group by subject; annotations from other tools ("foreign") cannot be hidden |
| Flatten comments | Selected or range | DONE | Forms tab > Flatten (with options) |
| Delete comments | Selected, visible, all | DONE | Delete selected, delete visible, delete all, each with a confirmation; locked comments are kept |
| Comments list / pane | Group, filter, replies, lock, printable flag, layer | PARTIAL | Sort, group, filter, replies, status (one comment or several at once), select all, next/previous comment (buttons and arrow keys in the list), lock and printable flags (Properties panel). Missing: layer, reset pop-up positions, a window-wide shortcut for next/previous comment |
| Comment styles palette | Save and reuse formatting, set as default | PARTIAL | Named styles (presets) saved from the Properties panel, applied to the selected comments, set as a tool's default; they carry line ends, cloud intensity and blend mode too. Missing: import/export of styles, a separate docked styles pane |
| Properties panel / dialog | Appearance, General, Review history, Actions, Locking | PARTIAL | Colour, fill, opacity, width, style, line ends, cloud border, blend mode, font, size, author, Printable and Locked flags. Missing: subject, layer, review history list, other flags (no zoom) |
| Review status and threads | Replies, status | DONE | |

## 4. Organize tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Insert pages | From file with page range and odd/even subset, destination, actions for comments/forms/bookmarks | PARTIAL | Insert from PDF with range and position. Blank pages (size, count) are offered in the Insert dialog. Missing: insert from clipboard, insert images/scan/text directly, odd/even subset (confirm) |
| Delete pages | Selected, empty pages | PARTIAL | Selected. Missing: delete blank pages automatically |
| Extract | Range to new document, remove from source | PARTIAL | Extract to new PDF. Missing: option to delete from source, extract each page to a file |
| Move, Duplicate, Replace, Copy/paste | Page operations | DONE | Also between documents |
| Swap pages | Exchange two pages | PARTIAL | Move covers the result; no swap command |
| Merge pages | Combine split pages | MISSING | Merge is of documents only |
| Split document | Every n pages, by bookmarks (level), by size | DONE | Also with file name pattern |
| Split pages | Cut each page into tiles by percentage or measure, crop box or physical | MISSING | Not present |
| Overlay | Layer pages of another document over this one | MISSING | Only watermark/background |
| Rotate | Dialog: pages, odd/even, landscape/portrait | DONE | |
| Crop | Dialog and crosshair tool; remove cropped content | PARTIAL | Margins and drag crop, remove cropping. Missing: auto-trim white margins, "remove cropped content permanently", crop odd/even separately in the tool |
| Resize | Paper size, scaling | DONE | |
| Watermark | Text/image, font, colour, opacity, angle, position, page range, saved settings, remove | PARTIAL | Text/picture, angle, opacity, behind/over, pages, removable. Missing: saved watermark presets, offsets/alignment control, tiling, scale to fit options, first-page-different |
| Background | Colour, image, placement | DONE | |
| Header and footer | Six positions, fonts, date, page number format, ranges, saved settings | PARTIAL | Slots, codes, font, colour, margin, pages. Missing: saved presets, margin per side, shrink-to-fit, date format choices (check codes) |
| Bates numbering | Single and multiple files, preview, naming, log | PARTIAL | Single document with prefix/number. Missing: across multiple files with continuous numbering (batch has no Bates step), preview, output file renaming, log |
| Number pages / page labels | Label ranges | DONE | |
| Optimise | File size, image downsampling, linearise | DONE | |
| Compare documents (Plus) | Text and style changes, summary | DONE | Word-level and visual; no style (font/colour) changes |

## 5. Convert tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Scan | Scanner presets, colour mode, dpi, paper size, source, duplex | PARTIAL | WIA only: scanner's own window, glass, feeder, colour mode, dpi. Missing: TWAIN, named presets, duplex and paper size controls, scan straight into an open document (inserts as new document) |
| Combine files into one PDF | Mixed formats | DONE | File and Organise tabs: PDFs, pictures and Office files (LibreOffice) with page ranges, drag/arrow ordering, sort, add folder, bookmarks, new tab or save |
| Create from text / RTF / images / blank | | PARTIAL | Images and text only (see File) |
| Rasterise pages | Flatten vector to image | MISSING | |
| Recompress images | | PARTIAL | In Optimise (JPEG reduction), not a standalone tool; no JBIG2/CCITT |
| Replace fonts | Substitute fonts | MISSING | Only used inside PDF/A conversion |
| Export to images | Formats, dpi | DONE | |
| Export to Word / Excel / PowerPoint | | PARTIAL | Word only, text and headings; no Excel, no PowerPoint |
| OCR pages | Languages, page ranges, engine choice (Plus: enhanced), table lines | PARTIAL | Languages, page range, dpi, skip pages with text. Missing: table detection, output options (searchable image vs. replace), deskew first, enhanced engine |
| Enhance scanned pages / Deskew | Clean-up, straighten | MISSING | |
| Convert colours | To grey/CMYK/RGB | MISSING | |
| PDF/A, PDF/X conversion | | PARTIAL | PDF/A-2b best effort. No PDF/X, no A-1/A-3 |
| Create from Word/Excel | Print driver | PARTIAL | Via LibreOffice if installed |

## 6. Edit / content tools (PDF-XChange Home and Format)

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Edit images | Move, resize, rotate, replace, crop, delete | PARTIAL | Move, resize, replace, delete. Missing: rotate, crop, images in form XObjects, other formats |
| Edit shapes / objects | Select, transform, recolour, line width | PARTIAL | Move, resize, delete only. Missing: stroke/fill recolour, dash, shading, objects in form XObjects |
| Align, distribute, order | | DONE | Annotations only; not page-content objects |
| Format tab (font, size, colour, spacing, paragraph) | Context-sensitive text formatting | PARTIAL | Edit text keeps the font; missing: change font/size/colour/alignment of existing text |
| Spell check | Pane and as-you-type | PARTIAL | As-you-type in text boxes. Missing: document spell-check pane |
| Word count | | MISSING | |
| Layers | Show/hide, set visibility, assign comments | PARTIAL | View show/hide. Missing: set default visibility, edit layers, merge/flatten |
| Content pane (object tree) | List of page objects | MISSING | |
| Font replacement and page-content search/replace | | MISSING | |

## 7. Measurement

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Distance, perimeter, area | Pop-up result, info pane, saved as measurement annotations | DONE | |
| Calibrate and scales | Calibrate by known distance; scale list (activate, clone, delete, import/export); document scales | PARTIAL | Calibrate, document /VP scales, paper scale. Missing: named scale list (e.g. 1:100, 1:500 with stored presets), preset scale ratios, per-page scales, scale import/export |
| Units and precision | Choose units, decimals | PARTIAL | mm/cm/in/pt rulers; calibrated unit typed. Missing: precision control, unit conversion between m and mm results |
| Snapping | Grid, guides, object snap with threshold | PARTIAL | Grid and guides. Missing: snap to page content (endpoints, lines in vector drawings) |
| Angle constraint | Shift for 15 degree steps | PARTIAL | Shift gives 45 degree steps |
| Labels and styling | Text labels, colour, border, line ends | PARTIAL | Styling in Properties; no label text on a measurement |
| Export measurements | CSV | PARTIAL | Copy all as text. Missing: CSV file export |
| Count tool, angle tool, 3D measurement | (Count/angle: not confirmed in the manual pages read) | MISSING | |
| Rulers, grid, guides | | DONE | |

## 8. Form tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Field types | Text, button, check, radio, list, dropdown, date, barcode, image, digital signature | PARTIAL | Text, check, radio, dropdown, list, button, signature. Missing: date picker field (format scripts give date text), barcode, image field |
| Select / edit fields | Move, resize, properties, align, duplicate | PARTIAL | Select, move, resize, delete, properties. Missing: align/distribute/duplicate/copy across pages, multi-select with common properties |
| Highlight fields, grid, fields pane | | PARTIAL | Highlight present. No fields pane list, grid for form design uses View grid |
| Reset, import, export | FDF, XFDF, CSV, XML | DONE | |
| Email form data | | MISSING | |
| Populate from CSV (Plus-style) | Merge many records | MISSING | Import fills one record |
| Form identification (Plus) | Detect fields | DONE | Detect fields with confirm |
| Calculations, validation, formats | | DONE | Presets and custom scripts in a sandbox |
| JavaScript console, document JS, document actions | | PARTIAL | Field scripts only. No console, document-level or open/close/save/print scripts, submit action |
| Tab order | | DONE | |
| Fill and save | Fill, flatten | DONE | |
| Placeholder tool (Plus) | Mark where signature/initials go | DONE | Sign tab: Sign here and Initial here markers (stamps) |

## 9. Protect tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Sign document, place signature | Certificate store or file, appearance | DONE | Visible and invisible, time-stamp |
| Certify | Visible or invisible, change permissions | DONE | |
| Timestamp, validate all, clear all | | PARTIAL | Time-stamp and validate in panel. Missing: "clear all signatures" command, LTV |
| Signature and initials library | Drawn/typed/image signatures stored, place and apply all | DONE | Sign tab: draw (smoothed), type (installed script fonts) or import a picture (white to transparent, trim); library with rename/delete; click or drag to place; several pages; flatten. Visual only, not a certificate signature |
| Mark for redaction, apply, find and redact | Patterns: phone, card numbers, SSN, emails, dates | PARTIAL | Area, selected text, search results; apply selected vs all not offered. Missing: pattern presets, redaction code/overlay text, redaction styling, apply to a selected mark only |
| Sanitise | Metadata etc. | DONE | |
| Security properties, policies | Passwords, permissions, certificate security | PARTIAL | AES-256/128 passwords and permissions. Missing: security policies (saved), certificate encryption |
| DocuSign | | MISSING | Out of scope for an open project (proprietary service) |

## 10. Share, Review, Accessibility, Bookmarks, Portfolio tabs

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Send by e-mail | | MISSING | |
| SharePoint check in/out | | MISSING | Files in synced folders open normally |
| Proofing: spell check, word count, text correction | | PARTIAL | As-you-type spell check only |
| Compare documents | | DONE | |
| Comments review (add, next/previous, show, flatten) | | PARTIAL | Next/previous comment buttons and arrow keys in the Comments pane |
| Accessibility: reading order, tags pane, alt text, checker, report | | PARTIAL | Standards dialog reads tagging, language, alt text counts. Missing: tags pane, reading order editing, alt text editing, full checker report |
| Bookmarks editing | New, delete, rename, destinations, style (colour/bold/italic), import/export, generate from text, nth-page, case change, sort, validate | PARTIAL | Insert, rename, delete, move, indent, outdent. Missing: colour/bold/italic, actions, set destination from selection, import/export, auto-generate from headings, cut/copy/paste, extract/print pages by bookmark |
| Portfolio | Create, navigator, edit | PARTIAL | Create, list, add, save, remove. Missing: layout views, custom folders, thumbnails |
| Page labels | | DONE | |

## 11. View tab

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Go to / previous view / next view | Page box, first/last | DONE | |
| Zoom tools | Continuous zoom, zoom in/out tool, loupe, pan and zoom | PARTIAL | Marquee zoom tool, presets. Missing: loupe, pan and zoom window |
| Page display | Single, continuous, two pages, cover, gaps, right-to-left | PARTIAL | Single, continuous, two, cover. Missing: gaps toggle, right-to-left |
| Show rulers, grid, guides, snapping, page size/position | | PARTIAL | Missing: page size/position display, transparency grid |
| Thin lines | Hairline rendering | MISSING | |
| Split views | Two views of one document | MISSING | |
| Page transitions, autoscroll | | MISSING | Presentation mode (F5) exists |
| Document tabs | Group, new window, close options | PARTIAL | Tabs exist; missing: tab groups, open in new window, drag a tab out |
| Full screen, reading mode, night/high-contrast colours | | DONE | |
| Read aloud | | DONE | |
| Toolbars / ribbon layout | | MISSING | See File |

## 12. Side panes and dialogs

| Feature | PDF-XChange options (brief) | OpenPDF status | Gaps |
|---|---|---|---|
| Thumbnails | Drag reorder, size, context menu | DONE | |
| Bookmarks pane | See section 10 | PARTIAL | |
| Comments pane | See section 3 | PARTIAL | |
| Attachments pane | Add, save, open | DONE | Add, save all, remove |
| Layers pane | | PARTIAL | See section 6 |
| Signatures pane | List, validate, properties | DONE | Panel in a dialog rather than a docked pane |
| Fields pane | List of fields | MISSING | |
| Destinations pane | Named destinations | MISSING | |
| Stamps pane and palette | | PARTIAL | Picker popup only |
| Comment styles pane | | MISSING | |
| Content pane | | MISSING | |
| Tags pane | | MISSING | |
| Document recovery pane | | PARTIAL | Recovery snapshots on restart; no pane |
| Properties pane | Object properties | DONE | Properties panel (Ctrl+E) |
| Search results pane | | DONE | |
| Floating / detachable panes | | MISSING | Docked left or right only |

## Counts

Counted from the tables above (one count per row).

DONE 45, PARTIAL 72, MISSING 34 (total 151 rows). Several rows repeat a feature seen from two tabs (Compare, Flatten, bookmarks), so treat the counts as a guide.

## Top 25 gaps for a construction-company office user

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
16. Export to Excel and PowerPoint (and better Word: pictures, tables, columns); Excel matters for schedules and bills of quantities.
17. Auto-generate bookmarks from headings or a table of contents, bookmark colour/bold/italic, import/export; set destination from the current view.
18. Delete blank pages automatically, delete extracted pages from the source, swap pages, insert pages from clipboard or scanner.
19. Add QR codes and barcodes to pages and as form fields.
20. Fillable form gaps: date-picker and image fields, align/distribute/duplicate of fields, fields pane, document and open/save/print scripts, submit action, populate from CSV for many records.
21. Scanner support: named presets, duplex, paper size, TWAIN, insert scanned pages into the open document; plus OCR table detection and a deskew/enhance step.
22. Document properties: Initial View (open on page, zoom, pane), fonts list, custom properties, Advanced print presets.
23. Edit-content depth: image rotate and crop, shape recolour and line width, text format changes (font, size, colour), text inside form XObjects, a content/object pane.
24. Send by e-mail with the file attached, and open from URL / restore previous session; later, direct SharePoint and OneDrive connection with check in/out (needs app registrations).
25. Workspace comfort: Fit Visible zoom, loupe, pan and zoom window, split view, tab groups/new window, right-to-left and gaps options, quick-access toolbar and customisable ribbon, settings import/export.
