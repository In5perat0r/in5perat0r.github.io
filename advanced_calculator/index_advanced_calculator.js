(function () {
  'use strict';

  const STORAGE_KEY = 'advanced_calculator_presets_v1';
  const SELECTED_KEY = 'advanced_calculator_selected_v1';
  const TIME_LIMIT_MS = 1500;

  // <core>
  // Pure logic without DOM access: limits, operations, normalising,
  // validating and evaluating presets.

  const LIMITS = { presets: 100, io: 20, steps: 50, name: 60, unit: 16, variable: 40, code: 20000 };
  const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const RESERVED = new Set((
    'break case catch class const continue debugger default delete do else enum export extends ' +
    'false finally for function if import in instanceof let new null return static super switch ' +
    'this throw true try typeof var void while with yield await async implements interface package ' +
    'private protected public arguments eval undefined NaN Infinity Math Number String Object Array ' +
    'JSON Date Boolean BigInt Symbol Map Set Promise Error RegExp self globalThis window document __proto__'
  ).split(' '));

  const OPS = {
    add:    { label: 'Add (A + B)',            arity: 2, labels: ['A', 'B'],              fn: function (a, b) { return a + b; } },
    sub:    { label: 'Subtract (A − B)',  arity: 2, labels: ['A', 'B'],              fn: function (a, b) { return a - b; } },
    mul:    { label: 'Multiply (A × B)',  arity: 2, labels: ['A', 'B'],              fn: function (a, b) { return a * b; } },
    div:    { label: 'Divide (A ÷ B)',    arity: 2, labels: ['Dividend', 'Divisor'], fn: function (a, b) { if (b === 0) { throw new Error('division by zero'); } return a / b; } },
    pow:    { label: 'Power (A ^ B)',          arity: 2, labels: ['Base', 'Exponent'],    fn: function (a, b) { return Math.pow(a, b); } },
    square: { label: 'Square (A²)',       arity: 1, labels: ['A'],                   fn: function (a) { return a * a; } },
    sqrt:   { label: 'Square root (√A)',  arity: 1, labels: ['A'],                   fn: function (a) { if (a < 0) { throw new Error('square root of a negative number'); } return Math.sqrt(a); } }
  };

  function hasOp(key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(OPS, key);
  }

  function newId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Accepts "1.5", "1,5", "-2", "1e3". Everything else becomes NaN.
  function parseNumber(value) {
    if (typeof value === 'number') { return Number.isFinite(value) ? value : NaN; }
    if (typeof value !== 'string') { return NaN; }
    const t = value.trim().replace(',', '.');
    if (t === '') { return NaN; }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) { return NaN; }
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatNumber(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) { return String(n); }
    if (n === 0) { return '0'; }
    const a = Math.abs(n);
    if (a >= 1e15 || a < 1e-9) { return n.toExponential(9).replace('.', ','); }
    return new Intl.NumberFormat('de-DE', { maximumSignificantDigits: 12, useGrouping: false }).format(n);
  }

  function str(v, max) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }

  function normalizeIO(list) {
    if (!Array.isArray(list)) { return []; }
    return list.slice(0, LIMITS.io).map(function (x) {
      x = x && typeof x === 'object' ? x : {};
      return { name: str(x.name, LIMITS.name), unit: str(x.unit, LIMITS.unit), variable: str(x.variable, LIMITS.variable) };
    });
  }

  function normalizeOperand(o) {
    o = o && typeof o === 'object' ? o : {};
    const src = (o.src === 'prev' || o.src === 'const') ? o.src : 'input';
    return {
      src: src,
      variable: src === 'input' ? str(o.variable, LIMITS.variable) : '',
      value: src === 'const' ? parseNumber(o.value) : 0
    };
  }

  function normalizeStep(s) {
    s = s && typeof s === 'object' ? s : {};
    return {
      op: hasOp(s.op) ? s.op : '',
      a: normalizeOperand(s.a),
      b: normalizeOperand(s.b),
      target: str(s.target, LIMITS.variable)
    };
  }

  // Coerces any parsed JSON into a clean preset object. Never throws.
  function normalizePreset(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
    const mode = raw.mode === 'advanced' ? 'advanced' : 'simple';
    return {
      id: str(raw.id, 64) || newId(),
      name: str(raw.name, LIMITS.name),
      mode: mode,
      inputs: normalizeIO(raw.inputs),
      outputs: normalizeIO(raw.outputs),
      steps: mode === 'simple' && Array.isArray(raw.steps) ? raw.steps.slice(0, LIMITS.steps).map(normalizeStep) : [],
      code: mode === 'advanced' && typeof raw.code === 'string' ? raw.code.slice(0, LIMITS.code) : ''
    };
  }

  function buildBody(code, outputNames) {
    return '"use strict";\n' +
      (outputNames.length ? 'let ' + outputNames.join(', ') + ';\n' : '') +
      code +
      '\n;return {' + outputNames.join(', ') + '};';
  }

  // Compiles only (does not run) to find syntax errors early.
  function checkSyntax(preset) {
    try {
      new Function(...preset.inputs.map(function (i) { return i.variable; }),
        buildBody(preset.code, preset.outputs.map(function (o) { return o.variable; })));
      return '';
    } catch (e) {
      return e && e.message ? e.message : 'unknown syntax error';
    }
  }

  // Returns a list of human readable problems. Empty list = valid.
  function validatePreset(p) {
    const errors = [];
    let varsOk = true;

    if (!p.name) { errors.push('Give the preset a name.'); }
    if (p.inputs.length === 0) { errors.push('Add at least one input.'); }
    if (p.outputs.length === 0) { errors.push('Add at least one output.'); }

    const seen = new Map();
    function checkIO(list, kind) {
      list.forEach(function (item, i) {
        const label = kind + ' ' + (i + 1);
        if (!item.name) { errors.push(label + ': name is empty.'); }
        if (!item.variable) {
          errors.push(label + ': variable is empty.'); varsOk = false;
        } else if (!VAR_RE.test(item.variable)) {
          errors.push(label + ': variable "' + item.variable + '" is invalid (letters, digits and underscore only; must not start with a digit).'); varsOk = false;
        } else if (RESERVED.has(item.variable)) {
          errors.push(label + ': "' + item.variable + '" is a reserved word.'); varsOk = false;
        } else if (seen.has(item.variable)) {
          errors.push(label + ': variable "' + item.variable + '" is already used by ' + seen.get(item.variable) + '.'); varsOk = false;
        } else {
          seen.set(item.variable, label);
        }
      });
    }
    checkIO(p.inputs, 'Input');
    checkIO(p.outputs, 'Output');

    const inputVars = new Set(p.inputs.map(function (i) { return i.variable; }));
    const outputVars = new Set(p.outputs.map(function (o) { return o.variable; }));

    if (p.mode === 'simple') {
      if (p.steps.length === 0) { errors.push('Add at least one operation.'); }
      const assigned = new Set();
      p.steps.forEach(function (s, i) {
        const n = 'Operation ' + (i + 1);
        if (!hasOp(s.op)) { errors.push(n + ': choose an operation.'); return; }
        const op = OPS[s.op];
        function checkOperand(o, which) {
          if (o.src === 'input') {
            if (!inputVars.has(o.variable)) { errors.push(n + ', ' + which + ': choose an input variable.'); }
          } else if (o.src === 'prev') {
            if (i === 0) { errors.push(n + ', ' + which + ': the first operation has no previous result.'); }
          } else if (o.src === 'const') {
            if (!Number.isFinite(o.value)) { errors.push(n + ', ' + which + ': the constant is not a valid number.'); }
          } else {
            errors.push(n + ', ' + which + ': invalid source.');
          }
        }
        checkOperand(s.a, op.labels[0]);
        if (op.arity === 2) { checkOperand(s.b, op.labels[1]); }
        if (s.target) {
          if (!outputVars.has(s.target)) { errors.push(n + ': choose a valid output.'); } else { assigned.add(s.target); }
        }
      });
      p.outputs.forEach(function (o) {
        if (o.variable && outputVars.has(o.variable) && !assigned.has(o.variable)) {
          errors.push('Output "' + (o.name || o.variable) + '" is never filled by an operation.');
        }
      });
    } else {
      if (!p.code.trim()) {
        errors.push('The calculation code is empty.');
      } else if (varsOk) {
        const syn = checkSyntax(p);
        if (syn) { errors.push('Syntax error: ' + syn); }
      }
    }
    return errors;
  }

  // Runs a simple-mode preset. Throws Error with a readable message.
  // values: variable -> number. Returns: variable -> number.
  function evalSimple(preset, values) {
    const outs = Object.create(null);
    let prev = null;
    preset.steps.forEach(function (step, i) {
      const n = i + 1;
      if (!hasOp(step.op)) { throw new Error('Operation ' + n + ': unknown operation.'); }
      const op = OPS[step.op];
      function read(operand) {
        if (operand.src === 'input') {
          const v = values[operand.variable];
          if (typeof v !== 'number') { throw new Error('Operation ' + n + ': input "' + operand.variable + '" is missing.'); }
          return v;
        }
        if (operand.src === 'prev') {
          if (prev === null) { throw new Error('Operation ' + n + ': there is no previous result.'); }
          return prev;
        }
        if (operand.src === 'const') {
          if (!Number.isFinite(operand.value)) { throw new Error('Operation ' + n + ': invalid constant.'); }
          return operand.value;
        }
        throw new Error('Operation ' + n + ': invalid source.');
      }
      const a = read(step.a);
      const b = op.arity === 2 ? read(step.b) : 0;
      let result;
      try {
        result = op.fn(a, b);
      } catch (e) {
        throw new Error('Operation ' + n + ': ' + (e && e.message ? e.message : 'failed') + '.');
      }
      if (!Number.isFinite(result)) {
        throw new Error('Operation ' + n + ': result is not a finite number (overflow or invalid power).');
      }
      prev = result;
      if (step.target) { outs[step.target] = result; }
    });
    return outs;
  }

  // Source of the Web Worker that evaluates advanced presets.
  // Network and storage globals are removed as a best-effort hardening.
  function workerMain() {
    'use strict';
    ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB',
     'caches', 'BroadcastChannel', 'SharedWorker', 'Worker'].forEach(function (name) {
      try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); } catch (e) { /* ignore */ }
    });

    function describe(v) {
      if (typeof v === 'number') { return { type: 'number', value: v }; }
      if (typeof v === 'string') { return { type: 'string', value: v.slice(0, 1000) }; }
      if (typeof v === 'boolean') { return { type: 'boolean', value: v }; }
      if (typeof v === 'bigint') { return { type: 'string', value: v.toString() + 'n' }; }
      if (typeof v === 'undefined') { return { type: 'undefined' }; }
      try {
        const s = JSON.stringify(v);
        return { type: 'string', value: (s === undefined ? String(v) : s).slice(0, 1000) };
      } catch (e) {
        return { type: 'string', value: '[unprintable value]' };
      }
    }

    self.onmessage = function (event) {
      const d = event.data;
      try {
        const fn = new Function(...d.inputNames, d.body);
        const result = fn.apply(undefined, d.inputValues);
        if (result === null || typeof result !== 'object') {
          throw new Error('Do not use "return" - assign the output variables instead.');
        }
        const values = {};
        d.outputNames.forEach(function (name) { values[name] = describe(result[name]); });
        self.postMessage({ ok: true, values: values });
      } catch (err) {
        let msg;
        try { msg = String(err && err.message ? err.message : err); } catch (e) { msg = 'Unknown error'; }
        self.postMessage({ ok: false, error: msg.slice(0, 300) });
      }
    };
  }

  const WORKER_SOURCE = '(' + workerMain.toString() + ')();';
  // </core>

  // ---------------------------------------------------------------------
  // Worker handling (advanced mode)
  // ---------------------------------------------------------------------

  let worker = null;
  let workerUrl = null;
  let queueTail = Promise.resolve();

  function getWorker() {
    if (worker) { return worker; }
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !window.URL || !URL.createObjectURL) {
      throw new Error('unsupported');
    }
    if (!workerUrl) {
      workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    }
    worker = new Worker(workerUrl);
    return worker;
  }

  function killWorker() {
    if (worker) {
      try { worker.terminate(); } catch (e) { /* ignore */ }
      worker = null;
    }
  }

  function runInWorker(payload) {
    return new Promise(function (resolve) {
      let w;
      try {
        w = getWorker();
      } catch (e) {
        resolve({ ok: false, error: 'Advanced presets need Web Worker support, which this browser does not provide.' });
        return;
      }
      const timer = setTimeout(function () {
        killWorker();
        resolve({ ok: false, error: 'Calculation stopped after ' + (TIME_LIMIT_MS / 1000) + ' s. Check the code for an endless loop.' });
      }, TIME_LIMIT_MS);
      w.onmessage = function (e) {
        clearTimeout(timer);
        resolve(e.data && typeof e.data === 'object' ? e.data : { ok: false, error: 'Invalid worker response.' });
      };
      w.onerror = function (e) {
        clearTimeout(timer);
        if (e && e.preventDefault) { e.preventDefault(); }
        killWorker();
        resolve({ ok: false, error: (e && e.message) ? e.message : 'The calculation worker crashed.' });
      };
      try {
        w.postMessage(payload);
      } catch (e) {
        clearTimeout(timer);
        resolve({ ok: false, error: 'Could not start the calculation.' });
      }
    });
  }

  // Runs one request at a time. Requests that became outdated while waiting
  // in the queue are skipped (resolve with { stale: true }).
  function enqueueWorker(payload, isStale) {
    const p = queueTail.then(function () {
      if (isStale()) { return { ok: false, stale: true }; }
      return runInWorker(payload);
    });
    queueTail = p.catch(function () { /* keep the queue alive */ });
    return p;
  }

  async function calculate(preset, numbers, isStale) {
    if (preset.mode === 'simple') {
      try {
        const outs = evalSimple(preset, numbers);
        const values = {};
        Object.keys(outs).forEach(function (k) { values[k] = { type: 'number', value: outs[k] }; });
        return { ok: true, values: values };
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : 'Calculation failed.' };
      }
    }
    const outputNames = preset.outputs.map(function (o) { return o.variable; });
    return enqueueWorker({
      inputNames: preset.inputs.map(function (i) { return i.variable; }),
      inputValues: preset.inputs.map(function (i) { return numbers[i.variable]; }),
      outputNames: outputNames,
      body: buildBody(preset.code, outputNames)
    }, isStale);
  }

  // ---------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------

  const $ = function (id) { return document.getElementById(id); };

  const PROPS = ['disabled', 'hidden', 'checked', 'selected', 'value'];

  function el(tag, props) {
    const node = document.createElement(tag);
    const deferred = [];
    if (props) {
      Object.keys(props).forEach(function (k) {
        const v = props[k];
        if (v === undefined || v === null || v === false && PROPS.indexOf(k) === -1) { return; }
        if (k === 'class') { node.className = v; }
        else if (k.slice(0, 2) === 'on') { node.addEventListener(k.slice(2), v); }
        else if (PROPS.indexOf(k) !== -1) { deferred.push([k, v]); }
        else { node.setAttribute(k, v === true ? '' : v); }
      });
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c === null || c === undefined || c === false) { continue; }
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    deferred.forEach(function (pair) { node[pair[0]] = pair[1]; });
    return node;
  }

  function field(labelText, control) {
    return el('label', { class: 'field' }, el('span', { class: 'field__label' }, labelText), control);
  }

  function selectEl(options, value, onchange, ariaLabel) {
    const s = el('select', { class: 'select', 'aria-label': ariaLabel });
    options.forEach(function (o) {
      s.append(el('option', { value: o.value, disabled: !!o.disabled }, o.label));
    });
    s.value = value;
    s.addEventListener('change', function () { onchange(s.value); });
    return s;
  }

  // ---------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------

  const noticeEl = $('notice');

  const TABS = ['calculator', 'builder', 'presets'];
  const tabEls = {};
  const viewEls = {};
  TABS.forEach(function (name) { tabEls[name] = $('tab-' + name); viewEls[name] = $('view-' + name); });

  const calcEmpty = $('calc-empty');
  const calcMain = $('calc-main');
  const presetSelect = $('preset-select');
  const calcInputsEl = $('calc-inputs');
  const calcOutputsEl = $('calc-outputs');
  const calcStatus = $('calc-status');

  const builderTitle = $('builder-title');
  const draftName = $('draft-name');
  const modeSimple = $('mode-simple');
  const modeAdvanced = $('mode-advanced');
  const ioInputsEl = $('io-inputs');
  const ioOutputsEl = $('io-outputs');
  const simpleEditor = $('simple-editor');
  const stepsEl = $('steps');
  const advancedEditor = $('advanced-editor');
  const codeHint = $('code-hint');
  const codeEl = $('code');
  const builderErrors = $('builder-errors');

  const presetListEl = $('preset-list');
  const presetsEmpty = $('presets-empty');
  const jsonArea = $('json-area');
  const jsonStatus = $('json-status');

  const dialogEl = $('dialog');
  const dialogMessage = $('dialog-message');
  const dialogConfirm = $('dialog-confirm');
  const dialogCancel = $('dialog-cancel');

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  const state = { presets: [], selectedId: null, values: new Map() };
  let draft = null;
  let dirty = false;
  let uidCounter = 0;
  let calcSeq = 0;
  let calcTimer = null;
  let outputEls = new Map();

  function uid() { uidCounter += 1; return 'u' + uidCounter; }
  function markDirty() { dirty = true; }
  function currentPreset() {
    return state.presets.find(function (p) { return p.id === state.selectedId; }) || null;
  }

  // ---------------------------------------------------------------------
  // Notice, status and dialog
  // ---------------------------------------------------------------------

  function showNotice(message) {
    noticeEl.textContent = noticeEl.hidden || !noticeEl.textContent ? message : noticeEl.textContent + '\n' + message;
    noticeEl.hidden = false;
    noticeEl.title = 'Click to dismiss';
  }

  noticeEl.addEventListener('click', function () {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
  });

  function setStatus(message, kind) {
    calcStatus.textContent = message || '';
    calcStatus.className = 'status' + (kind ? ' status--' + kind : '');
  }

  function setJsonStatus(message, kind) {
    jsonStatus.textContent = message || '';
    jsonStatus.className = 'status' + (kind ? ' status--' + kind : '');
  }

  let dialogResolve = null;

  function closeDialog(value) {
    if (dialogResolve) {
      const r = dialogResolve;
      dialogResolve = null;
      r(value);
    }
    if (dialogEl.open) { dialogEl.close(); }
  }

  dialogConfirm.addEventListener('click', function () { closeDialog(true); });
  dialogCancel.addEventListener('click', function () { closeDialog(false); });
  dialogEl.addEventListener('close', function () { closeDialog(false); });

  function askDialog(message, options) {
    const opts = options || {};
    const showCancel = opts.showCancel !== false;
    return new Promise(function (resolve) {
      if (typeof dialogEl.showModal !== 'function') {
        if (showCancel) { resolve(window.confirm(message)); } else { window.alert(message); resolve(true); }
        return;
      }
      if (dialogResolve) { closeDialog(false); }
      dialogMessage.textContent = message;
      dialogConfirm.textContent = opts.confirmText || 'OK';
      dialogCancel.textContent = opts.cancelText || 'Cancel';
      dialogCancel.hidden = !showCancel;
      dialogResolve = resolve;
      dialogEl.showModal();
    });
  }

  // ---------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------

  function loadPresets() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      showNotice('localStorage is not available in this browser. Presets will only exist until you close the page.');
      return [];
    }
    if (!raw) { return []; }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      try { localStorage.setItem(STORAGE_KEY + '_corrupt_backup', raw); } catch (e2) { /* ignore */ }
      showNotice('The saved presets could not be read. The raw data was kept under "' + STORAGE_KEY + '_corrupt_backup".');
      return [];
    }

    const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.presets) ? parsed.presets : []);
    const out = [];
    const ids = new Set();
    let dropped = 0;
    list.slice(0, LIMITS.presets).forEach(function (item) {
      const p = normalizePreset(item);
      if (!p || validatePreset(p).length) { dropped += 1; return; }
      if (ids.has(p.id)) { p.id = newId(); }
      ids.add(p.id);
      out.push(p);
    });
    if (dropped) {
      try { localStorage.setItem(STORAGE_KEY + '_invalid_backup', raw); } catch (e3) { /* ignore */ }
      showNotice(dropped + ' saved preset(s) were invalid and skipped (raw data backed up).');
    }
    return out;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, presets: state.presets }));
    } catch (e) {
      showNotice('Could not save presets (storage full or blocked). Changes only last until you close the page.');
    }
  }

  function loadSelected() {
    let id = null;
    try { id = localStorage.getItem(SELECTED_KEY); } catch (e) { id = null; }
    if (id && state.presets.some(function (p) { return p.id === id; })) { return id; }
    return state.presets.length ? state.presets[0].id : null;
  }

  function saveSelected() {
    try {
      if (state.selectedId) { localStorage.setItem(SELECTED_KEY, state.selectedId); }
      else { localStorage.removeItem(SELECTED_KEY); }
    } catch (e) { /* ignore */ }
  }

  function ensureSelection() {
    if (!currentPreset()) {
      state.selectedId = state.presets.length ? state.presets[0].id : null;
      saveSelected();
    }
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------

  function switchTab(name) {
    TABS.forEach(function (t) {
      const active = t === name;
      tabEls[t].setAttribute('aria-selected', active ? 'true' : 'false');
      viewEls[t].hidden = !active;
    });
    if (name === 'calculator') { renderCalculator(); }
    if (name === 'presets') { renderPresetList(); }
  }

  TABS.forEach(function (name) {
    tabEls[name].addEventListener('click', function () { switchTab(name); });
  });

  // ---------------------------------------------------------------------
  // Calculator view
  // ---------------------------------------------------------------------

  function getTexts(preset) {
    let t = state.values.get(preset.id);
    if (!t) { t = Object.create(null); state.values.set(preset.id, t); }
    return t;
  }

  function renderCalculator() {
    const hasPresets = state.presets.length > 0;
    calcEmpty.hidden = hasPresets;
    calcMain.hidden = !hasPresets;
    if (!hasPresets) { calcSeq += 1; return; }

    ensureSelection();
    const preset = currentPreset();

    presetSelect.textContent = '';
    state.presets.forEach(function (p) {
      presetSelect.append(el('option', { value: p.id }, p.name + ' (' + p.mode + ')'));
    });
    presetSelect.value = preset.id;

    const texts = getTexts(preset);
    calcInputsEl.textContent = '';
    preset.inputs.forEach(function (inp) {
      const input = el('input', {
        class: 'text-input', type: 'text', inputmode: 'decimal', autocomplete: 'off',
        spellcheck: 'false', placeholder: '0', value: texts[inp.variable] || ''
      });
      function markInvalid() {
        const t = input.value.trim();
        input.classList.toggle('is-invalid', t !== '' && Number.isNaN(parseNumber(t)));
      }
      input.addEventListener('input', function () {
        texts[inp.variable] = input.value;
        markInvalid();
        scheduleCalc();
      });
      markInvalid();
      calcInputsEl.append(el('label', { class: 'calc-field' },
        el('span', { class: 'calc-field__label' }, inp.name, el('code', { class: 'calc-field__var' }, inp.variable)),
        el('span', { class: 'calc-field__row' }, input, inp.unit ? el('span', { class: 'calc-field__unit' }, inp.unit) : null)
      ));
    });

    calcOutputsEl.textContent = '';
    outputEls = new Map();
    preset.outputs.forEach(function (o) {
      const valueEl = el('span', { class: 'output__value is-empty' }, '–');
      calcOutputsEl.append(el('div', { class: 'output' },
        el('span', { class: 'output__name' }, o.name, el('code', { class: 'calc-field__var' }, o.variable)),
        el('span', { class: 'output__result' }, valueEl, o.unit ? el('span', { class: 'output__unit' }, o.unit) : null)
      ));
      outputEls.set(o.variable, valueEl);
    });

    runCalc();
  }

  // Updates the output rows. Returns a list of warnings.
  function showOutputs(preset, res) {
    const warnings = [];
    preset.outputs.forEach(function (o) {
      const node = outputEls.get(o.variable);
      if (!node) { return; }
      node.classList.remove('is-empty', 'is-warn');
      let text = '–';
      let empty = true;
      if (res && res.ok && res.values) {
        const item = res.values[o.variable];
        if (item && item.type === 'number') {
          text = formatNumber(item.value);
          empty = false;
          if (!Number.isFinite(item.value)) {
            node.classList.add('is-warn');
            warnings.push('Output "' + o.variable + '" is not a finite number.');
          }
        } else if (item && (item.type === 'string' || item.type === 'boolean')) {
          text = String(item.value);
          empty = false;
        } else {
          warnings.push('Output "' + o.variable + '" was never assigned.');
        }
      }
      node.textContent = text;
      node.classList.toggle('is-empty', empty);
    });
    return warnings;
  }

  function scheduleCalc() {
    clearTimeout(calcTimer);
    calcTimer = setTimeout(runCalc, 150);
  }

  async function runCalc() {
    clearTimeout(calcTimer);
    const preset = currentPreset();
    if (!preset) { return; }
    const seq = ++calcSeq;

    const texts = getTexts(preset);
    const numbers = Object.create(null);
    let missing = 0;
    let invalid = 0;
    preset.inputs.forEach(function (inp) {
      const t = texts[inp.variable];
      if (t === undefined || t.trim() === '') { missing += 1; return; }
      const n = parseNumber(t);
      if (Number.isNaN(n)) { invalid += 1; } else { numbers[inp.variable] = n; }
    });

    if (missing || invalid) {
      showOutputs(preset, null);
      if (invalid) { setStatus(invalid + ' input value(s) are not valid numbers.', 'error'); }
      else { setStatus('Enter a value for every input to calculate.', ''); }
      return;
    }

    let res;
    try {
      res = await calculate(preset, numbers, function () { return seq !== calcSeq; });
    } catch (e) {
      res = { ok: false, error: 'Unexpected error during calculation.' };
    }
    if (seq !== calcSeq || res.stale) { return; }

    const warnings = showOutputs(preset, res.ok ? res : null);
    if (!res.ok) { setStatus(res.error || 'Calculation failed.', 'error'); }
    else if (warnings.length) { setStatus(warnings.join(' '), 'warn'); }
    else { setStatus('', ''); }
  }

  presetSelect.addEventListener('change', function () {
    state.selectedId = presetSelect.value;
    saveSelected();
    renderCalculator();
  });

  $('btn-empty-create').addEventListener('click', function () { switchTab('builder'); });

  $('btn-edit-preset').addEventListener('click', function () {
    const p = currentPreset();
    if (p) { openInBuilder(p); }
  });

  // ---------------------------------------------------------------------
  // Builder: draft model
  // ---------------------------------------------------------------------

  function freeVariable(prefix, list) {
    const used = new Set(list.map(function (x) { return x.variable; }));
    let i = 1;
    while (used.has(prefix + i)) { i += 1; }
    return prefix + i;
  }

  function newIO(kind) {
    const list = draft ? draft[kind === 'input' ? 'inputs' : 'outputs'] : [];
    return {
      uid: uid(),
      name: (kind === 'input' ? 'Input ' : 'Output ') + (list.length + 1),
      unit: '',
      variable: freeVariable(kind === 'input' ? 'in' : 'out', list)
    };
  }

  function blankDraft() {
    const a = { uid: uid(), name: 'A', unit: '', variable: 'a' };
    const b = { uid: uid(), name: 'B', unit: '', variable: 'b' };
    const r = { uid: uid(), name: 'Result', unit: '', variable: 'result' };
    return {
      id: null,
      name: '',
      mode: 'simple',
      inputs: [a, b],
      outputs: [r],
      steps: [{
        uid: uid(), op: 'add',
        a: { src: 'input', ref: a.uid, value: '0' },
        b: { src: 'input', ref: b.uid, value: '0' },
        targetRef: r.uid
      }],
      code: '// Input variables are available by name. Assign your results to the output variables.\nresult = a + b;'
    };
  }

  function presetToDraft(p) {
    const inputs = p.inputs.map(function (x) { return { uid: uid(), name: x.name, unit: x.unit, variable: x.variable }; });
    const outputs = p.outputs.map(function (x) { return { uid: uid(), name: x.name, unit: x.unit, variable: x.variable }; });
    function uidFor(list, variable) {
      const hit = list.find(function (x) { return x.variable === variable; });
      return hit ? hit.uid : '';
    }
    function operand(o) {
      return {
        src: o.src,
        ref: o.src === 'input' ? uidFor(inputs, o.variable) : '',
        value: o.src === 'const' && Number.isFinite(o.value) ? String(o.value) : '0'
      };
    }
    return {
      id: p.id,
      name: p.name,
      mode: p.mode,
      inputs: inputs,
      outputs: outputs,
      steps: p.steps.map(function (s) {
        return { uid: uid(), op: s.op || 'add', a: operand(s.a), b: operand(s.b), targetRef: uidFor(outputs, s.target) };
      }),
      code: p.code || ''
    };
  }

  function draftToPreset(d) {
    const varOf = new Map();
    d.inputs.concat(d.outputs).forEach(function (x) { varOf.set(x.uid, x.variable.trim()); });
    function operand(o) {
      return {
        src: o.src,
        variable: o.src === 'input' ? (varOf.get(o.ref) || '') : '',
        value: o.src === 'const' ? parseNumber(o.value) : 0
      };
    }
    return {
      id: d.id || newId(),
      name: d.name,
      mode: d.mode,
      inputs: d.inputs.map(function (x) { return { name: x.name, unit: x.unit, variable: x.variable }; }),
      outputs: d.outputs.map(function (x) { return { name: x.name, unit: x.unit, variable: x.variable }; }),
      steps: d.steps.map(function (s) {
        return { op: s.op, a: operand(s.a), b: operand(s.b), target: s.targetRef ? (varOf.get(s.targetRef) || '') : '' };
      }),
      code: d.code
    };
  }

  // ---------------------------------------------------------------------
  // Builder: rendering
  // ---------------------------------------------------------------------

  function ioOption(item) {
    return { value: item.uid, label: (item.variable || '?') + ' · ' + (item.name || 'unnamed') };
  }

  function updateCodeHint() {
    const ins = draft.inputs.map(function (x) { return x.variable.trim(); }).filter(Boolean);
    const outs = draft.outputs.map(function (x) { return x.variable.trim(); }).filter(Boolean);
    codeHint.textContent = 'Input variables: ' + (ins.join(', ') || '(none)') +
      '  •  Assign your results to: ' + (outs.join(', ') || '(none)') +
      '  (already declared, do not use let/const for them)';
  }

  function renderIO(kind) {
    const host = kind === 'inputs' ? ioInputsEl : ioOutputsEl;
    const singular = kind === 'inputs' ? 'Input' : 'Output';
    const list = draft[kind];
    host.textContent = '';
    list.forEach(function (item, idx) {
      const label = singular + ' ' + (idx + 1);
      host.append(el('div', { class: 'io-row' },
        field('Name', el('input', {
          class: 'text-input', type: 'text', maxlength: LIMITS.name, value: item.name,
          placeholder: kind === 'inputs' ? 'e.g. Width' : 'e.g. Area', 'aria-label': label + ' name',
          oninput: function (e) { item.name = e.target.value; markDirty(); },
          onchange: function () { renderSteps(); }
        })),
        field('Unit', el('input', {
          class: 'text-input', type: 'text', maxlength: LIMITS.unit, value: item.unit,
          placeholder: 'e.g. cm', 'aria-label': label + ' unit',
          oninput: function (e) { item.unit = e.target.value; markDirty(); }
        })),
        field('Variable', el('input', {
          class: 'text-input', type: 'text', maxlength: LIMITS.variable, value: item.variable,
          placeholder: kind === 'inputs' ? 'e.g. width' : 'e.g. area', spellcheck: 'false',
          autocomplete: 'off', 'aria-label': label + ' variable',
          oninput: function (e) { item.variable = e.target.value; markDirty(); updateCodeHint(); },
          onchange: function () { renderSteps(); }
        })),
        el('button', {
          class: 'btn btn--ghost btn--small btn--icon btn--danger', type: 'button',
          'aria-label': 'Remove ' + label, title: 'Remove', disabled: list.length <= 1,
          onclick: function () { removeIO(kind, idx); }
        }, '✕')
      ));
    });
  }

  function removeIO(kind, idx) {
    const list = draft[kind];
    if (list.length <= 1) { return; }
    const removed = list.splice(idx, 1)[0];
    draft.steps.forEach(function (s) {
      if (kind === 'inputs') {
        if (s.a.ref === removed.uid) { s.a.ref = ''; }
        if (s.b.ref === removed.uid) { s.b.ref = ''; }
      } else if (s.targetRef === removed.uid) {
        s.targetRef = '';
      }
    });
    markDirty();
    renderIO(kind);
    renderSteps();
    updateCodeHint();
  }

  function addIO(kind) {
    const key = kind === 'input' ? 'inputs' : 'outputs';
    if (draft[key].length >= LIMITS.io) {
      askDialog('You can define at most ' + LIMITS.io + ' ' + key + ' per preset.', { showCancel: false });
      return;
    }
    draft[key].push(newIO(kind));
    markDirty();
    renderIO(key);
    renderSteps();
    updateCodeHint();
  }

  function operandRow(step, key, label, stepIdx) {
    const operand = step[key];
    const srcOptions = [
      { value: 'input', label: 'Input variable' },
      { value: 'prev', label: stepIdx === 0 ? 'Previous result (n/a)' : 'Previous result', disabled: stepIdx === 0 },
      { value: 'const', label: 'Constant' }
    ];
    const srcSel = selectEl(srcOptions, operand.src, function (v) {
      operand.src = v;
      if (v === 'input' && !operand.ref && draft.inputs.length) { operand.ref = draft.inputs[0].uid; }
      markDirty();
      renderSteps();
    }, label + ' source');

    let valueCtl;
    if (operand.src === 'input') {
      valueCtl = selectEl([{ value: '', label: 'Choose input…' }].concat(draft.inputs.map(ioOption)),
        operand.ref || '', function (v) { operand.ref = v; markDirty(); }, label + ' input');
    } else if (operand.src === 'const') {
      valueCtl = el('input', {
        class: 'text-input', type: 'text', inputmode: 'decimal', value: operand.value,
        placeholder: 'e.g. 2', 'aria-label': label + ' constant',
        oninput: function (e) { operand.value = e.target.value; markDirty(); }
      });
    } else {
      valueCtl = el('span', { class: 'step__prev' }, stepIdx === 0 ? 'No previous result available' : 'Result of operation ' + stepIdx);
    }
    return el('div', { class: 'step__row' }, el('span', { class: 'step__label' }, label), srcSel, valueCtl);
  }

  function moveStep(idx, delta) {
    const j = idx + delta;
    if (j < 0 || j >= draft.steps.length) { return; }
    const tmp = draft.steps[idx];
    draft.steps[idx] = draft.steps[j];
    draft.steps[j] = tmp;
    markDirty();
    renderSteps();
  }

  function renderSteps() {
    stepsEl.textContent = '';
    if (draft.steps.length === 0) {
      stepsEl.append(el('p', { class: 'hint' }, 'No operations yet. Add the first one below.'));
    }
    draft.steps.forEach(function (step, idx) {
      const op = OPS[step.op] || OPS.add;
      const opOptions = Object.keys(OPS).map(function (k) { return { value: k, label: OPS[k].label }; });
      const targetOptions = [{ value: '', label: '→ Next operation only' }].concat(
        draft.outputs.map(function (o) {
          return { value: o.uid, label: '→ Output: ' + (o.variable || '?') + ' · ' + (o.name || 'unnamed') };
        }));

      stepsEl.append(el('div', { class: 'step' },
        el('div', { class: 'step__head' },
          el('span', { class: 'step__title' }, 'Operation ' + (idx + 1)),
          selectEl(opOptions, step.op, function (v) { step.op = v; markDirty(); renderSteps(); }, 'Operation ' + (idx + 1) + ' type'),
          el('span', { class: 'step__tools' },
            el('button', { class: 'btn btn--ghost btn--small btn--icon', type: 'button', title: 'Move up', 'aria-label': 'Move operation ' + (idx + 1) + ' up', disabled: idx === 0, onclick: function () { moveStep(idx, -1); } }, '↑'),
            el('button', { class: 'btn btn--ghost btn--small btn--icon', type: 'button', title: 'Move down', 'aria-label': 'Move operation ' + (idx + 1) + ' down', disabled: idx === draft.steps.length - 1, onclick: function () { moveStep(idx, 1); } }, '↓'),
            el('button', { class: 'btn btn--ghost btn--small btn--icon btn--danger', type: 'button', title: 'Remove', 'aria-label': 'Remove operation ' + (idx + 1), onclick: function () { draft.steps.splice(idx, 1); markDirty(); renderSteps(); } }, '✕')
          )
        ),
        operandRow(step, 'a', op.labels[0], idx),
        op.arity === 2 ? operandRow(step, 'b', op.labels[1], idx) : null,
        el('div', { class: 'step__row step__row--target' },
          el('span', { class: 'step__label' }, 'Result goes to'),
          selectEl(targetOptions, step.targetRef || '', function (v) { step.targetRef = v; markDirty(); }, 'Operation ' + (idx + 1) + ' result target')
        )
      ));
    });
  }

  function renderBuilder() {
    const editing = draft.id && state.presets.some(function (p) { return p.id === draft.id; });
    builderTitle.textContent = editing ? 'Edit preset' : 'New preset';
    draftName.value = draft.name;
    codeEl.value = draft.code;
    applyMode();
    renderIO('inputs');
    renderIO('outputs');
    renderSteps();
    updateCodeHint();
    builderErrors.hidden = true;
    builderErrors.textContent = '';
  }

  function applyMode() {
    const adv = draft.mode === 'advanced';
    modeSimple.setAttribute('aria-pressed', adv ? 'false' : 'true');
    modeAdvanced.setAttribute('aria-pressed', adv ? 'true' : 'false');
    simpleEditor.hidden = adv;
    advancedEditor.hidden = !adv;
  }

  async function openInBuilder(preset) {
    if (dirty) {
      const ok = await askDialog('Discard the unsaved changes in the Builder?', { confirmText: 'Discard' });
      if (!ok) { return; }
    }
    draft = preset ? presetToDraft(preset) : blankDraft();
    dirty = false;
    renderBuilder();
    switchTab('builder');
  }

  draftName.addEventListener('input', function () { draft.name = draftName.value; markDirty(); });
  codeEl.addEventListener('input', function () { draft.code = codeEl.value; markDirty(); });

  modeSimple.addEventListener('click', function () { draft.mode = 'simple'; markDirty(); applyMode(); });
  modeAdvanced.addEventListener('click', function () { draft.mode = 'advanced'; markDirty(); applyMode(); updateCodeHint(); });

  $('btn-add-input').addEventListener('click', function () { addIO('input'); });
  $('btn-add-output').addEventListener('click', function () { addIO('output'); });

  $('btn-add-step').addEventListener('click', function () {
    if (draft.steps.length >= LIMITS.steps) {
      askDialog('You can chain at most ' + LIMITS.steps + ' operations.', { showCancel: false });
      return;
    }
    const first = draft.inputs[0] ? draft.inputs[0].uid : '';
    const second = draft.inputs[1] ? draft.inputs[1].uid : first;
    draft.steps.push({
      uid: uid(), op: 'add',
      a: { src: draft.steps.length ? 'prev' : 'input', ref: first, value: '0' },
      b: { src: 'input', ref: second, value: '0' },
      targetRef: ''
    });
    markDirty();
    renderSteps();
  });

  $('btn-reset').addEventListener('click', async function () {
    if (dirty) {
      const ok = await askDialog('Discard the current draft and start a new preset?', { confirmText: 'Start new' });
      if (!ok) { return; }
    }
    draft = blankDraft();
    dirty = false;
    renderBuilder();
  });

  function showBuilderErrors(errors) {
    builderErrors.textContent = '';
    errors.forEach(function (msg) { builderErrors.append(el('li', null, msg)); });
    builderErrors.hidden = false;
    builderErrors.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  $('btn-save').addEventListener('click', function () {
    const preset = normalizePreset(draftToPreset(draft));
    const errors = preset ? validatePreset(preset) : ['The preset is invalid.'];
    const exists = preset && state.presets.some(function (p) { return p.id === preset.id; });
    if (preset && !exists && state.presets.length >= LIMITS.presets) {
      errors.push('You reached the limit of ' + LIMITS.presets + ' presets. Delete one first.');
    }
    if (errors.length) { showBuilderErrors(errors); return; }

    builderErrors.hidden = true;
    builderErrors.textContent = '';
    const idx = state.presets.findIndex(function (p) { return p.id === preset.id; });
    if (idx >= 0) { state.presets[idx] = preset; } else { state.presets.push(preset); }
    draft.id = preset.id;
    persist();
    state.selectedId = preset.id;
    saveSelected();
    dirty = false;
    renderBuilder();
    switchTab('calculator');
  });

  // ---------------------------------------------------------------------
  // Presets view
  // ---------------------------------------------------------------------

  function renderPresetList() {
    presetListEl.textContent = '';
    presetsEmpty.hidden = state.presets.length > 0;
    state.presets.forEach(function (p) {
      presetListEl.append(el('li', { class: 'preset-item' },
        el('div', { class: 'preset-item__main' },
          el('span', { class: 'preset-item__name' }, p.name),
          el('span', { class: 'badge badge--' + p.mode }, p.mode),
          el('span', { class: 'preset-item__meta' }, p.inputs.length + ' in · ' + p.outputs.length + ' out')
        ),
        el('div', { class: 'preset-item__actions' },
          el('button', { class: 'btn btn--pink btn--small', type: 'button', onclick: function () { useSelected(p.id); } }, 'Use'),
          el('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: function () { openInBuilder(p); } }, 'Edit'),
          el('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: function () { duplicatePreset(p); } }, 'Duplicate'),
          el('button', { class: 'btn btn--ghost btn--small btn--danger', type: 'button', onclick: function () { deletePreset(p); } }, 'Delete')
        )
      ));
    });
  }

  function useSelected(id) {
    state.selectedId = id;
    saveSelected();
    switchTab('calculator');
  }

  function duplicatePreset(p) {
    if (state.presets.length >= LIMITS.presets) {
      askDialog('You reached the limit of ' + LIMITS.presets + ' presets.', { showCancel: false });
      return;
    }
    const copy = normalizePreset(JSON.parse(JSON.stringify(p)));
    copy.id = newId();
    copy.name = (p.name + ' (copy)').slice(0, LIMITS.name);
    state.presets.push(copy);
    persist();
    renderPresetList();
  }

  async function deletePreset(p) {
    const ok = await askDialog('Delete the preset "' + p.name + '"? This cannot be undone.', { confirmText: 'Delete' });
    if (!ok) { return; }
    state.presets = state.presets.filter(function (x) { return x.id !== p.id; });
    state.values.delete(p.id);
    if (draft && draft.id === p.id) { draft.id = null; renderBuilder(); }
    ensureSelection();
    persist();
    renderPresetList();
  }

  $('btn-export').addEventListener('click', function () {
    jsonArea.value = JSON.stringify({ version: 1, presets: state.presets }, null, 2);
    setJsonStatus('Exported ' + state.presets.length + ' preset(s). Copy the text to back it up.', 'ok');
  });

  $('btn-import').addEventListener('click', async function () {
    const text = jsonArea.value.trim();
    if (!text) { setJsonStatus('Paste JSON into the box first.', 'error'); return; }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setJsonStatus('This is not valid JSON: ' + e.message, 'error');
      return;
    }

    let list = [];
    if (Array.isArray(parsed)) { list = parsed; }
    else if (parsed && Array.isArray(parsed.presets)) { list = parsed.presets; }
    else if (parsed && typeof parsed === 'object') { list = [parsed]; }

    const accepted = [];
    const problems = [];
    list.slice(0, LIMITS.presets).forEach(function (raw, i) {
      const p = normalizePreset(raw);
      if (!p) { problems.push('#' + (i + 1) + ' is not a preset'); return; }
      const errs = validatePreset(p);
      if (errs.length) { problems.push('#' + (i + 1) + ' "' + (p.name || 'unnamed') + '": ' + errs[0]); return; }
      accepted.push(p);
    });

    const room = Math.max(LIMITS.presets - state.presets.length, 0);
    if (accepted.length > room) {
      problems.push((accepted.length - room) + ' skipped (limit of ' + LIMITS.presets + ' presets)');
      accepted.length = room;
    }
    if (accepted.length === 0) {
      setJsonStatus('Nothing imported. ' + (problems.join(' | ') || 'No presets found.'), 'error');
      return;
    }

    if (accepted.some(function (p) { return p.mode === 'advanced'; })) {
      const ok = await askDialog(
        'Advanced presets run JavaScript code when you use them. It runs in a restricted worker, ' +
        'but only import presets from sources you trust.\n\nImport anyway?', { confirmText: 'Import' });
      if (!ok) { setJsonStatus('Import cancelled.', ''); return; }
    }

    accepted.forEach(function (p) { p.id = newId(); state.presets.push(p); });
    ensureSelection();
    persist();
    renderPresetList();
    setJsonStatus('Imported ' + accepted.length + ' preset(s).' + (problems.length ? ' Skipped: ' + problems.join(' | ') : ''), problems.length ? 'warn' : 'ok');
  });

  // Keep several open tabs in sync.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) { return; }
    state.presets = loadPresets();
    ensureSelection();
    if (!viewEls.calculator.hidden) { renderCalculator(); }
    if (!viewEls.presets.hidden) { renderPresetList(); }
    showNotice('Presets were changed in another tab and have been reloaded.');
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  state.presets = loadPresets();
  state.selectedId = loadSelected();
  draft = blankDraft();
  renderBuilder();
  switchTab('calculator');
})();
