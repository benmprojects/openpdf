/**
 * The part of the Acrobat Forms JavaScript API that form scripts commonly use, written in plain JavaScript so it can
 * run inside the QuickJS sandbox. It knows nothing of the host: the form's state arrives as JSON in `__input`, the
 * script runs, and what changed leaves as one JSON string. Scripts cannot reach files, the network, or the app.
 *
 * Covered: event (value, rc, change, willCommit, target, name), this.getField and field.value, the AF format,
 * keystroke, calculation and validation helpers, util.printd/scand, app.alert (recorded, not shown by the sandbox).
 */

export const ACROBAT_PRELUDE = String.raw`
var __input = JSON.parse(__inputJson);
var __alerts = [];
var __log = [];
var __changed = {};
var __state = {};
var __numeric = {};
(function () {
  var fs = __input.fields;
  for (var i = 0; i < fs.length; i++) { __state[fs[i].name] = fs[i]; }
})();

function Field(name) {
  var self = this;
  var st = __state[name];
  this.name = name;
  this.type = st ? st.type : 'text';
  Object.defineProperty(this, 'value', {
    get: function () {
      var v = __state[name] ? __state[name].value : '';
      if (st && st.numeric && typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
      return v;
    },
    set: function (v) {
      if (!__state[name]) return;
      if (__state[name].readOnly) return;
      __state[name].value = v;
      __changed[name] = v;
    }
  });
  Object.defineProperty(this, 'valueAsString', { get: function () { var v = __state[name] ? __state[name].value : ''; return v == null ? '' : String(v); } });
  Object.defineProperty(this, 'readonly', { get: function () { return !!(st && st.readOnly); } });
  this.setFocus = function () {};
  this.setAction = function () {};
  this.checkThisBox = function (n, b) { if (__state[name]) { __state[name].value = b !== false; __changed[name] = b !== false; } };
}

var __doc = {
  getField: function (name) { return __state[name] ? new Field(name) : null; },
  get numFields() { return __input.fields.length; },
  getNthFieldName: function (n) { var f = __input.fields[n]; return f ? f.name : null; },
  resetForm: function (names) {
    var list = names ? (Array.isArray(names) ? names : [names]) : __input.fields.map(function (f) { return f.name; });
    for (var i = 0; i < list.length; i++) {
      var s = __state[list[i]];
      if (!s || s.readOnly) continue;
      s.value = s.type === 'checkbox' ? false : s.type === 'list' ? [] : '';
      __changed[list[i]] = s.value;
    }
  },
  calculateNow: function () {},
  print: function () {},
  pageNum: 0,
  numPages: __input.pages || 1,
  documentFileName: __input.fileName || '',
  dirty: false
};

var app = {
  alert: function (msg) { __alerts.push(String(msg)); return 1; },
  beep: function () {},
  launchURL: function () {},
  response: function () { return null; },
  viewerType: 'Reader',
  viewerVersion: 11
};
var console = { println: function (s) { __log.push(String(s)); }, show: function () {}, clear: function () {}, hide: function () {} };

var __months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var __days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function __pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

var util = {
  printd: function (fmt, d) {
    if (typeof fmt === 'number') {
      fmt = ['m/d', 'm/d/yy', 'mm/dd/yy', 'mm/yy', 'd-mmm', 'd-mmm-yy', 'dd-mmm-yy', 'yy-mm-dd', 'mmm-yy', 'mmmm-yy', 'mmm d, yyyy', 'mmmm d, yyyy', 'm/d/yy h:MM tt', 'm/d/yy HH:MM'][fmt] || 'm/d/yy';
    }
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    return String(fmt).replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|HH|H|hh|h|MM|M|ss|s|tt|t/g, function (t) {
      switch (t) {
        case 'yyyy': return __pad(d.getFullYear(), 4);
        case 'yy': return __pad(d.getFullYear() % 100, 2);
        case 'mmmm': return __months[d.getMonth()];
        case 'mmm': return __months[d.getMonth()].slice(0, 3);
        case 'mm': return __pad(d.getMonth() + 1, 2);
        case 'm': return String(d.getMonth() + 1);
        case 'dddd': return __days[d.getDay()];
        case 'ddd': return __days[d.getDay()].slice(0, 3);
        case 'dd': return __pad(d.getDate(), 2);
        case 'd': return String(d.getDate());
        case 'HH': return __pad(d.getHours(), 2);
        case 'H': return String(d.getHours());
        case 'hh': return __pad(d.getHours() % 12 || 12, 2);
        case 'h': return String(d.getHours() % 12 || 12);
        case 'MM': return __pad(d.getMinutes(), 2);
        case 'M': return String(d.getMinutes());
        case 'ss': return __pad(d.getSeconds(), 2);
        case 's': return String(d.getSeconds());
        case 'tt': return d.getHours() < 12 ? 'am' : 'pm';
        case 't': return d.getHours() < 12 ? 'a' : 'p';
      }
      return t;
    });
  },
  scand: function (fmt, str) { return __parseDate(str, fmt); },
  printx: function (fmt, s) { return String(s); }
};

function __parseDate(str, fmt) {
  if (str == null) return null;
  str = String(str).trim();
  if (!str) return null;
  var groups = [];
  var src = String(fmt || '').replace(/[.*+?^$()|[\]{}\\\/]/g, function (c) { return '\\' + c; });
  src = src.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|HH|H|hh|h|MM|M|ss|s|tt|t/g, function (t) {
    groups.push(t);
    if (t === 'yyyy') return '(\\d{4})';
    if (t === 'yy') return '(\\d{2})';
    if (t === 'mmmm' || t === 'mmm') return '([A-Za-z]+)';
    if (t === 'dddd' || t === 'ddd') return '([A-Za-z]+)';
    if (t === 'tt' || t === 't') return '([AaPp][Mm]?)';
    return '(\\d{1,2})';
  });
  var y = null, mo = null, d = null, h = 0, mi = 0, s = 0, pm = null;
  var m = fmt ? new RegExp('^\\s*' + src + '\\s*$').exec(str) : null;
  if (m) {
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i], v = m[i + 1];
      if (g === 'yyyy') y = Number(v);
      else if (g === 'yy') y = Number(v) < 50 ? 2000 + Number(v) : 1900 + Number(v);
      else if (g === 'mm' || g === 'm') mo = Number(v) - 1;
      else if (g === 'mmm' || g === 'mmmm') { mo = -1; for (var k = 0; k < 12; k++) if (__months[k].toLowerCase().indexOf(v.toLowerCase().slice(0, 3)) === 0) mo = k; if (mo < 0) return null; }
      else if (g === 'dd' || g === 'd') d = Number(v);
      else if (g === 'HH' || g === 'H' || g === 'hh' || g === 'h') h = Number(v);
      else if (g === 'MM' || g === 'M') mi = Number(v);
      else if (g === 'ss' || g === 's') s = Number(v);
      else if (g === 'tt' || g === 't') pm = /^[Pp]/.test(v);
    }
  } else {
    var a = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(str);
    var b = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/.exec(str);
    if (b) { y = Number(b[1]); mo = Number(b[2]) - 1; d = Number(b[3]); }
    else if (a) {
      // Day first (the Australian order), unless the first number cannot be a day.
      var n1 = Number(a[1]), n2 = Number(a[2]);
      var dayFirst = !(fmt && /^m/.test(fmt)) || n1 > 12;
      d = dayFirst ? n1 : n2; mo = (dayFirst ? n2 : n1) - 1;
      y = Number(a[3]); if (a[3].length === 2) y = y < 50 ? 2000 + y : 1900 + y;
    } else { var t = new Date(str); return isNaN(t.getTime()) ? null : t; }
  }
  if (pm !== null) { if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  if (y === null) y = new Date().getFullYear();
  if (mo === null) mo = 0;
  if (d === null) d = 1;
  var out = new Date(y, mo, d, h, mi, s);
  if (out.getMonth() !== mo || out.getDate() !== d) return null;
  return out;
}

function AFMakeNumber(v) {
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (v == null) return null;
  var s = String(v).trim();
  if (!s) return null;
  var neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) { if (lc > ld) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); }
  else if (lc >= 0) { if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ''); else s = s.replace(',', '.'); }
  var n = Number(s);
  if (isNaN(n) || s === '') return null;
  return neg ? -n : n;
}

function __groupDigits(intp, group) { return group ? intp.replace(/\B(?=(\d{3})+(?!\d))/g, group) : intp; }

function AFNumber_Format(nDec, sepStyle, negStyle, currStyle, strCurrency, bCurrencyPrepend) {
  var v = event.value;
  if (v === '' || v == null) return;
  var n = AFMakeNumber(v);
  if (n === null) { event.value = ''; return; }
  var neg = n < 0; n = Math.abs(n);
  var parts = n.toFixed(nDec).split('.');
  var group = sepStyle === 0 ? ',' : sepStyle === 2 ? '.' : sepStyle === 4 ? "'" : '';
  var dec = sepStyle === 2 || sepStyle === 3 ? ',' : '.';
  var out = __groupDigits(parts[0], group) + (parts[1] ? dec + parts[1] : '');
  if (strCurrency) out = bCurrencyPrepend === false ? out + ' ' + strCurrency : strCurrency + out;
  if (neg && Number(parts.join('.')) !== 0) out = negStyle >= 2 ? '(' + out + ')' : '-' + out;
  event.value = out;
}
function AFNumber_Keystroke() {
  if (!event.willCommit) return;
  if (event.value === '' || event.value == null) return;
  if (AFMakeNumber(event.value) === null) { event.rc = false; app.alert('The value must be a number.'); }
}
function AFPercent_Format(nDec, sepStyle) {
  var v = event.value;
  if (v === '' || v == null) return;
  var n = AFMakeNumber(v);
  if (n === null) { event.value = ''; return; }
  event.value = String(n * 100);
  AFNumber_Format(nDec, sepStyle, 0, 0, '', true);
  event.value = event.value + '%';
}
function AFPercent_Keystroke() { AFNumber_Keystroke(); }

function AFDate_FormatEx(fmt) {
  var v = event.value;
  if (v === '' || v == null) return;
  var d = __parseDate(v, fmt);
  event.value = d ? util.printd(fmt, d) : '';
}
function AFDate_Format(i) { AFDate_FormatEx(['m/d', 'm/d/yy', 'mm/dd/yy', 'mm/yy', 'd-mmm', 'd-mmm-yy', 'dd-mmm-yy', 'yy-mm-dd', 'mmm-yy', 'mmmm-yy', 'mmm d, yyyy', 'mmmm d, yyyy', 'm/d/yy h:MM tt', 'm/d/yy HH:MM'][i] || 'm/d/yy'); }
function AFDate_KeystrokeEx(fmt) {
  if (!event.willCommit) return;
  if (event.value === '' || event.value == null) return;
  if (!__parseDate(event.value, fmt)) { event.rc = false; app.alert('The date must be in the form ' + fmt + '.'); }
}
function AFDate_Keystroke(i) { AFDate_KeystrokeEx(['m/d', 'm/d/yy', 'mm/dd/yy', 'mm/yy', 'd-mmm', 'd-mmm-yy', 'dd-mmm-yy', 'yy-mm-dd', 'mmm-yy', 'mmmm-yy', 'mmm d, yyyy', 'mmmm d, yyyy', 'm/d/yy h:MM tt', 'm/d/yy HH:MM'][i] || 'm/d/yy'); }
function AFTime_FormatEx(fmt) {
  var v = event.value;
  if (v === '' || v == null) return;
  var d = __parseDate(String(v), fmt);
  if (!d) { var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(String(v).trim()); if (m) { var h = Number(m[1]); if (m[4]) { var p = /^[Pp]/.test(m[4]); if (p && h < 12) h += 12; if (!p && h === 12) h = 0; } d = new Date(2000, 0, 1, h, Number(m[2]), Number(m[3] || 0)); } }
  event.value = d ? util.printd(fmt, d) : '';
}
function AFTime_Format(i) { AFTime_FormatEx(['HH:MM', 'h:MM tt', 'HH:MM:ss', 'h:MM:ss tt'][i] || 'HH:MM'); }
function AFTime_KeystrokeEx(fmt) { if (!event.willCommit || event.value === '') return; var m = /^\d{1,2}:\d{2}(:\d{2})?\s*([AaPp][Mm])?$/.test(String(event.value).trim()); if (!m) { event.rc = false; app.alert('The time must be in the form ' + fmt + '.'); } }
function AFTime_Keystroke(i) { AFTime_KeystrokeEx(['HH:MM', 'h:MM tt', 'HH:MM:ss', 'h:MM:ss tt'][i] || 'HH:MM'); }

function AFSpecial_Format(psf) {
  var v = event.value;
  if (v === '' || v == null) return;
  var digits = String(v).replace(/\D/g, '');
  if (psf === 0) event.value = digits.slice(0, 5);
  else if (psf === 1) event.value = digits.slice(0, 5) + (digits.length > 5 ? '-' + digits.slice(5, 9) : '');
  else if (psf === 2) event.value = digits.length >= 10 ? '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6, 10) : digits;
  else if (psf === 3) event.value = digits.length >= 9 ? digits.slice(0, 3) + '-' + digits.slice(3, 5) + '-' + digits.slice(5, 9) : digits;
}
function AFSpecial_Keystroke(psf) {
  if (!event.willCommit || event.value === '' || event.value == null) return;
  var digits = String(event.value).replace(/\D/g, '');
  var need = psf === 0 ? 5 : psf === 1 ? 9 : psf === 2 ? 10 : 9;
  if (digits.length !== need) { event.rc = false; app.alert('Enter ' + need + ' digits.'); }
}

function AFSimple_Calculate(fn, fields) {
  var names = Array.isArray(fields) ? fields : String(fields).split(/\s*,\s*/);
  var vals = [];
  for (var i = 0; i < names.length; i++) {
    var f = __state[names[i]];
    if (!f) continue;
    var n = AFMakeNumber(f.value);
    vals.push(n === null ? 0 : n);
  }
  var r = 0;
  switch (String(fn).toUpperCase()) {
    case 'SUM': r = vals.reduce(function (a, b) { return a + b; }, 0); break;
    case 'PRD': r = vals.length ? vals.reduce(function (a, b) { return a * b; }, 1) : 0; break;
    case 'AVG': r = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : 0; break;
    case 'MIN': r = vals.length ? Math.min.apply(null, vals) : 0; break;
    case 'MAX': r = vals.length ? Math.max.apply(null, vals) : 0; break;
  }
  event.value = r;
}

function AFRange_Validate(bGreater, nGreater, bLess, nLess) {
  if (event.value === '' || event.value == null) return;
  var n = AFMakeNumber(event.value);
  if (n === null) return;
  var bad = (bGreater && n < nGreater) || (bLess && n > nLess);
  if (bad) {
    var msg = bGreater && bLess ? 'The value must be between ' + nGreater + ' and ' + nLess + '.' : bGreater ? 'The value must be at least ' + nGreater + '.' : 'The value must be at most ' + nLess + '.';
    event.rc = false;
    app.alert(msg);
  }
}

var event = {
  value: __input.event.value,
  rc: true,
  change: __input.event.change || '',
  changeEx: __input.event.change || '',
  willCommit: !!__input.event.willCommit,
  name: __input.event.name,
  type: 'Field',
  targetName: __input.target,
  target: __state[__input.target] ? new Field(__input.target) : null,
  fieldFull: true,
  source: null,
  selStart: 0,
  selEnd: 0
};
`

/** Wraps a script so it runs as the document (`this`) and its outcome comes back as JSON. */
export function wrapScript(code: string): string {
  return `${ACROBAT_PRELUDE}
var __error = '';
try {
  (function () {
${code}
  }).call(__doc);
} catch (e) {
  __error = String(e && e.message ? e.message : e);
}
JSON.stringify({ value: event.value, rc: event.rc !== false, changed: __changed, alerts: __alerts, log: __log, error: __error });`
}
