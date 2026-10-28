/* Board-exam review pages (/exam/**): quiz/browse mode, practice exams, wrong-answer
 * notebook, search and Anki export. Chapter notes are static and public; the question
 * bank (questions, answers, explanations) is fetched from /api/exam/data, which only
 * answers signed-in readers, and rendered here. Progress lives in localStorage on this
 * device only.
 * All dynamic text is inserted with textContent / DOM nodes (no innerHTML), and the
 * pages carry no inline script, so this file also starts the shared site chrome. */
(function () {
  'use strict';
  var MODE_KEY = 'hs:exam:mode';
  var WRONG_KEY = 'hs:exam:wrong';
  var STATS_KEY = 'hs:exam:stats';   // { n: [last result 1|0, attempts, last answered ms] }
  var READ_KEY = 'hs:exam:read';     // [chapter keys whose textbook chapter is read]
  var VISIT_KEY = 'hs:exam:visit';   // { chapter key: last visit ms }
  var ANS_KEY = 'hs:exam:ans';       // { n: { c: chosen option key, t: answered ms } }
  var POS_KEY = 'hs:exam:pos';       // { chapter key: { id: note anchor id, t: saved ms } }
  var body = document.body;

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage disabled */ }
  }
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function wrongList() {
    var list = load(WRONG_KEY, []);
    return Array.isArray(list) ? list.map(Number).filter(function (n) { return n > 0; }) : [];
  }
  function markWrong(n, isWrong) {
    n = Number(n);
    var list = wrongList().filter(function (x) { return x !== n; });
    if (isWrong) list.push(n);
    store(WRONG_KEY, list);
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function stats() { return plainObject(load(STATS_KEY, {})); }
  // A usable record is [1|0, attempts, ms]; anything else (hand-edited or older
  // storage) is treated as "not answered" by every view.
  function validStat(s) { return Array.isArray(s) && (s[0] === 0 || s[0] === 1); }
  function recordAnswer(n, ok) {
    var all = stats();
    var prev = Array.isArray(all[n]) ? all[n] : [];
    all[n] = [ok ? 1 : 0, (Number(prev[1]) || 0) + 1, Date.now()];
    store(STATS_KEY, all);
  }
  function readList() {
    var list = load(READ_KEY, []);
    return Array.isArray(list) ? list.map(String) : [];
  }
  function setRead(key, isRead) {
    var list = readList().filter(function (k) { return k !== key; });
    if (isRead) list.push(key);
    store(READ_KEY, list);
  }
  function visits() { return plainObject(load(VISIT_KEY, {})); }
  // Last chosen option per question, so quiz mode can show it again on the next visit.
  function choices() { return plainObject(load(ANS_KEY, {})); }
  function rememberChoice(n, key) {
    var all = choices();
    all[n] = { c: String(key), t: Date.now() };
    store(ANS_KEY, all);
  }
  function forget(storeKey, ns) {
    var all = plainObject(load(storeKey, {}));
    ns.forEach(function (n) { delete all[n]; });
    store(storeKey, all);
  }
  function positions() { return plainObject(load(POS_KEY, {})); }
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function scrollToY(y, smooth) {
    var top = Math.max(0, Math.round(y));
    try { window.scrollTo({ top: top, behavior: smooth && !reducedMotion() ? 'smooth' : 'instant' }); } catch (e) { window.scrollTo(0, top); }
  }
  // Bottom edge of the sticky site header (content scrolled under it is hidden).
  function headerBottom() {
    var header = document.querySelector('header');
    return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  }
  function dateText(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function percent(right, done) { return done ? Math.round(100 * right / done) + '%' : '—'; }

  // Chapter page strip: "textbook read" box plus this chapter's answered count and accuracy.
  function refreshStrip() {
    var strip = document.querySelector('[data-progress-chapter]');
    if (!strip) return;
    var all = stats();
    var done = 0;
    var right = 0;
    var cards = document.querySelectorAll('.ex-q:not(.ex-unanswered)');
    cards.forEach(function (card) {
      var s = all[card.getAttribute('data-qid')];
      if (validStat(s)) { done += 1; right += s[0]; }
    });
    strip.querySelector('.ex-strip-text').textContent = !cards.length ? '登入題庫後可以作答並記錄進度'
      : done ? '已作答 ' + done + ' / ' + cards.length + ' 題 · 正確率 ' + percent(right, done)
        : '本章 ' + cards.length + ' 題，還沒有作答紀錄';
  }
  function initStrip(strip) {
    var key = strip.getAttribute('data-progress-chapter');
    var all = visits();
    all[key] = Date.now();
    store(VISIT_KEY, all);
    var box = strip.querySelector('.ex-read-box');
    box.checked = readList().indexOf(key) !== -1;
    box.addEventListener('change', function () { setRead(key, box.checked); });
    strip.hidden = false;
    refreshStrip();
  }

  function setMode(mode) {
    body.classList.toggle('ex-quiz', mode === 'quiz');
    document.querySelectorAll('.ex-mode').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-mode') === mode ? 'true' : 'false');
    });
    store(MODE_KEY, mode);
  }

  // Chapter page answer bar (status line + "next unanswered"); set once questions render.
  var answerBar = null;
  function refreshAnswerBar() { if (answerBar) answerBar.refresh(); }

  // forgetChoice: the reader pressed 「重新作答」, so the stored choice goes too
  // (a practice exam restarting its own cards keeps it).
  function resetQuestion(card, forgetChoice) {
    if (card.classList.contains('ex-unanswered')) return;
    card.classList.remove('ex-done');
    card.removeAttribute('data-outcome');
    card.querySelectorAll('.ex-opt').forEach(function (opt) { opt.classList.remove('ex-picked'); });
    card.querySelectorAll('input[type=radio]').forEach(function (input) { input.checked = false; input.disabled = false; });
    var result = card.querySelector('.ex-result');
    if (result) result.textContent = '';
    if (forgetChoice) forget(ANS_KEY, [card.getAttribute('data-qid')]);
    refreshAnswerBar();
  }

  // Graded look of a card: picked option, right/wrong feedback, explanation shown.
  function showGraded(card, picked) {
    var answer = card.getAttribute('data-answer') || '';
    var ok = picked.value === answer;
    card.classList.add('ex-done');
    card.setAttribute('data-outcome', ok ? 'right' : 'wrong');
    picked.closest('.ex-opt').classList.add('ex-picked');
    card.querySelectorAll('input[type=radio]').forEach(function (input) { input.disabled = true; });
    var result = card.querySelector('.ex-result');
    if (result) result.textContent = ok ? '答對了' : '答錯了，答案是 ' + answer;
    return ok;
  }

  function grade(card, silent) {
    var answer = card.getAttribute('data-answer') || '';
    if (!answer) return null;
    var picked = card.querySelector('input[type=radio]:checked');
    var result = card.querySelector('.ex-result');
    if (!picked) {
      if (!silent && result) result.textContent = '請先選擇一個選項';
      return null;
    }
    var ok = showGraded(card, picked);
    markWrong(card.getAttribute('data-qid'), !ok);
    recordAnswer(card.getAttribute('data-qid'), ok);
    rememberChoice(card.getAttribute('data-qid'), picked.value);
    refreshStrip();
    refreshAnswerBar();
    return ok;
  }

  // Show the stored choice of a not-yet-answered card as if it had just been submitted
  // (stats and the wrong-answer notebook were updated when it was answered).
  function restoreChoice(card, all) {
    if (card.classList.contains('ex-unanswered') || card.classList.contains('ex-done')) return;
    if (card.querySelector('input[type=radio]:checked')) return;
    var saved = all[card.getAttribute('data-qid')];
    if (!saved || typeof saved !== 'object' || typeof saved.c !== 'string') return;
    var inputs = card.querySelectorAll('input[type=radio]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].value === saved.c) {
        inputs[i].checked = true;
        showGraded(card, inputs[i]);
        return;
      }
    }
  }
  function restoreChoices(box) {
    if (!box || !body.classList.contains('ex-quiz')) return;
    var all = choices();
    box.querySelectorAll('.ex-q').forEach(function (card) { restoreChoice(card, all); });
    refreshAnswerBar();
  }

  function wireQuestion(card) {
    var submit = card.querySelector('.ex-submit');
    var reset = card.querySelector('.ex-reset');
    if (submit) submit.addEventListener('click', function () { grade(card, false); });
    if (reset) reset.addEventListener('click', function () { resetQuestion(card, true); });
    card.querySelectorAll('input[type=radio]').forEach(function (input) {
      input.addEventListener('change', function () {
        var result = card.querySelector('.ex-result');
        if (result) result.textContent = '';
      });
    });
  }

  function wireExamBar(bar, scope) {
    var timerEl = bar.querySelector('.ex-timer');
    var scoreEl = bar.querySelector('.ex-score');
    var startedAt = null;
    var timer = null;
    function tick() {
      var s = Math.floor((Date.now() - startedAt) / 1000);
      var m = Math.floor(s / 60);
      timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    }
    function start() {
      setMode('quiz');
      scope.querySelectorAll('.ex-q').forEach(function (card) { resetQuestion(card, false); });
      scoreEl.textContent = '';
      startedAt = Date.now();
      if (timer) clearInterval(timer);
      timer = setInterval(tick, 1000);
      tick();
    }
    bar.querySelector('.ex-finish').addEventListener('click', function () {
      if (timer) { clearInterval(timer); timer = null; }
      setMode('quiz');
      var cards = scope.querySelectorAll('.ex-q:not(.ex-unanswered)');
      var right = 0;
      var blank = 0;
      // Every graded card keeps its submitted outcome, so finishing again
      // recounts the same result (blanks included) instead of skipping them.
      cards.forEach(function (card) {
        if (!card.hasAttribute('data-outcome') && grade(card, true) === null) {
          card.classList.add('ex-done');
          card.setAttribute('data-outcome', 'blank');
          card.querySelectorAll('input[type=radio]').forEach(function (input) { input.disabled = true; });
        }
        var outcome = card.getAttribute('data-outcome');
        if (outcome === 'right') right += 1;
        else if (outcome === 'blank') blank += 1;
      });
      var ungraded = scope.querySelectorAll('.ex-q.ex-unanswered').length;
      scoreEl.textContent = '得分 ' + right + ' / ' + cards.length + (blank ? '（未作答 ' + blank + ' 題）' : '')
        + (ungraded ? '；另有 ' + ungraded + ' 題尚未整理答案，不計分' : '');
    });
    return { start: start };
  }

  // ---------------------------------------------------------- client-rendered cards
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var taxonRe = null;
  // Text with organism names set in italics (pattern shipped by the generator).
  function rich(tag, cls, text) {
    var node = el(tag, cls);
    var str = String(text);
    if (!taxonRe) { node.textContent = str; return node; }
    var last = 0;
    str.replace(taxonRe, function (match, name, offset) {
      if (offset > last) node.appendChild(document.createTextNode(str.slice(last, offset)));
      node.appendChild(el('i', null, name));
      last = offset + match.length;
      return match;
    });
    if (last < str.length) node.appendChild(document.createTextNode(str.slice(last)));
    return node;
  }

  function chapterChip(key, n, chapters) {
    var parts = key.split('-');
    var chip = el('a', 'ex-chip', 'BCSC ' + parts[0] + ' · Ch.' + parts[1]);
    chip.href = '/exam/bcsc' + key + '#q-' + n;
    if (chapters && chapters[key]) chip.title = chapters[key].title;
    return chip;
  }

  // Flagged question: the exam answer's rationale and, if guidance has moved on, the current concept.
  function citeList(refs) {
    var list = el('ol', 'ex-cites');
    refs.forEach(function (r) {
      var li = el('li');
      if (/^https?:\/\//.test(r.u || '')) {
        var a = el('a', null, r.t);
        a.href = r.u;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.appendChild(a);
      } else {
        li.appendChild(el('span', null, r.t));
      }
      li.appendChild(el('span', 'ex-cite-meta', r.s));
      list.appendChild(li);
    });
    return list;
  }

  function doubtBox(q) {
    var box = el('div', 'ex-doubt');
    if (q.dispute) {
      var dis = rich('p', 'ex-doubt-dispute', q.dispute.text);
      dis.insertBefore(el('span', 'ex-doubt-tag ex-doubt-tag-dispute', '答案存疑'), dis.firstChild);
      box.appendChild(dis);
      box.appendChild(citeList(q.dispute.refs));
    }
    var exam = rich('p', 'ex-doubt-exam', q.doubt.exam);
    exam.insertBefore(el('span', 'ex-doubt-tag', '考試答案 ' + q.answer), exam.firstChild);
    box.appendChild(exam);
    if (q.doubt.now) {
      var now = rich('p', 'ex-doubt-now', q.doubt.now);
      now.insertBefore(el('span', 'ex-doubt-tag ex-doubt-tag-now', '現行觀念'), now.firstChild);
      box.appendChild(now);
      box.appendChild(citeList(q.doubt.refs));
    }
    return box;
  }

  function renderCard(q, data, opts) {
    opts = opts || {};
    var answered = !!q.answer;
    var card = el('article', 'ex-q' + (answered ? '' : ' ex-unanswered'));
    card.id = 'q-' + q.n;
    card.setAttribute('data-qid', String(q.n));
    card.setAttribute('data-answer', q.answer || '');
    var head = el('div', 'ex-q-head');
    head.appendChild(el('span', 'ex-q-no', (opts.prefix || '') + '第 ' + q.n + ' 題'));
    var chips = el('span', 'ex-chips');
    q.ch.forEach(function (key) { chips.appendChild(chapterChip(key, q.n, data.chapters)); });
    head.appendChild(chips);
    card.appendChild(head);
    card.appendChild(rich('p', 'ex-stem', q.stem));
    if (q.image) {
      var img = el('img', 'ex-fig');
      img.src = q.image.src;
      img.alt = '第 ' + q.n + ' 題附圖';
      img.width = q.image.width;
      img.height = q.image.height;
      img.loading = 'lazy';
      card.appendChild(img);
    }
    var fs = el('fieldset', 'ex-opts');
    fs.appendChild(el('legend', 'ex-sr', '第 ' + q.n + ' 題選項'));
    Object.keys(q.options).forEach(function (k) {
      var label = el('label', 'ex-opt');
      label.setAttribute('data-key', k);
      if (q.answer === k) label.setAttribute('data-correct', '');
      var input = el('input');
      input.type = 'radio';
      input.name = 'ans-' + q.n + (opts.suffix || '');
      input.value = k;
      input.disabled = !answered;
      label.appendChild(input);
      label.appendChild(el('span', 'ex-opt-key', k));
      label.appendChild(rich('span', 'ex-opt-text', q.options[k]));
      fs.appendChild(label);
    });
    card.appendChild(fs);
    var actions = el('div', 'ex-actions');
    if (answered) {
      actions.appendChild(el('button', 'ex-submit', '送出答案'));
      actions.appendChild(el('button', 'ex-reset', '重新作答'));
      if (opts.removable) {
        var remove = el('button', 'ex-remove', '移出錯題本');
        remove.addEventListener('click', function () {
          markWrong(q.n, false);
          card.remove();
        });
        actions.appendChild(remove);
      }
      actions.querySelectorAll('button').forEach(function (b) { b.type = 'button'; });
      var res = el('span', 'ex-result');
      res.setAttribute('aria-live', 'polite');
      actions.appendChild(res);
    } else {
      actions.appendChild(el('span', 'ex-result', '尚未整理答案，暫時無法作答。'));
    }
    card.appendChild(actions);
    var reveal = el('div', 'ex-reveal');
    if (answered) {
      var ans = el('p', 'ex-answer', '答案：');
      ans.appendChild(el('strong', null, q.answer));
      ans.appendChild(el('span', 'ex-answer-src', '依 BCSC 判斷'));
      reveal.appendChild(ans);
      reveal.appendChild(rich('p', 'ex-summary', q.expl.summary));
      var items = el('ul', 'ex-items');
      q.expl.items.forEach(function (it) {
        var li = el('li', it.ok ? 'ex-ok' : 'ex-no');
        li.appendChild(el('span', 'ex-item-key', it.key));
        li.appendChild(el('span', 'ex-item-label', it.label));
        li.appendChild(rich('span', 'ex-item-text', it.text));
        var refs = el('span', 'ex-item-refs');
        it.refs.forEach(function (r) { refs.appendChild(el('span', 'ex-ref', r)); });
        li.appendChild(refs);
        items.appendChild(li);
      });
      reveal.appendChild(items);
      (q.expl.flags || []).forEach(function (f) { reveal.appendChild(rich('p', 'ex-warn', '⚠ ' + f)); });
      if (q.doubt) reveal.appendChild(doubtBox(q));
    } else {
      reveal.appendChild(el('p', 'ex-pending', '這題的答案與詳解尚未整理（讀到相關章節時會補上）。'));
    }
    card.appendChild(reveal);
    wireQuestion(card);
    return card;
  }

  function assetVersion() {
    var src = document.querySelector('script[src^="/exam/exam.js"]');
    return src ? (src.getAttribute('src').split('?v=')[1] || '') : '';
  }
  var notesPromise = null;
  // Public: chapter labels, note text for search, question→chapter numbers for progress.
  function notesData() {
    if (!notesPromise) {
      var v = assetVersion();
      notesPromise = fetch('/exam/notes-data.json' + (v ? '?v=' + v : ''), { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          try { if (data.taxa) taxonRe = new RegExp(data.taxa, 'g'); } catch (e) { taxonRe = null; }
          return data;
        });
    }
    return notesPromise;
  }
  var bankPromise = null;
  // Signed-in only: the server answers 401 without a valid session cookie.
  function bankData() {
    if (!bankPromise) {
      bankPromise = fetch('/api/exam/data', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) {
          if (r.status === 401 || r.status === 503) {
            var err = new Error('login required');
            err.login = true;
            throw err;
          }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          document.body.setAttribute('data-exam-bank', '1');
          return r.json();
        });
    }
    return bankPromise;
  }
  function examData() {
    return Promise.all([notesData(), bankData()]).then(function (both) {
      return { questions: both[1].questions, concepts: both[1].concepts, chapters: both[0].chapters,
        notes: both[0].notes, books: both[0].books };
    });
  }
  function loginHref() {
    return '/exam/login?next=' + encodeURIComponent(location.pathname);
  }
  // Replace a container's content with a login prompt (or a load error).
  function lockedNote(node, err, what) {
    clear(node);
    if (err && err.login) {
      var p = el('p', 'ex-locked', what + '需要先');
      var a = el('a', null, '登入題庫');
      a.href = loginHref();
      p.appendChild(a);
      p.appendChild(document.createTextNode('。'));
      node.appendChild(p);
    } else {
      node.appendChild(el('p', 'ex-pending', '題庫載入失敗，請重新整理頁面。'));
    }
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------------------------------------------------------- progress page
  function renderProgress(out, focusKey) {
    notesData().then(function (data) {
      // Re-rendering keeps the reader's expanded books and the focused checkbox.
      var parts = out.querySelectorAll('details[data-book]');
      var openBooks = null;
      if (parts.length) {
        openBooks = {};
        parts.forEach(function (d) { if (d.open) openBooks[d.getAttribute('data-book')] = true; });
      }
      var all = stats();
      var seen = visits();
      var read = readList();
      var rows = {};
      var order = [];
      var done = 0;
      var right = 0;
      var books = {};  // distinct questions per BCSC book (a question can span several chapters)
      data.qs.forEach(function (pair) {
        var q = { n: pair[0], ch: pair[1] };
        var s0 = validStat(all[q.n]) ? all[q.n] : null;
        if (s0) { done += 1; right += s0[0]; }
        var seenBooks = {};
        q.ch.forEach(function (key) {
          var b = key.split('-')[0];
          if (seenBooks[b]) return;
          seenBooks[b] = true;
          var t = books[b] || (books[b] = { total: 0, done: 0, right: 0 });
          t.total += 1;
          if (s0) { t.done += 1; t.right += s0[0]; }
        });
        q.ch.forEach(function (key) {
          if (!rows[key]) { rows[key] = { total: 0, done: 0, right: 0, last: 0 }; }
          var r = rows[key];
          r.total += 1;
          if (s0) {
            r.done += 1;
            r.right += s0[0];
            r.last = Math.max(r.last, Number(s0[2]) || 0);
          }
        });
      });
      Object.keys(data.chapters).forEach(function (key) {
        if (rows[key] || data.notes[key]) {
          if (!rows[key]) rows[key] = { total: 0, done: 0, right: 0, last: 0 };
          rows[key].last = Math.max(rows[key].last, Number(seen[key]) || 0);
          order.push(key);
        }
      });
      clear(out);
      var answeredTotal = data.qs.length;
      var readCount = order.filter(function (k) { return read.indexOf(k) !== -1; }).length;
      var summary = el('div', 'ex-summary-box');
      summary.appendChild(el('p', null, '已作答 ' + done + ' / ' + answeredTotal + ' 題 · 答對 ' + right
        + ' 題 · 正確率 ' + percent(right, done) + ' · 課本已讀完 ' + readCount + ' / ' + order.length + ' 章'));
      var weak = order.filter(function (k) { return rows[k].done >= 5 && rows[k].right / rows[k].done < 0.6; })
        .sort(function (a, b) { return rows[a].right / rows[a].done - rows[b].right / rows[b].done; });
      if (weak.length) {
        var w = el('p', 'ex-weak', '建議優先複習（作答 5 題以上、正確率低於 60%）：');
        weak.slice(0, 10).forEach(function (k, i) {
          if (i) w.appendChild(document.createTextNode('、'));
          var a = el('a', null, data.chapters[k].label + ' ' + data.chapters[k].title + '（' + percent(rows[k].right, rows[k].done) + '）');
          a.href = '/exam/bcsc' + k;
          w.appendChild(a);
        });
        summary.appendChild(w);
      }
      out.appendChild(summary);
      var byBook = {};
      order.forEach(function (k) { (byBook[k.split('-')[0]] = byBook[k.split('-')[0]] || []).push(k); });
      Object.keys(byBook).sort(function (a, b) { return a - b; }).forEach(function (book) {
        var keys = byBook[book];
        var t = books[book] || { total: 0, done: 0, right: 0 };
        var readHere = keys.filter(function (k) { return read.indexOf(k) !== -1; }).length;
        var part = el('details', 'ex-part');
        part.setAttribute('data-book', book);
        part.open = openBooks ? !!openBooks[book] : !!(t.done || readHere);
        var bookTitle = data.books && data.books[book] ? data.books[book] : '';
        part.appendChild(el('summary', null, 'BCSC ' + book + ' ' + bookTitle + ' · 作答 ' + t.done + ' / '
          + t.total + ' 題 · 正確率 ' + percent(t.right, t.done) + ' · 已讀 ' + readHere + ' / ' + keys.length + ' 章'));
        var table = el('table', 'ex-prog');
        var head = el('tr');
        ['章節', '課本已讀', '已作答', '正確率', '最後讀'].forEach(function (h, i) {
          var th = el('th', i >= 2 ? 'ex-num' : null, h);
          th.scope = 'col';
          head.appendChild(th);
        });
        var thead = el('thead');
        thead.appendChild(head);
        table.appendChild(thead);
        var tbody = el('tbody');
        keys.forEach(function (k) {
          var r = rows[k];
          var tr = el('tr');
          var name = el('td');
          var link = el('a', null, data.chapters[k].label + ' ' + data.chapters[k].title);
          link.href = '/exam/bcsc' + k;
          name.appendChild(link);
          tr.appendChild(name);
          var cell = el('td');
          var box = el('input');
          box.type = 'checkbox';
          box.checked = read.indexOf(k) !== -1;
          box.setAttribute('aria-label', data.chapters[k].label + ' 課本已讀完');
          box.setAttribute('data-chapter', k);
          box.addEventListener('change', function () { setRead(k, box.checked); renderProgress(out, k); });
          cell.appendChild(box);
          tr.appendChild(cell);
          tr.appendChild(el('td', 'ex-num', r.done + ' / ' + r.total));
          var acc = el('td', 'ex-num', percent(r.right, r.done));
          if (r.done >= 5 && r.right / r.done < 0.6) acc.classList.add('ex-low');
          tr.appendChild(acc);
          tr.appendChild(el('td', 'ex-num', dateText(r.last)));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        part.appendChild(table);
        out.appendChild(part);
      });
      if (focusKey) {
        var again = out.querySelector('input[data-chapter="' + focusKey + '"]');
        if (again) again.focus();
      }
    }).catch(function () {
      clear(out);
      out.appendChild(el('p', 'ex-pending', '題庫載入失敗，請重新整理頁面。'));
    });
  }

  // ---------------------------------------------------------- review page
  function renderReview(list) {
    examData().then(function (data) {
      var wrong = wrongList();
      var byN = {};
      data.questions.forEach(function (q) { byN[q.n] = q; });
      clear(list);
      var rows = wrong.map(function (n) { return byN[n]; }).filter(function (q) { return q && q.answer; });
      if (!rows.length) {
        list.appendChild(el('p', 'ex-pending', '目前沒有錯題。到章節頁或考古卷切換「作答模式」作答，答錯的題目會出現在這裡。'));
        return;
      }
      list.appendChild(el('p', 'ex-meta', '共 ' + rows.length + ' 題錯題'));
      rows.forEach(function (q) { list.appendChild(renderCard(q, data, { removable: true })); });
    }).catch(function (err) { lockedNote(list, err, '錯題本'); });
  }

  // ---------------------------------------------------------- Anki export
  function csvCell(text) { return '"' + String(text).replace(/"/g, '""') + '"'; }
  function htmlText(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }
  function ankiRows(questions) {
    return questions.map(function (q) {
      var front = htmlText(q.stem) + '<br>';
      Object.keys(q.options).forEach(function (k) { front += htmlText('(' + k + ') ' + q.options[k]) + '<br>'; });
      front += '<small>眼科專科考題 第 ' + q.n + ' 題 · ' + q.ch.map(function (c) { return 'BCSC ' + c; }).join('、') + '</small>';
      var back = '答案：' + q.answer + '<br>' + htmlText(q.expl.summary);
      q.expl.items.forEach(function (it) {
        back += '<br>' + htmlText(it.key + ' ' + it.label + '：' + it.text + '（' + it.refs.join('；') + '）');
      });
      (q.expl.flags || []).forEach(function (f) { back += '<br>' + htmlText('⚠ ' + f); });
      if (q.dispute) {
        back += '<br>' + htmlText('⚠ 答案存疑：' + q.dispute.text);
        q.dispute.refs.forEach(function (r) {
          back += '<br>' + htmlText('・' + r.t + (r.s ? '（' + r.s + '）' : '') + (r.u ? ' ' + r.u : ''));
        });
      }
      if (q.doubt) {
        back += '<br>' + htmlText('⚠ 考試答案 ' + q.answer + '：' + q.doubt.exam);
        if (q.doubt.now) {
          back += '<br>' + htmlText('現行觀念：' + q.doubt.now);
          q.doubt.refs.forEach(function (r) { back += '<br>' + htmlText('・' + r.t + '（' + r.s + '）' + r.u); });
        }
      }
      return csvCell(front) + ',' + csvCell(back);
    }).join('\n');
  }
  function download(name, text) {
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ---------------------------------------------------------- practice page
  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    return list;
  }

  function initPractice(form) {
    var list = document.getElementById('ex-practice-list');
    var note = form.querySelector('.ex-build-note');
    var bar = document.querySelector('[data-exam-bar]');
    var barApi = wireExamBar(bar, list);
    function setAll(checked) {
      form.querySelectorAll('input[name=ex-book]').forEach(function (box) { box.checked = checked; });
    }
    form.querySelector('.ex-books-all').addEventListener('click', function () { setAll(true); });
    form.querySelector('.ex-books-none').addEventListener('click', function () { setAll(false); });
    form.querySelector('.ex-build').addEventListener('click', function () {
      var books = [];
      form.querySelectorAll('input[name=ex-book]:checked').forEach(function (box) { books.push(box.value); });
      if (!books.length) { note.textContent = '請至少選一冊'; return; }
      var count = Number(form.querySelector('select[name=ex-count]').value);
      var order = form.querySelector('input[name=ex-order]:checked').value;
      note.textContent = '題目載入中…';
      examData().then(function (data) {
        var pool = data.questions.filter(function (q) {
          return q.ch.some(function (key) { return books.indexOf(key.split('-')[0]) !== -1; });
        });
        if (!pool.length) { note.textContent = '選的範圍內沒有符合的題目'; return; }
        if (order === 'random') shuffle(pool);
        if (count > 0) pool = pool.slice(0, count);
        clear(list);
        pool.forEach(function (q, i) { list.appendChild(renderCard(q, data, { prefix: (i + 1) + '. ', suffix: '-p' })); });
        note.textContent = '共 ' + pool.length + ' 題，計時開始';
        bar.hidden = false;
        barApi.start();
        list.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }).catch(function (err) {
        note.textContent = '';
        lockedNote(list, err, '考古卷');
      });
    });
  }

  // ---------------------------------------------------------- search page
  function terms(query) {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
  }
  function matches(text, words) {
    var low = text.toLowerCase();
    return words.every(function (w) { return low.indexOf(w) !== -1; });
  }
  function highlighted(text, words) {
    var frag = document.createDocumentFragment();
    var low = text.toLowerCase();
    var i = 0;
    while (i < text.length) {
      var best = -1;
      var len = 0;
      words.forEach(function (w) {
        var at = low.indexOf(w, i);
        if (at !== -1 && (best === -1 || at < best)) { best = at; len = w.length; }
      });
      if (best === -1) { frag.appendChild(document.createTextNode(text.slice(i))); break; }
      if (best > i) frag.appendChild(document.createTextNode(text.slice(i, best)));
      frag.appendChild(el('mark', null, text.slice(best, best + len)));
      i = best + len;
    }
    return frag;
  }
  function questionText(q) {
    var parts = [q.stem];
    Object.keys(q.options).forEach(function (k) { parts.push(q.options[k]); });
    if (q.expl) {
      parts.push(q.expl.summary);
      if (q.doubt) parts.push(q.doubt.exam, q.doubt.now);
      if (q.dispute) parts.push(q.dispute.text);
      q.expl.items.forEach(function (it) { parts.push(it.text); });
    }
    return parts.join(' ');
  }

  function runSearch(query, out) {
    var words = terms(query);
    clear(out);
    if (!words.length) return;
    out.appendChild(el('p', 'ex-pending', '搜尋中…'));
    notesData().then(function (data) {
      clear(out);
      var noteHits = [];
      Object.keys(data.notes).forEach(function (key) {
        data.notes[key].forEach(function (para) {
          if (matches(para.t, words)) noteHits.push({ key: key, h: para.h, t: para.t });
        });
      });
      out.appendChild(el('p', 'ex-meta', '重點 ' + noteHits.length + ' 筆'));
      if (noteHits.length) {
        out.appendChild(el('h2', 'ex-h2', '課本重點'));
        noteHits.slice(0, 60).forEach(function (hit) {
          var box = el('div', 'ex-hitbox');
          var link = el('a', null, data.chapters[hit.key].label + ' ' + data.chapters[hit.key].title);
          link.href = '/exam/bcsc' + hit.key + (hit.h ? '#' + hit.h : '');
          box.appendChild(link);
          var p = el('p');
          p.appendChild(highlighted(hit.t, words));
          box.appendChild(p);
          out.appendChild(box);
        });
      }
      if (!noteHits.length) out.appendChild(el('p', 'ex-pending', '重點整理中找不到符合的內容。'));
      var qBox = el('div', 'ex-search-qs');
      out.appendChild(qBox);
      examData().then(function (bank) {
        var qHits = bank.questions.filter(function (q) { return matches(questionText(q), words); });
        qBox.appendChild(el('h2', 'ex-h2', '考題（' + qHits.length + ' 題）'));
        if (qHits.length > 80) qBox.appendChild(el('p', 'ex-meta', '只顯示前 80 題，請加關鍵字縮小範圍。'));
        qHits.slice(0, 80).forEach(function (q) { qBox.appendChild(renderCard(q, bank, { suffix: '-s' })); });
      }).catch(function (err) { lockedNote(qBox, err, '搜尋考題'); });
    }).catch(function () {
      clear(out);
      out.appendChild(el('p', 'ex-pending', '資料載入失敗，請重新整理頁面。'));
    });
  }

  function initSearch(form) {
    var out = document.getElementById('ex-search-results');
    var input = form.querySelector('input[name=q]');
    var initial = new URLSearchParams(location.search).get('q');
    if (initial) { input.value = initial; runSearch(initial, out); }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var q = input.value.trim();
      try { history.replaceState(null, '', q ? '?q=' + encodeURIComponent(q) : location.pathname); } catch (e) { /* ignore */ }
      runSearch(q, out);
    });
  }

  // ---------------------------------------------------------- hub disease search
  // A disease name, full or abbreviated, in any letter case. Hyphens, dashes and
  // spaces are interchangeable ("Vogt Koyanagi Harada" finds "Vogt-Koyanagi-Harada").
  // A short Latin abbreviation (PVRL, VKH, RP) must stand alone, so "RP" does not
  // match inside "RPE"; a trailing plural "s" is allowed.
  var SEP_RE = /[\s\-‐-―\/]+/;
  function finder(query) {
    var q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    var parts = q.split(SEP_RE).filter(Boolean);
    if (!parts.length) return null;
    var src = parts.map(function (p) { return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
      .join('[\\s\\-\\u2010-\\u2015\\/]*');
    return { q: q, parts: parts, re: new RegExp(src, 'gi'), word: /^[A-Za-z0-9]{1,6}$/.test(q) };
  }
  function ranges(text, f) {
    var out = [];
    var m;
    f.re.lastIndex = 0;
    while ((m = f.re.exec(text))) {
      var s = m.index;
      var e = s + m[0].length;
      if (e === s) { f.re.lastIndex += 1; continue; }
      if (f.word) {
        var next = text.charAt(e);
        if (/[A-Za-z0-9]/.test(text.charAt(s - 1))) continue;
        if (/[A-Za-z0-9]/.test(next) && !(next.toLowerCase() === 's' && !/[A-Za-z0-9]/.test(text.charAt(e + 1)))) continue;
      }
      out.push([s, e]);
    }
    return out;
  }
  // Ranges for the whole phrase; with several words and no phrase hit, every word
  // must appear somewhere in the text (and each is marked).
  function hitRanges(text, f) {
    var r = ranges(text, f);
    if (r.length || f.parts.length < 2 || !f.each) return r;
    var all = [];
    for (var i = 0; i < f.each.length; i++) {
      var one = ranges(text, f.each[i]);
      if (!one.length) return [];
      all = all.concat(one);
    }
    return all.sort(function (a, b) { return a[0] - b[0]; });
  }
  function wordFinders(f) {
    return f.parts.map(function (p) { return finder(p); });
  }
  function markedText(text, rs) {
    var frag = document.createDocumentFragment();
    var at = 0;
    rs.forEach(function (r) {
      if (r[0] < at) return;
      if (r[0] > at) frag.appendChild(document.createTextNode(text.slice(at, r[0])));
      frag.appendChild(el('mark', null, text.slice(r[0], r[1])));
      at = r[1];
    });
    if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
    return frag;
  }
  function snippet(text, rs) {
    var start = Math.max(0, rs[0][0] - 36);
    var end = Math.min(text.length, rs[0][1] + 96);
    var shifted = rs.filter(function (r) { return r[0] >= start && r[1] <= end; })
      .map(function (r) { return [r[0] - start, r[1] - start]; });
    var span = el('span', 'ex-find-snip');
    if (start > 0) span.appendChild(document.createTextNode('…'));
    span.appendChild(markedText(text.slice(start, end), shifted));
    if (end < text.length) span.appendChild(document.createTextNode('…'));
    return span;
  }
  function chapterOrder(a, b) {
    var x = a.split('-').map(Number);
    var y = b.split('-').map(Number);
    return x[0] - y[0] || x[1] - y[1];
  }
  function landingHref(key, f, para) {
    return '/exam/bcsc' + key + '?hl=' + encodeURIComponent(f.q) + '#np-' + (para + 1);
  }
  var SHOW_HITS = 5;
  function hubSearch(query, input, out, status) {
    var f = finder(query);
    clear(out);
    if (!f || f.q.length < 2) { status.textContent = ''; return; }
    status.textContent = '搜尋中…';
    notesData().then(function (data) {
      if (finder(input.value) === null || finder(input.value).q !== f.q) return;  // a newer query is pending
      var groups = [];
      var total = 0;
      function collect(fd) {
        groups = [];
        total = 0;
        Object.keys(data.chapters).forEach(function (key) {
          var ch = data.chapters[key];
          var paras = data.notes[key] || [];
          if (!paras.length && !ch.q) return;  // no chapter page to link to
          var hits = [];
          paras.forEach(function (p, i) {
            var r = hitRanges(p.t, fd);
            if (r.length) hits.push({ i: i, p: p, r: r });
          });
          if (hits.length || ranges(ch.title, fd).length) {
            groups.push({ key: key, ch: ch, hits: hits });
            total += hits.length;
          }
        });
      }
      collect(f);
      var loose = false;
      if (!groups.length && f.parts.length > 1) {
        f.each = wordFinders(f);
        collect(f);
        loose = groups.length > 0;
      }
      groups.sort(function (a, b) { return b.hits.length - a.hits.length || chapterOrder(a.key, b.key); });
      clear(out);
      var more = el('p', 'ex-meta');
      var link = el('a', null, '到搜尋頁也搜尋考題（需登入）');
      link.href = '/exam/search?q=' + encodeURIComponent(f.q);
      more.appendChild(link);
      if (!groups.length) {
        status.textContent = '課本重點與章節名稱中找不到「' + f.q + '」。';
        out.appendChild(more);
        return;
      }
      status.textContent = '「' + f.q + '」出現在 ' + groups.length + ' 章' + (total ? '、共 ' + total + ' 段重點' : '')
        + (loose ? '（找不到完整詞組，列出含有所有關鍵字的段落）' : '') + '。';
      out.appendChild(el('h2', 'ex-find-title', '搜尋結果'));
      groups.forEach(function (g) {
        var box = el('section', 'ex-find-group');
        var h = el('h3', 'ex-find-h');
        var a = el('a', null, g.ch.label + ' ' + g.ch.title);
        a.href = g.hits.length ? landingHref(g.key, f, g.hits[0].i) : '/exam/bcsc' + g.key;
        h.appendChild(a);
        h.appendChild(el('span', 'ex-count', g.hits.length ? g.hits.length + ' 段'
          : (data.notes[g.key] ? '章節名稱符合' : '章節名稱符合，重點尚未整理')));
        box.appendChild(h);
        if (g.hits.length) {
          var list = el('ul', 'ex-find-list');
          g.hits.forEach(function (hit, n) {
            var li = el('li');
            if (n >= SHOW_HITS) li.hidden = true;
            var link = el('a');
            link.href = landingHref(g.key, f, hit.i);
            var sec = g.ch.secs && g.ch.secs[hit.p.h];
            if (sec) link.appendChild(el('span', 'ex-find-sec', sec));
            link.appendChild(snippet(hit.p.t, hit.r));
            li.appendChild(link);
            list.appendChild(li);
          });
          box.appendChild(list);
          if (g.hits.length > SHOW_HITS) {
            var btn = el('button', 'ex-find-more', '再顯示 ' + (g.hits.length - SHOW_HITS) + ' 段');
            btn.type = 'button';
            btn.addEventListener('click', function () {
              var first = null;
              list.querySelectorAll('li[hidden]').forEach(function (li) { li.hidden = false; first = first || li; });
              btn.remove();
              if (first) first.querySelector('a').focus();
            });
            box.appendChild(btn);
          }
        }
        out.appendChild(box);
      });
      out.appendChild(more);
    }).catch(function () {
      status.textContent = '資料載入失敗，請重新整理頁面。';
    });
  }
  function initHubSearch(form) {
    var input = form.querySelector('input[name=q]');
    var out = document.getElementById('ex-find-results');
    var status = document.querySelector('.ex-find-status');
    var timer = null;
    function run() {
      clearTimeout(timer);
      var q = input.value.trim();
      try { history.replaceState(null, '', q ? '?q=' + encodeURIComponent(q) : location.pathname); } catch (e) { /* ignore */ }
      hubSearch(q, input, out, status);
    }
    input.addEventListener('focus', function () { notesData().catch(function () { /* reported on search */ }); });
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 250); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && input.value) { input.value = ''; run(); }
    });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); run(); });
    var initial = new URLSearchParams(location.search).get('q');
    if (initial) { input.value = initial; run(); }
  }

  // Frequency table: TOP_N rows at a time; the server-rendered table lists every chapter.
  function initRank(table) {
    var step = Number(table.getAttribute('data-rank-step')) || 25;
    var rows = table.tBodies[0] ? table.tBodies[0].rows : [];
    var more = document.querySelector('.ex-more');
    if (!more || rows.length <= step) return;
    var btn = more.querySelector('.ex-more-btn');
    var status = more.querySelector('.ex-more-status');
    var shown = step;
    for (var i = step; i < rows.length; i++) rows[i].hidden = true;
    function update() { status.textContent = '已顯示 ' + shown + ' / ' + rows.length + ' 章'; }
    btn.addEventListener('click', function () {
      var first = rows[shown];
      var end = Math.min(shown + step, rows.length);
      for (var j = shown; j < end; j++) rows[j].hidden = false;
      shown = end;
      update();
      if (shown >= rows.length) {
        more.hidden = true;
        var a = first.querySelector('a');
        if (a) a.focus();
      }
    });
    update();
    more.hidden = false;
  }

  // Chapter page reached from a search result (?hl=term#np-N): mark the term in the
  // notes and keep the linked paragraph (styled by :target) in view while the page settles.
  function markNotes(root, f) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    var count = 0;
    nodes.forEach(function (node) {
      if (count > 400) return;
      var rs = ranges(node.nodeValue, f);
      if (!rs.length) return;
      var frag = markedText(node.nodeValue, rs);
      frag.querySelectorAll('mark').forEach(function (m) { m.className = 'ex-find-hl'; });
      count += rs.length;
      node.parentNode.replaceChild(frag, node);
    });
    return count;
  }
  function initLanding() {
    var note = document.querySelector('.ex-note');
    if (!note) return null;
    var f = finder(new URLSearchParams(location.search).get('hl'));
    if (f && f.q.length >= 2 && !markNotes(note, f) && f.parts.length > 1) {
      wordFinders(f).forEach(function (one) { if (one.q.length >= 2) markNotes(note, one); });
    }
    var target = /^#np-\d+$/.test(location.hash) ? document.getElementById(location.hash.slice(1)) : null;
    if (!target || !note.contains(target)) return null;
    var moved = false;
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) {
      window.addEventListener(type, function () { moved = true; }, { once: true, passive: true });
    });
    function place() { if (!moved) target.scrollIntoView({ block: 'center' }); }
    place();
    window.addEventListener('load', place);
    return place;
  }

  // ---------------------------------------------------------- reading position
  // Chapter notes remember, per device, the section the reader was in (the last note
  // heading or np-N paragraph that has scrolled up to just under the sticky header).
  // The next visit without an explicit target (#hash or ?hl=) lands there again with a
  // notice offering 「從頭開始」. Scrolling above the notes forgets the position;
  // reading the questions below the notes keeps it.
  function initReadingPosition(key) {
    var note = document.querySelector('.ex-note');
    if (!note || !key) return null;
    var anchors = note.querySelectorAll('h2[id], h3[id], [id^="np-"]');
    if (!anchors.length) return null;
    var notice = null;
    var armed = false;   // only the reader's own scrolling is saved, not the page settling
    var timer = null;
    var lastId;

    function line() {
      // Note anchors scroll to 80–96px from the top (scroll-margin-top); count those as reached.
      return headerBottom() + (notice ? notice.offsetHeight + 8 : 0) + 48;
    }
    // '' = above the notes (top of the page); null = below them (keep what is saved).
    function currentAnchor() {
      var y = line();
      var box = note.getBoundingClientRect();
      if (box.top > y) return '';
      if (box.bottom <= y) return null;
      var found = '';
      for (var i = 0; i < anchors.length; i++) {
        var r = anchors[i].getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.top > y) break;
        found = anchors[i].id;
      }
      return found;
    }
    function save() {
      timer = null;
      if (!armed) return;
      var id = currentAnchor();
      if (id === null || id === lastId) return;
      lastId = id;
      var all = positions();
      if (id) all[key] = { id: id, t: Date.now() };
      else delete all[key];
      store(POS_KEY, all);
    }
    function arm() { armed = true; }
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (type) {
      window.addEventListener(type, arm, { once: true, passive: true });
    });
    // Scrollbar drags send no input event: arm anyway once the page has settled.
    window.addEventListener('load', function () { setTimeout(arm, 1500); });
    // Saved once scrolling pauses, so a long (or smooth) scroll stores where it ended.
    window.addEventListener('scroll', function () {
      if (!armed) return;
      clearTimeout(timer);
      timer = setTimeout(save, 250);
    }, { passive: true });
    window.addEventListener('pagehide', function () { clearTimeout(timer); save(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { clearTimeout(timer); save(); }
    });

    var params = new URLSearchParams(location.search);
    if (location.hash || params.has('hl')) return null;   // an explicit target wins
    var saved = positions()[key];
    var target = saved && typeof saved.id === 'string' && /^[\w-]+$/.test(saved.id) ? document.getElementById(saved.id) : null;
    if (!target || !note.contains(target)) return null;
    // Already on the first screen: nothing to skip.
    if (target.getBoundingClientRect().top + window.pageYOffset < window.innerHeight * 0.5) return null;
    lastId = saved.id;

    var h2 = null;
    var h3 = null;
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      if (a.tagName === 'H2') { h2 = a; h3 = null; } else if (a.tagName === 'H3') { h3 = a; }
      if (a === target) break;
    }
    function text(node) { return (node.textContent || '').replace(/\s+/g, ' ').trim(); }
    var title = [h2, h3].filter(Boolean).map(text).join(' › ');
    if (!title) { title = text(target); if (title.length > 30) title = title.slice(0, 30) + '…'; }

    notice = el('div', 'ex-resume');
    notice.setAttribute('role', 'status');
    var msg = el('span', 'ex-resume-text');
    var restart = el('button', 'ex-resume-top', '從頭開始');
    restart.type = 'button';
    var close = el('button', 'ex-resume-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉提示');
    notice.appendChild(msg);
    notice.appendChild(restart);
    notice.appendChild(close);
    var section = note.closest('.ex-notes') || note.parentNode;
    var heading = section.querySelector('#notes-h');
    section.insertBefore(notice, heading ? heading.nextSibling : section.firstChild);
    // Filled after insertion so screen readers announce it as a status message.
    setTimeout(function () { msg.textContent = '已跳到上次讀到的位置：' + title; }, 50);

    var moved = false;
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (type) {
      window.addEventListener(type, function () { moved = true; }, { once: true, passive: true });
    });
    function dismiss(focusNode) {
      if (!notice) return;
      notice.remove();
      notice = null;
      if (focusNode) {
        if (!focusNode.hasAttribute('tabindex')) focusNode.setAttribute('tabindex', '-1');
        try { focusNode.focus({ preventScroll: true }); } catch (e) { focusNode.focus(); }
      }
    }
    restart.addEventListener('click', function () {
      var all = positions();
      delete all[key];
      store(POS_KEY, all);
      lastId = '';
      dismiss(document.querySelector('.ex-h1'));
      scrollToY(0, true);
    });
    close.addEventListener('click', function () { dismiss(target); });
    function place() {
      if (moved || !notice || !document.contains(target)) return;
      scrollToY(target.getBoundingClientRect().top + window.pageYOffset - line() + 36, false);
    }
    place();
    window.addEventListener('load', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place, function () { /* ignore */ });
    return place;
  }

  // ---------------------------------------------------------- sticky chapter outline
  // Wide screens show 「本章目錄」 as a sticky left column (CSS). Mark the section the
  // reader is in (aria-current) and keep that entry inside the column's own scroll.
  function initTocSpy(nav) {
    var links = Array.prototype.filter.call(nav.querySelectorAll('a[href^="#"]'), function (a) {
      return document.getElementById(a.getAttribute('href').slice(1));
    });
    if (!links.length) return;
    var targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
    var current = null;
    var queued = false;
    function update() {
      queued = false;
      if (!nav.offsetParent) return;   // hidden on narrow screens
      var y = headerBottom() + 96;
      var found = null;
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].getBoundingClientRect().top > y) break;
        found = links[i];
      }
      if (found === current) return;
      if (current) current.removeAttribute('aria-current');
      current = found;
      if (!current) return;
      current.setAttribute('aria-current', 'location');
      // Scroll only the outline column, never the page (the sticky nav is the
      // links' offsetParent, so offsetTop is measured inside it).
      var top = current.offsetTop;
      if (top < nav.scrollTop + 32 || top + current.offsetHeight > nav.scrollTop + nav.clientHeight - 32) {
        nav.scrollTop = Math.max(0, top - nav.clientHeight / 3);
      }
    }
    function queue() {
      if (queued) return;
      queued = true;
      if (window.requestAnimationFrame) window.requestAnimationFrame(update);
      else setTimeout(update, 16);
    }
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    window.addEventListener('load', queue);
    update();
  }

  // ---------------------------------------------------------- chapter answer bar
  // Quiz mode only (CSS hides it in browse mode): 「已作答 X／Y 題・未作答 Z 題」, a
  // button to the next unanswered question, and 「清除本章作答紀錄」 in the tools row.
  function initAnswerBar(box, tools) {
    function cards() {
      var seen = {};
      return Array.prototype.filter.call(box.querySelectorAll('.ex-q:not(.ex-unanswered)'), function (card) {
        var n = card.getAttribute('data-qid');
        if (seen[n]) return false;
        seen[n] = true;
        return true;
      });
    }
    var bar = el('div', 'ex-ans-bar');
    var status = el('span', 'ex-ans-text');
    var next = el('button', 'ex-ans-next', '跳到下一題未作答');
    next.type = 'button';
    var live = el('span', 'ex-sr');
    live.setAttribute('aria-live', 'polite');
    bar.appendChild(status);
    bar.appendChild(next);
    bar.appendChild(live);
    box.parentNode.insertBefore(bar, box);
    var lastJump = null;
    var wipe = el('button', 'ex-ans-clear', '清除本章作答紀錄');
    wipe.type = 'button';
    if (tools) tools.appendChild(wipe);

    function refresh() {
      var list = cards();
      var done = list.filter(function (c) { return c.classList.contains('ex-done'); }).length;
      bar.hidden = !list.length;
      wipe.hidden = !list.length;
      status.textContent = '已作答 ' + done + '／' + list.length + ' 題・未作答 ' + (list.length - done) + ' 題';
      next.disabled = done >= list.length;
    }
    next.addEventListener('click', function () {
      var list = cards();
      // Search onward from the question at the top of the screen (or the one just
      // jumped to, while a smooth scroll is still on its way), wrapping to the start.
      var current = -1;
      var y = headerBottom() + bar.offsetHeight + 24;
      for (var i = 0; i < list.length; i++) {
        if (list[i].getBoundingClientRect().top > y) break;
        current = i;
      }
      if (lastJump && Date.now() - lastJump.t < 1500) current = Math.max(current, list.indexOf(lastJump.card));
      for (var k = 1; k <= list.length; k++) {
        var card = list[(current + k) % list.length];
        if (card.classList.contains('ex-done')) continue;
        scrollToY(card.getBoundingClientRect().top + window.pageYOffset - headerBottom() - bar.offsetHeight - 12, true);
        card.setAttribute('tabindex', '-1');
        try { card.focus({ preventScroll: true }); } catch (e) { card.focus(); }
        lastJump = { card: card, t: Date.now() };
        return;
      }
      live.textContent = '本章題目都作答過了';
    });
    wipe.addEventListener('click', function () {
      var all = Array.prototype.slice.call(box.querySelectorAll('.ex-q'));
      var ns = all.map(function (c) { return c.getAttribute('data-qid'); });
      if (!window.confirm('確定要清除本章 ' + cards().length + ' 題在這台裝置上的作答紀錄嗎？'
        + '（同一題若也標在其他章節，那邊的作答紀錄也會一起清除；錯題本與「課本已讀完」不受影響）')) return;
      forget(ANS_KEY, ns);
      forget(STATS_KEY, ns);
      all.forEach(function (card) { resetQuestion(card, false); });
      refreshStrip();
      refresh();
      live.textContent = '已清除本章作答紀錄';
    });
    return { refresh: refresh };
  }

  // ---------------------------------------------------------- chapter questions
  function renderChapterQuestions(box) {
    var key = box.getAttribute('data-chapter');
    examData().then(function (data) {
      var qs = data.questions.filter(function (q) { return q.ch.indexOf(key) !== -1; });
      var byN = {};
      qs.forEach(function (q) { byN[q.n] = q; });
      var groups = [];
      data.concepts.forEach(function (c) {
        var members = c.qs.filter(function (n) { return byN[n]; }).map(function (n) { return byN[n]; });
        if (members.length >= 2) groups.push({ c: c, m: members });
      });
      groups.sort(function (a, b) { return b.m.length - a.m.length || a.m[0].n - b.m[0].n; });
      var grouped = {};
      groups.forEach(function (g) { g.m.forEach(function (q) { grouped[q.n] = true; }); });
      var rest = qs.filter(function (q) { return !grouped[q.n]; });
      function heading(id, text, count) {
        var h = el('h3', 'ex-concept', text);
        h.id = id;
        h.appendChild(el('span', 'ex-count', count + ' 題'));
        return h;
      }
      clear(box);
      if (groups.length) box.appendChild(el('p', 'ex-meta', '考同一個觀念的題目排在一起，可以一次看完不同考法。'));
      groups.forEach(function (g) {
        box.appendChild(heading('cg-' + g.c.id, '考點：' + g.c.t, g.m.length));
        g.m.forEach(function (q) { box.appendChild(renderCard(q, data, { current: key })); });
      });
      if (groups.length && rest.length) box.appendChild(heading('cg-other', '其他考題', rest.length));
      rest.forEach(function (q) { box.appendChild(renderCard(q, data, { current: key })); });
      var tools = document.querySelector('.ex-qs-tools');
      if (tools) tools.hidden = false;
      answerBar = initAnswerBar(box, tools);
      restoreChoices(box);
      refreshAnswerBar();
      refreshStrip();
      var target = /^#q-\d+$/.test(location.hash) ? document.getElementById(location.hash.slice(1)) : null;
      if (target) target.scrollIntoView();
    }).catch(function (err) {
      if (!err || !err.login) lockedNote(box, err, '本章考題');
    });
  }

  // Every exam page except the login page shows the sign-in state with a one-click logout.
  function initAuthBar(bar, settle) {
    fetch('/api/exam/data?check=1', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.status === 204; }, function () { return false; })
      .then(function (signedIn) {
        clear(bar);
        if (signedIn) {
          bar.appendChild(el('span', null, '已登入題庫'));
          var form = el('form');
          form.method = 'post';
          form.action = '/api/exam/logout';
          var btn = el('button', 'ex-link-btn', '登出');
          btn.type = 'submit';
          form.appendChild(btn);
          bar.appendChild(form);
        } else {
          var a = el('a', null, '登入題庫');
          a.href = loginHref();
          bar.appendChild(a);
        }
        bar.hidden = false;
        if (settle) settle();
      });
  }

  function initLogin(form) {
    var params = new URLSearchParams(location.search);
    var next = params.get('next') || '';
    if (/^\/exam(?:\/[a-z0-9-]+)?(?:#q-\d{1,5})?$/.test(next)) form.querySelector('input[name=next]').value = next;
    var msg = document.querySelector('.ex-login-msg');
    var text = { wrong: '密碼不正確，請再試一次。', rate: '嘗試次數過多，請 10 分鐘後再試。',
      config: '題庫登入尚未設定，請聯絡網站管理者。' }[params.get('error') || ''] || (params.get('out') ? '已登出這台裝置。' : '');
    if (msg && text) { msg.textContent = text; msg.hidden = false; }
  }

  // Back/forward cache: a page restored after logout must not keep the signed-in
  // bank. Drop it (and rendered question cards) when the page is hidden, and
  // reload a restored page that had it so access is checked again.
  window.addEventListener('pagehide', function () {
    bankPromise = null;
    document.querySelectorAll('.ex-q, .ex-search-qs').forEach(function (node) { node.remove(); });
  });
  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted && document.body.getAttribute('data-exam-bank') === '1') location.reload();
  });

  // ---------------------------------------------------------- init
  function init() {
    if (window.DN && typeof window.DN.initBlog === 'function') window.DN.initBlog({});
    document.querySelectorAll('.ex-mode').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMode(btn.getAttribute('data-mode'));
        // Entering quiz mode shows the stored answers of this chapter's questions.
        restoreChoices(document.getElementById('ex-chapter-qs'));
      });
    });
    setMode(load(MODE_KEY, 'browse') === 'quiz' ? 'quiz' : 'browse');
    document.querySelectorAll('.ex-q').forEach(wireQuestion);
    var form = document.querySelector('[data-practice-form]');
    if (form) initPractice(form);
    var list = document.getElementById('ex-review-list');
    if (list) renderReview(list);
    var search = document.querySelector('[data-search-form]');
    if (search) initSearch(search);
    var strip = document.querySelector('[data-progress-chapter]');
    if (strip) initStrip(strip);
    var chapterQs = document.getElementById('ex-chapter-qs');
    if (chapterQs) renderChapterQuestions(chapterQs);
    var landing = initLanding();
    var resume = initReadingPosition(strip ? strip.getAttribute('data-progress-chapter') : '');
    var settle = landing || resume;
    var tocSide = document.querySelector('.ex-toc-side');
    if (tocSide) initTocSpy(tocSide);
    var hubSearchForm = document.querySelector('[data-hub-search]');
    if (hubSearchForm) initHubSearch(hubSearchForm);
    var rank = document.querySelector('table.ex-rank[data-rank-step]');
    if (rank) initRank(rank);
    var authBar = document.querySelector('.ex-auth');
    if (authBar) initAuthBar(authBar, settle);
    var loginForm = document.querySelector('form.ex-login');
    if (loginForm) initLogin(loginForm);
    var progress = document.getElementById('ex-progress');
    if (progress) renderProgress(progress);
    var clearProgress = document.querySelector('.ex-clear-progress');
    if (clearProgress) {
      clearProgress.addEventListener('click', function () {
        if (!window.confirm('確定要清除這台裝置上的作答紀錄（含各題上次選的答案）與最後讀的日期嗎？（「課本已讀完」與錯題本不受影響）')) return;
        store(STATS_KEY, {});
        store(VISIT_KEY, {});
        store(ANS_KEY, {});
        if (progress) renderProgress(progress);
      });
    }
    document.querySelectorAll('.ex-anki').forEach(function (btn) {
      btn.addEventListener('click', function () {
        examData().then(function (data) {
          var scope = btn.getAttribute('data-scope');
          var wrong = wrongList();
          var rows = data.questions.filter(function (q) {
            return q.answer && (scope !== 'wrong' || wrong.indexOf(q.n) !== -1);
          });
          download(scope === 'wrong' ? 'ophtho-board-wrong.csv' : 'ophtho-board-answered.csv', ankiRows(rows));
        }).catch(function (err) {
          if (err && err.login) location.href = loginHref();
        });
      });
    });
    var clearBtn = document.querySelector('.ex-clear-wrong');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        store(WRONG_KEY, []);
        if (list) renderReview(list);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
