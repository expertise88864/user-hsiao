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
  // { chapter key: { id: note anchor id, t: saved ms, h: 'h2 › h3' section title (optional, ≤120) } }
  var POS_KEY = 'hs:exam:pos';
  var PSORT_KEY = 'hs:exam:psort';   // /exam/progress chapter order: 'order' | 'todo' | 'low' | 'reading'
  // { chapter key: { g: generation id, r: finished rounds, seen: { h2 id: 1 }, pct: 0-100,
  //   t: saved ms, done: [finish ms, newest 20] } } (see "reading rounds")
  var READING_KEY = 'hs:exam:reading';
  // The /exam/practice paper not handed in yet (see "practice paper"):
  // { id: attempt id, rev: save count, ids: [question n, paper order], sel: { n: option
  //   picked, not submitted }, done: { n: option submitted }, el: ms the timer counted,
  //   t: saved ms, set: { b: [BCSC books], c: question count (0 = all), o: 'random' | 'number' } }
  var PAPER_KEY = 'hs:exam:paper';
  // hs:exam:paper-time:<page id> = { id: paper id, el: ms counted }, one key per open
  // practice page, written by that page alone when it is hidden or left.
  var PAPER_TIME_PREFIX = 'hs:exam:paper-time:';
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
  // 2026/11/3, as the derm section shows a restored answer's date.
  function day(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
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
    card.classList.remove('ex-hide');
    card.removeAttribute('data-outcome');
    card.querySelectorAll('.ex-opt').forEach(function (opt) { opt.classList.remove('ex-picked'); });
    card.querySelectorAll('input[type=radio]').forEach(function (input) { input.checked = false; input.disabled = false; });
    var result = card.querySelector('.ex-result');
    if (result) result.textContent = '';
    if (forgetChoice) forget(ANS_KEY, [card.getAttribute('data-qid')]);
    refreshAnswerBar();
  }

  // Graded look of a card: picked option, right/wrong feedback, explanation shown.
  // note: extra text after the verdict (a restored answer's date).
  function showGraded(card, picked, note) {
    var answer = card.getAttribute('data-answer') || '';
    var ok = picked.value === answer;
    card.classList.add('ex-done');
    card.setAttribute('data-outcome', ok ? 'right' : 'wrong');
    picked.closest('.ex-opt').classList.add('ex-picked');
    card.querySelectorAll('input[type=radio]').forEach(function (input) { input.disabled = true; });
    var result = card.querySelector('.ex-result');
    if (result) result.textContent = (ok ? '答對了' : '答錯了，答案是 ' + answer) + (note || '');
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
        showGraded(card, inputs[i], Number(saved.t) > 0 ? '（' + day(Number(saved.t)) + ' 作答）' : '');
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

  // Practice paper bar. The timer keeps the time counted so far (not a start time), and
  // counts only while the page is shown: initPractice pauses it when the tab is hidden or
  // the page left, so time spent away never counts. A stalled interval (a sleeping
  // computer) adds at most TIMER_GAP. hooks.save runs every 10 s of counted time,
  // hooks.finish(gradeAll) when 交卷 is pressed (it grades when ready).
  var TIMER_GAP = 5000;
  function wireExamBar(bar, scope, hooks) {
    var timerEl = bar.querySelector('.ex-timer');
    var scoreEl = bar.querySelector('.ex-score');
    var finishBtn = bar.querySelector('.ex-finish');
    var counted = 0;     // ms counted up to `last`
    var last = null;     // when the running stretch was last counted (null: paused)
    var timer = null;
    var active = false;  // a paper is being worked on (from start to hand-in)
    var savedAt = 0;
    function accrue() {
      if (last === null) return;
      var now = Date.now();
      counted += Math.min(Math.max(now - last, 0), TIMER_GAP);
      last = now;
    }
    function render() {
      var s = Math.floor(counted / 1000);
      var m = Math.floor(s / 60);
      timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    }
    function tick() {
      accrue();
      render();
      if (counted - savedAt >= 10000) {
        savedAt = counted;
        if (hooks.save) hooks.save();
      }
    }
    function run() {
      if (!active || timer || document.visibilityState === 'hidden') return;
      last = Date.now();
      timer = setInterval(tick, 1000);
    }
    function pause() {
      accrue();
      last = null;
      if (timer) { clearInterval(timer); timer = null; }
      render();
    }
    // elapsed: time already counted (a resumed paper); keepCards: the cards show the
    // resumed paper's answers, so they are not reset.
    function start(elapsed, keepCards) {
      setMode('quiz');
      if (!keepCards) scope.querySelectorAll('.ex-q').forEach(function (card) { resetQuestion(card, false); });
      scoreEl.textContent = '';
      pause();
      counted = elapsed > 0 ? elapsed : 0;
      savedAt = counted;
      active = true;
      finishBtn.disabled = false;
      render();
      run();
    }
    function stop(message) {
      pause();
      active = false;
      if (typeof message === 'string') scoreEl.textContent = message;
    }
    function elapsed() { accrue(); return counted; }
    // Another tab counted further on the same paper: continue from its time.
    function catchUp(ms) {
      accrue();
      if (ms > counted) { counted = ms; render(); }
    }
    // Grade every card; hooks.finish(gradeAll) decides when (initPractice first brings
    // the cards up to date with the stored paper).
    finishBtn.addEventListener('click', function () {
      stop();
      if (hooks.finish) hooks.finish(gradeAll);
      else gradeAll();
    });
    function gradeAll() {
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
      refreshAnswerBar();
    }
    return { start: start, stop: stop, pause: pause, run: run, elapsed: elapsed, catchUp: catchUp };
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

  // The chapter page being read gets a highlighted chip that is not a link.
  function chapterChip(key, n, chapters, current) {
    var parts = key.split('-');
    var label = 'BCSC ' + parts[0] + ' · Ch.' + parts[1];
    var chip = key === current ? el('span', 'ex-chip ex-chip-on', label) : el('a', 'ex-chip', label);
    if (key !== current) chip.href = '/exam/bcsc' + key + '#q-' + n;
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

  // doubts.json "cat" (labels as on the derm section; _gen_exam.DOUBT_CAT_LABELS).
  var DOUBT_CATS = {
    outdated: '舊版觀念', bcsc_silent: '課本未提及', bcsc_conflict: '說法矛盾',
    ambiguous: '選項模稜兩可', typo: '題目誤植'
  };
  function doubtBox(q) {
    var box = el('div', 'ex-doubt');
    box.appendChild(el('p', 'ex-doubt-h', '⚠ 疑義題 · ' + (own(DOUBT_CATS, q.doubt.cat) ? DOUBT_CATS[q.doubt.cat] : '疑義')));
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
    q.ch.forEach(function (key) { chips.appendChild(chapterChip(key, q.n, data.chapters, opts.current)); });
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
          if (typeof opts.removable === 'function') opts.removable();
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
  // Answer-key corrections (e.g. Q703): every graded answer stores its chosen option in
  // hs:exam:ans next to the [1|0, …] result in hs:exam:stats (grade() writes both; nothing
  // writes a result alone), so a result graded against an older key is re-derived from
  // that option and the bank's current answer, and the wrong-answer notebook follows it.
  // A result without a stored option (「重新作答」 forgot it) is left as it is.
  var corrected = null;
  function correctRecords(questions) {
    var all = stats();
    var picks = choices();
    var changed = false;
    questions.forEach(function (q) {
      var s = all[q.n];
      var a = picks[q.n];
      if (!q.answer || !validStat(s) || !a || typeof a !== 'object' || typeof a.c !== 'string') return;
      if (!own(q.options, a.c)) return;
      var ok = a.c === q.answer ? 1 : 0;
      if (s[0] === ok) return;
      s[0] = ok;
      markWrong(q.n, !ok);
      changed = true;
    });
    if (changed) store(STATS_KEY, all);
  }
  function examData() {
    return Promise.all([notesData(), bankData()]).then(function (both) {
      if (corrected !== both[1]) {
        corrected = both[1];
        correctRecords(both[1].questions);
      }
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
  // Chapter order inside each book table (as on the dermatology exam section): the
  // reader's choice is remembered on this device; 'order' is the BCSC order.
  var SORTS = ['order', 'todo', 'low', 'reading'];
  var progressSort = null;
  function sortMode() {
    if (progressSort === null) {
      var saved = load(PSORT_KEY, 'order');
      progressSort = SORTS.indexOf(saved) !== -1 ? saved : 'order';
    }
    return progressSort;
  }
  // keys: one book's chapters in BCSC order; rows: answer counts; reading: rounds.
  function sortChapters(keys, mode, rows, reading, notes) {
    var at = {};
    keys.forEach(function (k, i) { at[k] = i; });
    return keys.slice().sort(function (a, b) {
      var ra = rows[a];
      var rb = rows[b];
      if (mode === 'todo') {
        // Chapters with questions none of which are answered yet, then the rest;
        // chapters without questions last.
        var ga = !ra.total ? 2 : ra.done ? 1 : 0;
        var gb = !rb.total ? 2 : rb.done ? 1 : 0;
        return ga - gb || at[a] - at[b];
      }
      if (mode === 'low') {
        // Lowest accuracy first; chapters without answers keep BCSC order at the end.
        if (!ra.done || !rb.done) return (ra.done ? 0 : 1) - (rb.done ? 0 : 1) || at[a] - at[b];
        return ra.right / ra.done - rb.right / rb.done || at[a] - at[b];
      }
      if (mode === 'reading') {
        // Chapters with notes first: fewest finished rounds, then lowest coverage.
        var na = !!notes[a];
        var nb = !!notes[b];
        if (na !== nb) return na ? -1 : 1;
        if (!na) return at[a] - at[b];
        var pa = reading[a] || { r: 0, pct: 0 };
        var pb = reading[b] || { r: 0, pct: 0 };
        return pa.r - pb.r || pa.pct - pb.pct || at[a] - at[b];
      }
      return at[a] - at[b];
    });
  }
  // Sort bar and the storage notice above the tables (set up once).
  function initProgressBar(out) {
    var bar = document.querySelector('.ex-prog-bar');
    var select = bar ? bar.querySelector('.ex-progress-sort') : null;
    var works = storageWorks();
    if (!works) {
      var note = document.querySelector('.ex-prog-store');
      if (note) {
        note.textContent = '這個瀏覽器無法儲存資料（例如無痕模式或停用網站資料），讀書進度無法記錄。';
        note.hidden = false;
      }
      var clearBtn = document.querySelector('.ex-clear-progress');
      if (clearBtn) clearBtn.disabled = true;
    }
    if (!select) return;
    select.value = sortMode();
    select.disabled = !works;
    bar.hidden = false;
    select.addEventListener('change', function () {
      progressSort = SORTS.indexOf(select.value) !== -1 ? select.value : 'order';
      store(PSORT_KEY, progressSort);
      renderProgress(out);
    });
  }
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
      var canStore = storageWorks();
      var reading = canStore ? readingMap() : {};
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
      var noted = order.filter(function (k) { return data.notes[k]; });
      var roundsDone = noted.filter(function (k) { return reading[k] && reading[k].r >= 1; }).length;
      var roundsTwice = noted.filter(function (k) { return reading[k] && reading[k].r >= 2; }).length;
      var summary = el('div', 'ex-summary-box');
      summary.appendChild(el('p', null, '已作答 ' + done + ' / ' + answeredTotal + ' 題 · 答對 ' + right
        + ' 題 · 正確率 ' + percent(right, done) + ' · 課本已讀完 ' + readCount + ' / ' + order.length + ' 章'
        + ' · 重點已讀完 ' + roundsDone + ' / ' + noted.length + ' 章'
        + (roundsTwice ? '（其中 ' + roundsTwice + ' 章 2 次以上）' : '')));
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
      var mode = sortMode();
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
        ['章節', '課本已讀', '重點閱讀', '已作答', '正確率', '最後讀'].forEach(function (h, i) {
          var th = el('th', i >= 3 ? 'ex-num' : null, h);
          th.scope = 'col';
          head.appendChild(th);
        });
        var thead = el('thead');
        thead.appendChild(head);
        table.appendChild(thead);
        var tbody = el('tbody');
        sortChapters(keys, mode, rows, reading, data.notes).forEach(function (k) {
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
          box.disabled = !canStore;   // nothing could be kept
          box.addEventListener('change', function () { setRead(k, box.checked); renderProgress(out, k); });
          cell.appendChild(box);
          tr.appendChild(cell);
          tr.appendChild(readingCell(k, data.notes[k] ? reading[k] || null : undefined));
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

  // 重點閱讀 cell: ✓N (rounds finished) and this round's coverage; undefined = no notes.
  function readingCell(k, rec) {
    var td = el('td', 'ex-rd');
    if (rec === undefined) {
      td.textContent = '—';
      td.title = '本章尚無重點整理';
      return td;
    }
    var r = rec ? rec.r : 0;
    var pct = rec ? rec.pct : 0;
    if (r >= 1) td.appendChild(readBadge(r));
    var meter = el('span', 'ex-rd-meter');
    var bar = el('span', 'ex-rd-bar');
    bar.setAttribute('aria-hidden', 'true');
    var fill = el('span', 'ex-rd-fill');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    meter.appendChild(bar);
    meter.appendChild(el('span', 'ex-rd-pct', pct + '%'));
    td.appendChild(meter);
    return td;
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
      var meta = el('p', 'ex-meta', '共 ' + rows.length + ' 題錯題');
      list.appendChild(meta);
      // 移出錯題本 keeps the count in step (and says so when the last one goes).
      function removed() {
        var left = list.querySelectorAll('.ex-q').length;
        if (left) { meta.textContent = '共 ' + left + ' 題錯題'; return; }
        clear(list);
        list.appendChild(el('p', 'ex-pending', '目前沒有錯題。到章節頁或考古卷切換「作答模式」作答，答錯的題目會出現在這裡。'));
      }
      rows.forEach(function (q) { list.appendChild(renderCard(q, data, { removable: removed })); });
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

  // ---------------------------------------------------------- practice paper
  // A paper not handed in yet survives a reload, leaving the page and a later visit
  // (owner 2026-11-03, as on the dermatology exam section): its questions, the options
  // picked and submitted, the time counted and the settings are kept in hs:exam:paper on
  // this device. 交卷 or 放棄這份試卷 removes it; 產生試卷 replaces it.
  //
  // Several tabs may show the same paper, so a page never writes back the copy it holds.
  // Every change made here is kept as an edit; flush() re-reads the stored paper, applies
  // the edits to it and writes it with rev + 1, all under one cross-tab lock (Web Locks)
  // where the browser has it, also on leaving the page. A stored paper with another id
  // (a new paper) or none at all (handed in or given up elsewhere) ends this page's copy.
  // Answers are recorded in hs:exam:stats / wrong / ans when submitted, as before; a
  // resumed paper only shows them again.
  function wholeNumber(v, max) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= max && Math.floor(v) === v; }
  function normPaper(p) {
    if (!isMap(p) || typeof p.id !== 'string' || !/^[a-z0-9]{1,40}$/.test(p.id)) return null;
    if (!wholeNumber(p.rev, 1e9) || !Array.isArray(p.ids) || !p.ids.length || p.ids.length > 5000) return null;
    var inPaper = {};
    for (var i = 0; i < p.ids.length; i++) {
      var n = p.ids[i];
      if (!wholeNumber(n, 99999) || n < 1 || own(inPaper, n)) return null;
      inPaper[n] = true;
    }
    function picks(map) {
      var out = {};
      if (!isMap(map)) return out;
      Object.keys(map).forEach(function (n) {
        if (own(inPaper, n) && typeof map[n] === 'string' && /^[A-Za-z0-9]{1,3}$/.test(map[n])) out[n] = map[n];
      });
      return out;
    }
    var set = isMap(p.set) ? p.set : {};
    return {
      id: p.id, rev: p.rev, ids: p.ids.slice(), sel: picks(p.sel), done: picks(p.done),
      el: typeof p.el === 'number' && isFinite(p.el) && p.el >= 0 ? Math.min(p.el, 36e7) : 0,
      t: typeof p.t === 'number' && isFinite(p.t) ? p.t : 0,
      set: {
        b: Array.isArray(set.b) ? set.b.filter(function (b) { return typeof b === 'string' && /^\d{1,2}$/.test(b); }) : [],
        c: wholeNumber(set.c, 5000) ? set.c : -1,
        o: set.o === 'random' || set.o === 'number' ? set.o : ''
      }
    };
  }
  // A Web Lock is granted asynchronously, and a page being unloaded never gets it, so
  // the time counted since the last save is also written straight away on leaving. Each
  // page writes only its own checkpoint key and only raises it, so two pages leaving at
  // once cannot lower each other's time (PR #83 review); readers take the largest. Under
  // the paper lock, checkpoints of other papers are removed (pruneTimes).
  var PAGE_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  function timeKeys() {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PAPER_TIME_PREFIX) === 0) keys.push(k);
      }
    } catch (e) { /* storage disabled */ }
    return keys;
  }
  function checkpoint(key) {
    var rec = load(key, null);
    return isMap(rec) && typeof rec.id === 'string' && typeof rec.el === 'number' && isFinite(rec.el) && rec.el >= 0
      ? { id: rec.id, el: Math.min(rec.el, 36e7) } : null;
  }
  function paperTime(id) {
    var ms = 0;
    timeKeys().forEach(function (k) {
      var rec = checkpoint(k);
      if (rec && rec.id === id && rec.el > ms) ms = rec.el;
    });
    return ms;
  }
  function saveTime(id, ms) {
    var key = PAPER_TIME_PREFIX + PAGE_ID;
    var mine = checkpoint(key);
    if (!mine || mine.id !== id || ms > mine.el) storeOk(key, { id: id, el: ms });
  }
  // Under the paper lock: drop every checkpoint not of paper keepId (null: all).
  function pruneTimes(keepId) {
    timeKeys().forEach(function (k) {
      var rec = checkpoint(k);
      if (!rec || rec.id !== keepId) {
        try { localStorage.removeItem(k); } catch (e) { /* storage disabled */ }
      }
    });
  }
  function storedPaper() {
    var p = normPaper(load(PAPER_KEY, null));
    if (p) p.el = Math.max(p.el, paperTime(p.id));
    return p;
  }
  function copyPaper(p) { return JSON.parse(JSON.stringify(p)); }
  // Run fn under the named cross-tab lock (directly where Web Locks are missing).
  function crossTabLock(name, fn) {
    var locks = navigator.locks;
    if (!locks || typeof locks.request !== 'function') { fn(); return; }
    var ran = false;
    locks.request(name, function () { ran = true; fn(); }).then(null, function () { if (!ran) fn(); });
  }

  function initPractice(form) {
    var list = document.getElementById('ex-practice-list');
    var note = form.querySelector('.ex-build-note');
    var bar = document.querySelector('[data-exam-bar]');
    var finishBtn = bar.querySelector('.ex-finish');
    var discardBtn = bar.querySelector('.ex-discard');
    if (!discardBtn) {   // a page generated before the button existed
      discardBtn = el('button', 'ex-discard', '放棄這份試卷');
      discardBtn.type = 'button';
      discardBtn.hidden = true;
      finishBtn.parentNode.insertBefore(discardBtn, finishBtn.nextSibling);
    }
    var intro = list.firstElementChild ? list.firstElementChild.cloneNode(true) : null;
    var canStore = storageWorks();
    var paper = null;      // this page's paper: the stored copy plus this page's edits
    var synced = false;    // kept in storage (false: storage is off, the paper lives here only)
    var edits = [];        // changes made here, not merged into the stored paper yet
    var unsaved = false;   // a paper begun here and not written yet
    var replaces = null;   // id of the stored paper it replaces
    var buildSeq = 0;      // a bank request answered after a newer 產生試卷 is dropped
    var timer = wireExamBar(bar, list, { save: flush, finish: handIn });
    // 已作答 x／y (the chapter pages' answer bar) inside the sticky timer bar.
    answerBar = initAnswerBar(list, null, { host: bar, allDone: '本卷題目都作答過了' });

    function setAll(checked) {
      form.querySelectorAll('input[name=ex-book]').forEach(function (box) { box.checked = checked; });
    }
    form.querySelector('.ex-books-all').addEventListener('click', function () { setAll(true); });
    form.querySelector('.ex-books-none').addEventListener('click', function () { setAll(false); });
    // The form shows the settings the stored paper was made with.
    function applySettings(set) {
      if (set.b.length) {
        form.querySelectorAll('input[name=ex-book]').forEach(function (box) { box.checked = set.b.indexOf(box.value) !== -1; });
      }
      var select = form.querySelector('select[name=ex-count]');
      if (set.c >= 0 && select.querySelector('option[value="' + set.c + '"]')) select.value = String(set.c);
      var radio = set.o ? form.querySelector('input[name=ex-order][value="' + set.o + '"]') : null;
      if (radio) radio.checked = true;
    }

    function cards() { return Array.prototype.slice.call(list.querySelectorAll('.ex-q:not(.ex-unanswered)')); }
    function optionFor(card, key) {
      var inputs = card.querySelectorAll('input[type=radio]');
      for (var i = 0; i < inputs.length; i++) if (inputs[i].value === key) return inputs[i];
      return null;
    }
    // Show paper.sel / paper.done on the cards whose shown state differs; returns how many changed.
    function paint() {
      var changed = 0;
      cards().forEach(function (card) {
        var n = card.getAttribute('data-qid');
        var picked = card.querySelector('input[type=radio]:checked');
        var outcome = card.getAttribute('data-outcome');
        var shownDone = picked && (outcome === 'right' || outcome === 'wrong') ? picked.value : null;
        var shownSel = picked && !shownDone ? picked.value : null;
        var done = own(paper.done, n) && optionFor(card, paper.done[n]) ? paper.done[n] : null;
        var sel = !done && own(paper.sel, n) && optionFor(card, paper.sel[n]) ? paper.sel[n] : null;
        if (shownDone === done && shownSel === sel && (done || !outcome)) return;
        changed += 1;
        resetQuestion(card, false);
        if (done) {
          var input = optionFor(card, done);
          input.checked = true;
          showGraded(card, input);
        } else if (sel) {
          optionFor(card, sel).checked = true;
        }
      });
      refreshAnswerBar();
      return changed;
    }
    function show(pool, data) {
      clear(list);
      pool.forEach(function (q, i) {
        var card = renderCard(q, data, { prefix: (i + 1) + '. ', suffix: '-p' });
        watch(card);
        list.appendChild(card);
      });
      bar.hidden = false;
      discardBtn.hidden = false;
    }
    // Runs after wireQuestion's own handlers (grading, reset), which were added first.
    function watch(card) {
      var n = card.getAttribute('data-qid');
      var submit = card.querySelector('.ex-submit');
      var reset = card.querySelector('.ex-reset');
      if (submit) submit.addEventListener('click', function () {
        var picked = card.querySelector('input[type=radio]:checked');
        var outcome = card.getAttribute('data-outcome');
        if (!picked || (outcome !== 'right' && outcome !== 'wrong')) return;
        var key = picked.value;
        edit(function (p) { p.done[n] = key; delete p.sel[n]; });
      });
      if (reset) reset.addEventListener('click', function () {
        edit(function (p) { delete p.done[n]; delete p.sel[n]; });
      });
      card.querySelectorAll('input[type=radio]').forEach(function (input) {
        input.addEventListener('change', function () {
          if (input.checked) edit(function (p) { if (!own(p.done, n)) p.sel[n] = input.value; });
        });
      });
    }

    function edit(fn) {
      if (!paper) return;
      fn(paper);
      if (!synced) return;
      edits.push(fn);
      flush();
    }
    function flush() {
      if (!paper || !synced) return;
      crossTabLock(PAPER_KEY, function () {
        if (!paper || !synced) return;   // handed in, given up or lost meanwhile
        var cur = storedPaper();
        var next;
        if (unsaved) {
          next = copyPaper(paper);       // this page's edits are in it already
          next.rev = 1;
        } else {
          if (!cur || cur.id !== paper.id) { lose(cur); return; }
          next = cur;
          edits.forEach(function (fn) { fn(next); });
          next.rev = cur.rev + 1;
        }
        next.el = Math.max(next.el, timer.elapsed());
        next.t = Date.now();
        if (!storeOk(PAPER_KEY, next)) return;   // keep the edits for the next try
        pruneTimes(next.id);
        unsaved = false;
        replaces = null;
        edits = [];
        adopt(next);
      });
    }
    // Show a stored copy of this paper (with this page's unsaved edits on top).
    function adopt(cur) {
      var view = copyPaper(cur);
      edits.forEach(function (fn) { fn(view); });
      paper = view;
      timer.catchUp(cur.el);
      if (paint()) answerBar.reapply();
    }
    // Another tab saved, handed in or replaced the paper: follow it (nothing is written).
    function follow() {
      if (!paper || !synced || unsaved) return;
      var cur = storedPaper();
      if (!cur || cur.id !== paper.id) lose(cur);
      else if (cur.rev !== paper.rev) adopt(cur);
    }
    function lose(cur) {
      paper = null;
      edits = [];
      unsaved = false;
      timer.stop(cur ? '已在其他分頁產生新的試卷，本頁不再計時或保存；請重新整理頁面。'
        : '這份試卷已在其他分頁交卷或放棄，本頁不再計時或保存；請重新整理頁面。');
      finishBtn.disabled = true;
      discardBtn.hidden = true;
    }
    // Under the paper lock: remove attempt id from storage (or, for a paper begun here
    // and not written yet, the paper it replaces), never a newer paper begun elsewhere.
    function removeStored(cur, id, wasNew, old) {
      if (cur && (cur.id === id || (wasNew && cur.id === old))) {
        try { localStorage.removeItem(PAPER_KEY); } catch (e) { /* storage disabled */ }
        cur = null;
      }
      pruneTimes(cur ? cur.id : null);
    }
    function forgetPaper() {
      paper = null;
      edits = [];
      unsaved = false;
      replaces = null;
    }
    function dropPaper() {
      var id = paper.id;
      var wasNew = unsaved;
      var old = replaces;
      var wasSynced = synced;
      forgetPaper();
      if (!wasSynced) return;
      crossTabLock(PAPER_KEY, function () { removeStored(storedPaper(), id, wasNew, old); });
    }
    // 交卷 (PR #83 review): under the paper lock, merge this page's edits into the
    // latest stored paper and show it, so answers saved by another tab whose storage
    // event has not arrived yet are graded (and a submitted one is not recorded again);
    // then grade and remove the attempt. A paper handed in or replaced elsewhere is not
    // graded here; the other-tab notice is shown instead.
    function handIn(gradeAll) {
      if (!paper) { gradeAll(); return; }   // handed in here already: 交卷 again recounts
      discardBtn.hidden = true;
      if (!synced) { forgetPaper(); gradeAll(); return; }
      finishBtn.disabled = true;
      var id = paper.id;
      crossTabLock(PAPER_KEY, function () {
        if (!paper || paper.id !== id) return;   // lost, or a new paper begun here meanwhile
        var cur = storedPaper();
        var wasNew = unsaved;
        var old = replaces;
        if (!wasNew) {
          if (!cur || cur.id !== id) { lose(cur); return; }
          adopt(cur);
        }
        removeStored(cur, id, wasNew, old);
        forgetPaper();
        finishBtn.disabled = false;
        gradeAll();
      });
    }
    discardBtn.addEventListener('click', function () {
      if (!paper) return;
      if (!window.confirm('放棄這份未交卷的試卷？已送出的答案仍會保留在作答紀錄與錯題本。')) return;
      dropPaper();
      timer.stop('');
      clear(list);
      if (intro) list.appendChild(intro.cloneNode(true));
      bar.hidden = true;
      answerBar.reset();
      refreshAnswerBar();
      note.textContent = '已放棄這份試卷。';
    });

    form.querySelector('.ex-build').addEventListener('click', function () {
      var books = [];
      form.querySelectorAll('input[name=ex-book]:checked').forEach(function (box) { books.push(box.value); });
      if (!books.length) { note.textContent = '請至少選一冊'; return; }
      var count = Number(form.querySelector('select[name=ex-count]').value);
      var order = form.querySelector('input[name=ex-order]:checked').value;
      note.textContent = '題目載入中…';
      var seq = ++buildSeq;
      examData().then(function (data) {
        if (seq !== buildSeq) return;
        var pool = data.questions.filter(function (q) {
          return q.ch.some(function (key) { return books.indexOf(key.split('-')[0]) !== -1; });
        });
        if (!pool.length) { note.textContent = '選的範圍內沒有符合的題目'; return; }
        if (order === 'random') shuffle(pool);
        if (count > 0) pool = pool.slice(0, count);
        var old = canStore ? storedPaper() : null;
        paper = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 10), rev: 0,
          ids: pool.map(function (q) { return q.n; }), sel: {}, done: {}, el: 0, t: Date.now(),
          set: { b: books, c: count, o: order }
        };
        synced = canStore;
        unsaved = canStore;
        replaces = old ? old.id : null;
        edits = [];
        show(pool, data);
        note.textContent = '共 ' + pool.length + ' 題，計時開始';
        timer.start(0, false);
        answerBar.reset();
        refreshAnswerBar();
        flush();
        list.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }).catch(function (err) {
        if (seq !== buildSeq) return;
        note.textContent = '';
        lockedNote(list, err, '考古卷');
      });
    });

    // A paper generated earlier and not handed in continues where it was left. Signed
    // out, it stays stored and continues once the bank loads (after signing in).
    function resume() {
      var saved = canStore && !paper ? storedPaper() : null;
      if (!saved) return;
      applySettings(saved.set);
      note.textContent = '載入上次未交卷的試卷…';
      var seq = buildSeq;
      examData().then(function (data) {
        if (seq !== buildSeq || paper) return;
        var cur = storedPaper();   // handed in or replaced in another tab meanwhile?
        if (!cur) { note.textContent = ''; return; }
        var byN = {};
        data.questions.forEach(function (q) { byN[q.n] = q; });
        var pool = cur.ids.map(function (n) { return byN[n]; }).filter(Boolean);
        paper = cur;
        synced = true;
        unsaved = false;
        replaces = null;
        edits = [];
        if (!pool.length) { dropPaper(); note.textContent = ''; return; }
        applySettings(cur.set);
        show(pool, data);
        timer.start(cur.el, true);
        answerBar.reset();
        paint();
        note.textContent = '已接續上次未交卷的試卷（共 ' + pool.length + ' 題）。按「產生試卷並開始計時」會改出一份新的試卷。';
      }).catch(function (err) {
        if (seq !== buildSeq || paper) return;
        if (err && err.login) {
          note.textContent = '有一份未交卷的試卷（共 ' + saved.ids.length + ' 題），登入題庫後會接續作答。';
          lockedNote(list, err, '考古卷');
        } else {
          note.textContent = '題庫載入失敗，請重新整理頁面。';
        }
      });
    }

    // Time away from the page is not counted: pause when hidden or left, save, and
    // on return continue from the latest stored copy.
    function leave() {
      timer.pause();
      if (synced) saveTime(paper.id, timer.elapsed());
      flush();
    }
    document.addEventListener('visibilitychange', function () {
      if (!paper) return;
      if (document.visibilityState === 'hidden') { leave(); return; }
      follow();
      if (paper) timer.run();
    });
    window.addEventListener('pagehide', function () { if (paper) leave(); });
    // Back-forward cache: a page that had the bank reloads (see the pageshow handler
    // below) and resumes from storage; a signed-out page tries to resume again.
    window.addEventListener('pageshow', function (ev) {
      if (!ev.persisted) return;
      if (!paper) { resume(); return; }
      follow();
      if (paper) timer.run();
    });
    window.addEventListener('storage', function (ev) {
      if (ev.key === null || ev.key === PAPER_KEY) follow();
    });
    resume();
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
  // Ranked names (ported from the dermatology exam section, 2026-11-03). The generator
  // lists, per chapter page and per note section, the names a reader would type, plus
  // abbreviations and Chinese names from a glossary built from the notes (notes-data.json
  // "find"): 0 exact abbreviation, 1 exact name, 2 prefix, 3 word start, 4 substring.
  // A short Latin query (PVRL, RP) matches whole words only, as in the paragraph search.
  function normTerm(text) {
    var s = String(text || '');
    if (s.normalize) s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    return s.toLowerCase().replace(/[\-‐-―_\/·]/g, ' ').replace(/[’']/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  var HAS_CJK = /[㐀-鿿]/;
  function termIndex(data) {
    if (data.findIndex) return data.findIndex;
    var raw = data.find && Array.isArray(data.find.entries) ? data.find.entries : [];
    data.findIndex = raw.filter(function (e) {
      return Array.isArray(e) && own(data.chapters, e[0]) && Array.isArray(e[3]) && Array.isArray(e[4]);
    }).map(function (e, i) {
      var terms = [];
      e[3].forEach(function (t, j) { terms.push({ text: String(t), key: normTerm(t), abbr: false, primary: j < e[5] }); });
      e[4].forEach(function (t, j) { terms.push({ text: String(t), key: normTerm(t), abbr: true, primary: j < e[6] }); });
      return { key: String(e[0]), sid: String(e[1] || ''), title: String(e[2] || ''), terms: terms, order: i };
    });
    return data.findIndex;
  }
  function matchTier(term, q, word, cjk) {
    var k = term.key;
    if (!k) return -1;
    if (k === q) return term.abbr ? 0 : 1;
    if (word) {
      var m = new RegExp('(^|[^a-z0-9])' + q + 's?(?![a-z0-9])').exec(k);
      if (!m) return -1;
      return m.index === 0 && !m[1] ? 2 : 3;
    }
    var at = k.indexOf(q);
    if (at < 0) return -1;
    if (at === 0) return 2;
    if (cjk || /[^a-z0-9]/.test(k.charAt(at - 1))) return 3;
    return term.abbr ? -1 : 4;
  }
  // { chapter key: { best: score, hits: [{ entry, score, names }] } }, lower score = better.
  function rankTerms(index, query) {
    var q = normTerm(query);
    var out = {};
    if (!q) return out;
    var cjk = HAS_CJK.test(q);
    var word = /^[a-z0-9]{1,6}$/.test(q);
    index.forEach(function (entry) {
      var best = Infinity;
      var matched = [];
      entry.terms.forEach(function (term) {
        var tier = matchTier(term, q, word, cjk);
        if (tier < 0) return;
        var score = tier * 2 + (term.primary ? 0 : 1);
        matched.push({ text: term.text, score: score });
        if (score < best) best = score;
      });
      if (!matched.length) return;
      matched.sort(function (a, b) { return a.score - b.score; });
      var names = [];
      matched.forEach(function (m) {
        if (names.length < 3 && m.score === best && names.indexOf(m.text) < 0) names.push(m.text);
      });
      var g = out[entry.key] || (out[entry.key] = { best: Infinity, hits: [] });
      g.hits.push({ entry: entry, score: best, names: names });
      if (best < g.best) g.best = best;
    });
    Object.keys(out).forEach(function (key) {
      out[key].hits.sort(function (a, b) {
        return a.score - b.score || (a.entry.sid ? 1 : 0) - (b.entry.sid ? 1 : 0) || a.entry.order - b.entry.order;
      });
    });
    return out;
  }

  var SHOW_HITS = 5;
  var SHOW_NAMES = 3;
  // Results are an ARIA listbox (the input is its combobox): one group per chapter, whose
  // options are the chapter link, the sections whose names match and the paragraphs.
  function option(node, list) {
    node.id = 'ex-find-o' + list.n++;
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', 'false');
    node.tabIndex = -1;
    return node;
  }
  function hubSearch(query, input, out, status, done) {
    var f = finder(query);
    clear(out);
    if (!f || f.q.length < 2) { status.textContent = ''; done(null); return; }
    status.textContent = '搜尋中…';
    notesData().then(function (data) {
      if (finder(input.value) === null || finder(input.value).q !== f.q) return;  // a newer query is pending
      var named = rankTerms(termIndex(data), f.q);
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
          var names = own(named, key) ? named[key] : null;
          if (hits.length || names || ranges(ch.title, fd).length) {
            groups.push({ key: key, ch: ch, hits: hits, names: names ? names.hits : [], best: names ? names.best : Infinity });
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
      // Best name match first (exact abbreviation > name > prefix > word > substring),
      // then the chapters that mention the term most often.
      groups.sort(function (a, b) {
        return a.best - b.best || b.hits.length - a.hits.length || chapterOrder(a.key, b.key);
      });
      clear(out);
      var more = el('p', 'ex-meta ex-find-all');
      var link = el('a', null, '到搜尋頁也搜尋考題（需登入）');
      link.href = '/exam/search?q=' + encodeURIComponent(f.q);
      more.appendChild(link);
      if (!groups.length) {
        status.textContent = '課本重點與章節名稱中找不到「' + f.q + '」。';
        out.appendChild(more);
        done(null);
        return;
      }
      status.textContent = '「' + f.q + '」出現在 ' + groups.length + ' 章' + (total ? '、共 ' + total + ' 段重點' : '')
        + (loose ? '（找不到完整詞組，列出含有所有關鍵字的段落）' : '') + '。';
      out.appendChild(el('h2', 'ex-find-title', '搜尋結果'));
      var box = el('div', 'ex-find-box');
      box.id = 'ex-find-list';
      box.setAttribute('role', 'listbox');
      box.setAttribute('aria-label', '搜尋結果');
      var ids = { n: 0 };
      groups.forEach(function (g) {
        var group = el('section', 'ex-find-group');
        group.setAttribute('role', 'group');
        var h = el('div', 'ex-find-h');
        var top = g.names[0];
        var a = option(el('a', 'ex-find-ch', g.ch.label + ' ' + g.ch.title), ids);
        // The chapter link opens the best hit: the best-named section (its first matching
        // paragraph when there is one), else the first matching paragraph, else the page.
        var first = g.hits[0];
        if (top && top.entry.sid) {
          var inSec = g.hits.filter(function (hit) { return hit.p.h === top.entry.sid; })[0];
          a.href = inSec ? landingHref(g.key, f, inSec.i)
            : '/exam/bcsc' + g.key + '?hl=' + encodeURIComponent(f.q) + '#' + top.entry.sid;
        } else {
          a.href = first && !top ? landingHref(g.key, f, first.i) : '/exam/bcsc' + g.key;
        }
        group.setAttribute('aria-labelledby', a.id);
        h.appendChild(a);
        h.appendChild(el('span', 'ex-count', g.hits.length ? g.hits.length + ' 段'
          : g.names.length ? '名稱符合' : (data.notes[g.key] ? '章節名稱符合' : '章節名稱符合，重點尚未整理')));
        group.appendChild(h);
        var secs = g.names.filter(function (hit) { return hit.entry.sid; }).slice(0, SHOW_NAMES);
        if (secs.length) {
          var nameList = el('ul', 'ex-find-names');
          nameList.setAttribute('role', 'none');
          secs.forEach(function (hit) {
            var li = el('li');
            li.setAttribute('role', 'none');
            var sa = option(el('a'), ids);
            sa.href = '/exam/bcsc' + g.key + '?hl=' + encodeURIComponent(f.q) + '#' + hit.entry.sid;
            sa.appendChild(el('span', 'ex-find-sec', '› ' + hit.entry.title));
            sa.appendChild(el('span', 'ex-find-why', '名稱符合：' + hit.names.join('、')));
            li.appendChild(sa);
            nameList.appendChild(li);
          });
          group.appendChild(nameList);
        }
        if (g.hits.length) {
          var list = el('ul', 'ex-find-list');
          list.setAttribute('role', 'none');
          g.hits.forEach(function (hit, n) {
            var li = el('li');
            li.setAttribute('role', 'none');
            if (n >= SHOW_HITS) li.hidden = true;
            var pl = option(el('a'), ids);
            pl.href = landingHref(g.key, f, hit.i);
            var sec = g.ch.secs && g.ch.secs[hit.p.h];
            if (sec) pl.appendChild(el('span', 'ex-find-sec', sec));
            pl.appendChild(snippet(hit.p.t, hit.r));
            li.appendChild(pl);
            list.appendChild(li);
          });
          group.appendChild(list);
          if (g.hits.length > SHOW_HITS) {
            var btn = option(el('button', 'ex-find-more', '再顯示 ' + (g.hits.length - SHOW_HITS) + ' 段'), ids);
            btn.type = 'button';
            btn.addEventListener('click', function () {
              var shown = null;
              list.querySelectorAll('li[hidden]').forEach(function (li) { li.hidden = false; shown = shown || li; });
              btn.remove();
              // The clicked button is gone: give focus back to the combobox input so the
              // arrow keys and Enter keep working, and select the first revealed paragraph.
              try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
              if (shown) input.dispatchEvent(new CustomEvent('ex-find-focus', { detail: shown.querySelector('[role=option]') }));
            });
            group.appendChild(btn);
          }
        }
        box.appendChild(group);
      });
      out.appendChild(box);
      out.appendChild(more);
      done(f.q);
    }).catch(function () {
      status.textContent = '資料載入失敗，請重新整理頁面。';
      done(null);
    });
  }
  function initHubSearch(form) {
    var input = form.querySelector('input[name=q]');
    var out = document.getElementById('ex-find-results');
    var status = document.querySelector('.ex-find-status');
    var hint = document.getElementById('ex-find-hint');
    var timer = null;
    var active = null;
    var shownQuery = null;   // the query the listed options were found for
    // Combobox semantics only with JavaScript; without it the form posts to /exam/search.
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('enterkeyhint', 'search');
    if (hint) hint.appendChild(document.createTextNode('可用上下鍵選擇結果、Enter 開啟、Esc 關閉。'));
    function options() {
      return Array.prototype.filter.call(out.querySelectorAll('[role=option]'), function (o) {
        var h = o.closest('[hidden]');
        return !h || h === out;   // a collapsed list (Esc) still has its options
      });
    }
    function setActive(node) {
      if (active) active.setAttribute('aria-selected', 'false');
      active = node || null;
      if (active) {
        active.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', active.id);
        active.scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }
    function expand(open) {
      var list = document.getElementById('ex-find-list');
      open = !!(open && list && out.contains(list));
      out.hidden = !open && !!list;
      input.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (list) input.setAttribute('aria-controls', list.id);
      else input.removeAttribute('aria-controls');
      if (!open) setActive(null);
    }
    function run() {
      clearTimeout(timer);
      var q = input.value.trim();
      try { history.replaceState(null, '', q ? '?q=' + encodeURIComponent(q) : location.pathname); } catch (e) { /* ignore */ }
      active = null;
      input.removeAttribute('aria-activedescendant');
      out.hidden = false;
      hubSearch(q, input, out, status, function (found) {
        shownQuery = found === null ? null : input.value;
        expand(found !== null);
      });
    }
    input.addEventListener('ex-find-focus', function (ev) { setActive(ev.detail); });
    out.addEventListener('mousemove', function (ev) {
      var o = ev.target.closest && ev.target.closest('[role=option]');
      if (o && o !== active && out.contains(o)) setActive(o);
    });
    input.addEventListener('focus', function () { notesData().catch(function () { /* reported on search */ }); });
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 250); });
    input.addEventListener('keydown', function (ev) {
      var opts;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        opts = options();
        if (!opts.length) return;
        ev.preventDefault();
        if (input.getAttribute('aria-expanded') !== 'true') expand(true);
        var at = opts.indexOf(active);
        var step = ev.key === 'ArrowDown' ? 1 : -1;
        setActive(opts[at < 0 ? (step > 0 ? 0 : opts.length - 1) : (at + step + opts.length) % opts.length]);
      } else if (ev.key === 'Enter') {
        if (ev.isComposing || ev.keyCode === 229) return;  // finishing a 注音／倉頡 composition
        ev.preventDefault();
        opts = options();
        // Results listed for an earlier query (or none yet): search what is typed now.
        if (!opts.length || shownQuery !== input.value || !input.value.trim()) { run(); return; }
        var target = active && opts.indexOf(active) >= 0 ? active : opts[0];
        if (target.tagName === 'BUTTON') target.click();
        else location.href = target.href;
      } else if (ev.key === 'Escape') {
        if (input.getAttribute('aria-expanded') === 'true') { ev.preventDefault(); expand(false); }
        else if (input.value) { ev.preventDefault(); input.value = ''; run(); }
      }
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

  // A link to #id must show its target even when it sits in a closed <details> (a 考點
  // on a chapter page, a BCSC part on the hub); ported from the dermatology exam section.
  function openDetails(target) {
    var opened = false;
    for (var d = target.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
      if (!d.open) { d.open = true; opened = true; }
    }
    return opened;
  }
  function revealTarget() {
    var id = location.hash.slice(1);
    if (!id) return;
    try { id = decodeURIComponent(id); } catch (e) { return; }
    var target = document.getElementById(id);
    if (target && openDetails(target)) target.scrollIntoView();
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

    function text(node) { return (node.textContent || '').replace(/\s+/g, ' ').trim(); }
    // 'h2 › h3' of the section an anchor belongs to ('' before the first heading).
    function sectionTitle(target) {
      var h2 = null;
      var h3 = null;
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        if (a.tagName === 'H2') { h2 = a; h3 = null; } else if (a.tagName === 'H3') { h3 = a; }
        if (a === target) return [h2, h3].filter(Boolean).map(text).join(' › ');
      }
      return '';
    }
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
      if (id) {
        all[key] = { id: id, t: Date.now() };
        // Section title for the hub's 「繼續閱讀」 card (as on the dermatology site).
        var h = sectionTitle(document.getElementById(id)).slice(0, 120);
        if (h) all[key].h = h;
      } else delete all[key];
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

    var title = sectionTitle(target);
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

  // ---------------------------------------------------------- reading rounds
  // How much of each chapter's notes has really been read, per round (owner
  // 2026-11-02, as on the dermatology exam section). A note section (one <h2> and
  // what follows it) counts as read once it has been on screen long enough for its
  // length; about 75% of the notes read counts as one finished round, and the next
  // round starts again from 0%. Everything stays in this browser.
  var READ_FULL_PCT = 75;     // coverage that counts as one finished round
  var DWELL_MIN = 5000;       // ms a section must stay on screen: 50 ms per character,
  var DWELL_MAX = 30000;      // but never less than 5 s or more than 30 s
  var DWELL_PER_CHAR = 50;
  var DWELL_TICK = 1000;
  var DONE_KEEP = 20;

  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function storeOk(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function storageWorks() {
    try {
      localStorage.setItem('hs:exam:probe', '1');
      localStorage.removeItem('hs:exam:probe');
      return true;
    } catch (e) { return false; }
  }
  // A stored record, checked and copied; null when its shape is wrong.
  function normReading(rec) {
    if (!isMap(rec)) return null;
    function whole(v, max) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= max && Math.floor(v) === v; }
    if (!whole(rec.r, 100000) || !whole(rec.pct, 100)) return null;
    if (typeof rec.t !== 'number' || !isFinite(rec.t) || rec.t < 0) return null;
    if (!isMap(rec.seen) || !Array.isArray(rec.done)) return null;
    var seen = {};
    Object.keys(rec.seen).forEach(function (id) {
      if (rec.seen[id] === 1 && /^[a-z0-9-]{1,80}$/.test(id)) seen[id] = 1;
    });
    var done = rec.done.filter(function (x) { return typeof x === 'number' && isFinite(x) && x >= 0; }).slice(-DONE_KEEP);
    // g: generation id; a reset or a record recreated elsewhere gets a new one.
    var g = typeof rec.g === 'string' && /^[a-z0-9]{1,40}$/.test(rec.g) ? rec.g : '';
    return { g: g, r: rec.r, seen: seen, pct: rec.pct, t: rec.t, done: done };
  }
  // { '12-4': record } with every malformed entry left out.
  function readingMap() {
    var all = load(READING_KEY, {});
    var out = {};
    if (!isMap(all)) return out;
    Object.keys(all).forEach(function (key) {
      if (!/^\d{1,2}-\d{1,2}$/.test(key)) return;
      var rec = normReading(all[key]);
      if (rec) out[key] = rec;
    });
    return out;
  }
  // Replace one chapter's record, leaving every other entry as stored.
  function saveReading(key, rec) {
    var all = load(READING_KEY, {});
    if (!isMap(all)) all = {};
    all[key] = rec;
    return storeOk(READING_KEY, all);
  }

  // Chapter page: time on screen per note section -> coverage of the notes. Only a
  // visible tab counts, and the timer runs only while the notes are on screen.
  //
  // Several tabs may show the same chapter, so a page never writes back a copy of
  // the record it loaded. It keeps only `pending` (sections read since its last
  // sync) and `baseG` / `baseR` (the generation and round of the record it last
  // synced with); sync() re-reads the stored record and merges the pending sections
  // into it. A record reset or recreated elsewhere (another g), or one whose round was
  // finished elsewhere (another r), is adopted and the pending reads dropped: they
  // belong to a round that is over. Every read-merge-write and reset, also the one on
  // leaving the page, runs under one cross-tab lock (Web Locks) where the browser has it.
  function initReading(key) {
    var status = document.getElementById('ex-reading');
    var note = document.querySelector('.ex-notes .ex-note');
    var heads = note ? note.querySelectorAll('h2[id][data-w]') : [];
    if (!key || !status || !heads.length || !window.IntersectionObserver || !storageWorks()) return;

    var secs = [], byId = {}, total = 0;
    heads.forEach(function (h) {
      if (own(byId, h.id)) return;
      var w = parseInt(h.getAttribute('data-w'), 10);
      if (!(w >= 1)) w = 1;
      var sec = { el: h, id: h.id, w: w, need: Math.min(DWELL_MAX, Math.max(DWELL_MIN, DWELL_PER_CHAR * w)), ms: 0 };
      secs.push(sec);
      byId[sec.id] = sec;
      total += w;
    });
    // A section runs from its heading to the next heading (the last one to the end of the notes).
    function bounds(i) {
      var top = secs[i].el.getBoundingClientRect().top;
      var bottom = i + 1 < secs.length ? secs[i + 1].el.getBoundingClientRect().top : note.getBoundingClientRect().bottom;
      return { top: top, bottom: bottom, height: bottom - top };
    }

    function newGeneration() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
    function freshRecord(g) { return { g: g, r: 0, seen: {}, pct: 0, t: Date.now(), done: [] }; }
    // Only the sections of this page count towards coverage.
    function coverage(seen) {
      var sum = 0;
      secs.forEach(function (sec) { if (own(seen, sec.id)) sum += sec.w; });
      return Math.round(100 * sum / total);
    }
    function onPage(record) {
      var seen = {};
      Object.keys(record.seen).forEach(function (id) { if (own(byId, id)) seen[id] = 1; });
      return { g: record.g, r: record.r, seen: seen, pct: coverage(seen), t: record.t, done: record.done.slice() };
    }
    function stored() { return readingMap()[key] || null; }
    // Run fn under the cross-tab reading lock (directly where Web Locks are missing).
    function locked(fn) { crossTabLock(READING_KEY, fn); }
    function resetTimers() { secs.forEach(function (sec) { sec.ms = 0; }); }

    var pending = {};
    var first = stored();
    var baseG = first ? first.g : null;   // null: the chapter had no record when loaded
    var baseR = first ? first.r : 0;
    var rec = first ? onPage(first) : freshRecord('');

    var line = el('span', 'ex-reading-text');
    var reset = el('button', 'ex-reading-reset', '重設本章閱讀紀錄');
    reset.type = 'button';
    status.appendChild(line);
    status.appendChild(reset);
    function render() {
      var text = '本章重點：第 ' + (rec.r + 1) + ' 輪，已讀 ' + rec.pct + '%' + (rec.r >= 1 ? '（已讀完 ' + rec.r + ' 次）' : '');
      if (line.textContent !== text) line.textContent = text;
    }
    render();
    status.hidden = false;

    // Show the stored record (null: none) without writing anything.
    function adopt(record) {
      var next = record ? onPage(record) : freshRecord('');
      var forgotten = record ? (baseG !== null && (record.g !== baseG || record.r !== baseR)) : baseG !== null;
      if (forgotten) pending = {};
      if (forgotten || next.r !== rec.r) resetTimers();
      baseG = record ? record.g : null;
      baseR = record ? record.r : 0;
      rec = next;
      render();
    }
    function sync() {
      if (!Object.keys(pending).length) return;
      var latest = stored();
      if (latest && baseG !== null && (latest.g !== baseG || latest.r !== baseR)) { adopt(latest); return; }
      var base, apply = true;
      if (latest) {
        base = latest;
      } else {
        base = freshRecord(newGeneration());
        apply = baseG === null;  // storage was cleared since this page loaded: drop its reads
      }
      if (!base.g) base.g = newGeneration();
      if (apply) Object.keys(pending).forEach(function (id) { if (own(byId, id)) base.seen[id] = 1; });
      base = onPage(base);
      var finished = apply && base.pct >= READ_FULL_PCT;
      if (finished) {
        base.r += 1;
        base.done.push(Date.now());
        if (base.done.length > DONE_KEEP) base.done = base.done.slice(-DONE_KEEP);
        base.seen = {};
        base.pct = 0;
      }
      base.t = Date.now();
      if (!saveReading(key, base)) return;  // keep the pending reads for the next try
      var changedRound = base.r !== rec.r;
      baseG = base.g;
      baseR = base.r;
      pending = {};
      rec = base;
      render();
      if (finished || changedRound) resetTimers();
      if (finished) showToast('本章重點第 ' + rec.r + ' 輪讀完 ✓');
    }

    var onScreen = false, timer = null, last = 0;
    function unseen(sec) { return !own(rec.seen, sec.id) && !own(pending, sec.id); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() {
      if (timer || !onScreen || document.visibilityState !== 'visible' || !secs.some(unseen)) return;
      last = Date.now();
      timer = setInterval(tick, DWELL_TICK);
    }
    function tick() {
      if (document.visibilityState !== 'visible' || !onScreen) { stop(); return; }
      var now = Date.now();
      var dt = Math.min(Math.max(now - last, 0), 2500);  // a stalled timer is not reading time
      last = now;
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      var waiting = false;
      secs.forEach(function (sec, i) {
        if (!unseen(sec)) return;
        waiting = true;
        // At least half of the section, or half of the window's height, is on screen.
        var b = bounds(i);
        if (!(b.height > 0)) return;
        var shown = Math.max(0, Math.min(b.bottom, vh) - Math.max(b.top, 0));
        if (shown < b.height * 0.5 && shown < vh * 0.5) return;
        sec.ms += dt;
        if (sec.ms >= sec.need) { pending[sec.id] = 1; locked(sync); }
      });
      if (!waiting) stop();
    }

    new IntersectionObserver(function (entries) {
      onScreen = entries[entries.length - 1].isIntersecting;
      if (onScreen) start(); else stop();
    }).observe(note);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { adopt(stored()); start(); }
      else { stop(); locked(sync); }
    });
    // Leaving the page: save under the same lock. If another tab holds it right then,
    // the last unsaved section of this visit is lost rather than written over its work.
    window.addEventListener('pagehide', function () { locked(sync); });
    // Another tab changed the record: show it (nothing is written here).
    window.addEventListener('storage', function (event) {
      if (event.key !== null && event.key !== READING_KEY) return;
      adopt(stored());
      start();
    });

    reset.addEventListener('click', function () {
      var ok = false;
      try { ok = window.confirm('重設本章重點的閱讀次數與進度？作答紀錄與「課本已讀完」不受影響。'); } catch (e) { ok = false; }
      if (!ok) return;
      locked(function () {
        // A new generation, so tabs that still hold older reads cannot revive them.
        var fresh = freshRecord(newGeneration());
        if (!saveReading(key, fresh)) return;
        pending = {};
        baseG = fresh.g;
        baseR = 0;
        rec = fresh;
        resetTimers();
        render();
        start();
      });
    });
  }
  // Small status toast in the look of the reading-place hint; closes itself.
  function showToast(text) {
    var box = el('div', 'ex-resume ex-toast');
    box.setAttribute('role', 'status');
    var msg = el('span', 'ex-resume-text');
    box.appendChild(msg);
    var close = el('button', 'ex-resume-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉提示');
    box.appendChild(close);
    var timer = setTimeout(dismiss, 6000);
    function dismiss() { clearTimeout(timer); box.remove(); }
    close.addEventListener('click', dismiss);
    document.body.appendChild(box);
    // Filled after insertion so screen readers announce it as a status message.
    setTimeout(function () { msg.textContent = text; }, 50);
  }
  // ✓N badge: this chapter's notes have been read N times (N >= 1).
  function readBadge(r) {
    var badge = el('span', 'ex-rd-badge', '✓' + r);
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', '重點讀完 ' + r + ' 次');
    badge.title = '重點讀完 ' + r + ' 次';
    return badge;
  }
  // Hub: a ✓N after each chapter link (chapter list and frequency table) whose notes
  // were read at least once in this browser. Run again on a page restored from bfcache.
  function fillHubBadges() {
    var rows = document.querySelectorAll('.ex-chapter-list li[data-ch], table.ex-rank tr[data-ch]');
    if (!rows.length) return;
    var map = storageWorks() ? readingMap() : {};
    rows.forEach(function (row) {
      var old = row.querySelector('.ex-rd-badge');
      if (old) old.remove();
      var rec = map[row.getAttribute('data-ch')];
      var link = row.querySelector('a');
      if (!rec || rec.r < 1 || !link) return;
      link.parentNode.insertBefore(readBadge(rec.r), link.nextSibling);
    });
  }

  // ---------------------------------------------------------- hub: continue reading
  function relativeTime(t) {
    var diff = Date.now() - t;
    if (diff < 60000) return '剛剛';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分鐘前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小時前';
    if (diff < 30 * 86400000) return Math.floor(diff / 86400000) + ' 天前';
    return dateText(t);
  }
  function shortTitle(title) {
    if (title.length <= 24) return title;
    var cut = title.slice(0, 24);
    var space = cut.lastIndexOf(' ');
    return (space > 12 ? cut.slice(0, space) : cut).replace(/[\s,:;]+$/, '') + '…';
  }
  // 「繼續閱讀」 card (as on the dermatology exam section): the chapter whose reading
  // position was saved last, with its section, when, and this round's 重點 coverage,
  // plus up to 3 other recent chapters. Chapter names come from the hub's own chapter
  // list; the card stays hidden (as generated) without JS, storage or a saved position.
  function fillContinue() {
    var box = document.querySelector('.ex-continue');
    if (!box) return;
    clear(box);
    box.hidden = true;
    if (!storageWorks()) return;
    var rows = {};
    document.querySelectorAll('.ex-chapter-list li[data-ch]').forEach(function (li) {
      var link = li.querySelector('a');
      var key = li.getAttribute('data-ch') || '';
      if (!link || !/^\d{1,2}-\d{1,2}$/.test(key)) return;
      var m = /^(Ch\.\d+)\s*(.*)$/.exec(link.textContent.replace(/\s+/g, ' ').trim()) || ['', 'Ch.' + key.split('-')[1], ''];
      rows[key] = {
        ch: 'BCSC ' + key.split('-')[0] + ' ' + m[1],
        title: m[2],
        href: link.getAttribute('href'),
        notes: !!li.querySelector('.ex-badge')
      };
    });
    var map = positions();
    var list = [];
    Object.keys(map).forEach(function (key) {
      var rec = map[key];
      if (!own(rows, key) || !isMap(rec) || typeof rec.t !== 'number' || !isFinite(rec.t) || rec.t <= 0) return;
      var h = typeof rec.h === 'string' ? rec.h.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
      list.push({ key: key, t: rec.t, h: h });
    });
    if (!list.length) return;
    list.sort(function (a, b) { return b.t - a.t; });
    var top = list[0];
    var info = rows[top.key];
    var heading = el('h2', 'ex-h2', '繼續閱讀');
    heading.id = 'ex-continue-h';
    box.appendChild(heading);
    box.appendChild(el('p', 'ex-continue-main', info.ch + ' ' + info.title + (top.h ? ' 〈' + top.h + '〉' : '')));
    var sub = relativeTime(top.t);
    if (info.notes) {
      var reading = readingMap();
      sub += ' · 本章重點已讀 ' + (own(reading, top.key) ? reading[top.key].pct : 0) + '%';
    }
    box.appendChild(el('p', 'ex-continue-sub', sub));
    var go = el('p', 'ex-continue-go');
    var cta = el('a', 'ex-cta', '繼續 →');
    cta.href = info.href;   // no #: the chapter page itself reopens at the saved place
    go.appendChild(cta);
    box.appendChild(go);
    var more = list.slice(1, 4);
    if (more.length) {
      var line = el('p', 'ex-continue-more', '最近也讀過：');
      more.forEach(function (item, i) {
        if (i) line.appendChild(el('span', 'ex-continue-sep', '·'));
        var a = el('a', null, rows[item.key].ch + ' ' + shortTitle(rows[item.key].title));
        a.href = rows[item.key].href;
        line.appendChild(a);
      });
      box.appendChild(line);
    }
    box.hidden = false;
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
  // opts.host: put the bar inside this (sticky) element instead of above box (the
  // practice paper's timer bar); opts.allDone: the message when nothing is left.
  // A card left blank when a practice paper was handed in counts as not answered.
  function initAnswerBar(box, tools, opts) {
    opts = opts || {};
    function answered(card) { return card.classList.contains('ex-done') && card.getAttribute('data-outcome') !== 'blank'; }
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
    var only = el('button', 'ex-ans-only', '只看未作答');
    only.type = 'button';
    only.setAttribute('aria-pressed', 'false');
    var next = el('button', 'ex-ans-next', '跳到下一題未作答');
    next.type = 'button';
    var live = el('span', 'ex-sr');
    live.setAttribute('aria-live', 'polite');
    bar.appendChild(status);
    bar.appendChild(only);
    bar.appendChild(next);
    bar.appendChild(live);
    if (opts.host) opts.host.appendChild(bar);
    else box.parentNode.insertBefore(bar, box);
    var sticky = opts.host || bar;
    var lastJump = null;
    var wipe = el('button', 'ex-ans-clear', '清除本章作答紀錄');
    wipe.type = 'button';
    if (tools) tools.appendChild(wipe);

    function refresh() {
      var list = cards();
      var done = list.filter(answered).length;
      bar.hidden = !list.length;
      wipe.hidden = !list.length;
      status.textContent = '已作答 ' + done + '／' + list.length + ' 題・未作答 ' + (list.length - done) + ' 題';
      next.disabled = done >= list.length;
    }
    // 只看未作答 (quiz mode only, as the CSS rule is): answered cards (and cards with no
    // answer key yet) hide when it is switched on; a card answered meanwhile stays until
    // it is toggled again, so a result and its explanation never vanish on submit. A 考點
    // heading whose questions are all hidden hides with them.
    function setOnlyTodo(on) {
      only.setAttribute('aria-pressed', on ? 'true' : 'false');
      var heading = null;
      var shown = false;
      function closeGroup() { if (heading) heading.classList.toggle('ex-hide', on && !shown); }
      Array.prototype.forEach.call(box.children, function (node) {
        if (node.classList.contains('ex-concept')) {
          closeGroup();
          heading = node;
          shown = false;
        } else if (node.classList.contains('ex-q')) {
          // Cards without an answer key cannot be answered and are not counted either.
          var hide = on && (answered(node) || node.classList.contains('ex-unanswered'));
          node.classList.toggle('ex-hide', hide);
          if (!hide) shown = true;
        }
      });
      closeGroup();
    }
    only.addEventListener('click', function () { setOnlyTodo(only.getAttribute('aria-pressed') !== 'true'); });
    next.addEventListener('click', function () {
      var list = cards();
      // Search onward from the question at the top of the screen (or the one just
      // jumped to, while a smooth scroll is still on its way), wrapping to the start.
      var current = -1;
      var y = headerBottom() + sticky.offsetHeight + 24;
      for (var i = 0; i < list.length; i++) {
        if (list[i].getBoundingClientRect().top > y) break;
        current = i;
      }
      if (lastJump && Date.now() - lastJump.t < 1500) current = Math.max(current, list.indexOf(lastJump.card));
      for (var k = 1; k <= list.length; k++) {
        var card = list[(current + k) % list.length];
        if (answered(card)) continue;
        scrollToY(card.getBoundingClientRect().top + window.pageYOffset - headerBottom() - sticky.offsetHeight - 12, true);
        card.setAttribute('tabindex', '-1');
        try { card.focus({ preventScroll: true }); } catch (e) { card.focus(); }
        lastJump = { card: card, t: Date.now() };
        return;
      }
      live.textContent = opts.allDone || '本章題目都作答過了';
    });
    wipe.addEventListener('click', function () {
      var all = Array.prototype.slice.call(box.querySelectorAll('.ex-q'));
      var ns = all.map(function (c) { return c.getAttribute('data-qid'); });
      if (!window.confirm('確定要清除本章 ' + cards().length + ' 題在這台裝置上的作答紀錄嗎？'
        + '（同一題若也標在其他章節，那邊的作答紀錄也會一起清除；錯題本與「課本已讀完」不受影響）')) return;
      forget(ANS_KEY, ns);
      forget(STATS_KEY, ns);
      all.forEach(function (card) { resetQuestion(card, false); });
      setOnlyTodo(false);
      refreshStrip();
      refresh();
      live.textContent = '已清除本章作答紀錄';
    });
    return {
      refresh: refresh,
      reset: function () { setOnlyTodo(false); },
      // Answers shown meanwhile (another tab's) are filtered like the rest.
      reapply: function () { setOnlyTodo(only.getAttribute('aria-pressed') === 'true'); }
    };
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

  // ---------------------------------------------------------- concept overview (/exam/concepts)
  // The server renders every concept (sorted by question count) and keeps the form
  // hidden, so without JavaScript the whole list shows. Here: keyword search (title,
  // chapter labels, or a question number such as "Q120"), chapter filter, sort, and
  // 「載入更多」 every data-cpt-step items; the state is mirrored in ?kw=&ch=&sort=.
  function initConcepts(list) {
    var form = document.querySelector('form[data-concept-filter]');
    var more = document.querySelector('[data-cpt-more]');
    if (!form || !more) return;
    var step = Number(list.getAttribute('data-cpt-step')) || 25;
    var kw = form.querySelector('#cpt-kw');
    var ch = form.querySelector('#cpt-ch');
    var sort = form.querySelector('#cpt-sort');
    var status = document.querySelector('.ex-cpt-status');
    var empty = document.querySelector('.ex-cpt-empty');
    var btn = more.querySelector('.ex-more-btn');
    var moreStatus = more.querySelector('.ex-more-status');
    var order = {};
    Array.prototype.forEach.call(ch.querySelectorAll('option[value]'), function (o, i) { if (o.value) order[o.value] = i; });
    var items = Array.prototype.map.call(list.querySelectorAll(':scope > details.ex-cpt'), function (node, i) {
      var nums = Array.prototype.map.call(node.querySelectorAll('.ex-qno'), function (q) { return q.textContent.slice(1); });
      return {
        node: node, rank: i, n: Number(node.getAttribute('data-n')) || 0,
        home: node.getAttribute('data-home') || '', ch: (node.getAttribute('data-ch') || '').split(' '),
        nums: nums, text: (node.textContent || '').toLowerCase()
      };
    });
    var shown = 0;
    var matched = [];
    function homeOrder(it) { return it.home in order ? order[it.home] : 1e6; }
    // "Q120" is always a question number; a bare number is one only when it is the whole
    // query ("120"). Inside a longer query it is ordinary text, so "MNV Type 1" still
    // finds 「MNV Type 1/2 影像特徵」.
    function hit(it, words) {
      return words.every(function (w) {
        var num = /^q(\d{1,5})$/.exec(w) || (words.length === 1 && /^(\d{1,5})$/.exec(w));
        if (num) return it.nums.indexOf(String(Number(num[1]))) !== -1;
        return it.text.indexOf(w) !== -1;
      });
    }
    function paint() {
      var visible = {};
      matched.slice(0, shown).forEach(function (it) { visible[it.rank] = true; });
      items.forEach(function (it) { it.node.hidden = !visible[it.rank]; });
      empty.hidden = matched.length > 0;
      status.textContent = matched.length === items.length
        ? '共 ' + items.length + ' 個考點'
        : '符合 ' + matched.length + ' / ' + items.length + ' 個考點';
      moreStatus.textContent = '已顯示 ' + Math.min(shown, matched.length) + ' / ' + matched.length + ' 個';
      more.hidden = shown >= matched.length;
    }
    function syncUrl() {
      var params = new URLSearchParams(location.search);
      [['kw', kw.value.trim()], ['ch', ch.value], ['sort', sort.value === 'count' ? '' : sort.value]].forEach(function (p) {
        if (p[1]) params.set(p[0], p[1]); else params.delete(p[0]);
      });
      var qs = params.toString();
      history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    }
    function apply(keepUrl) {
      var words = terms(kw.value);
      var key = ch.value;
      matched = items.filter(function (it) {
        return (!key || it.ch.indexOf(key) !== -1) && hit(it, words);
      });
      matched.sort(sort.value === 'chapter'
        ? function (a, b) { return homeOrder(a) - homeOrder(b) || b.n - a.n || a.rank - b.rank; }
        : function (a, b) { return a.rank - b.rank; });
      matched.forEach(function (it) { list.appendChild(it.node); });
      shown = step;
      paint();
      if (!keepUrl) syncUrl();
    }
    btn.addEventListener('click', function () {
      var first = matched[shown];
      shown += step;
      paint();
      if (first && shown >= matched.length) first.node.querySelector('summary').focus();
    });
    var params = new URLSearchParams(location.search);
    kw.value = (params.get('kw') || '').slice(0, 100);
    if (params.get('ch') && params.get('ch') in order) ch.value = params.get('ch');
    if (params.get('sort') === 'chapter') sort.value = 'chapter';
    var timer = 0;
    kw.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { apply(false); }, 200); });
    ch.addEventListener('change', function () { apply(false); });
    sort.addEventListener('change', function () { apply(false); });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); clearTimeout(timer); apply(false); });
    form.hidden = false;
    apply(true);
    // A link to one concept (#c1-001) opens it and shows it even when it is past the first page.
    var target = /^#c\d+-\d{3}$/.test(location.hash) ? document.getElementById(location.hash.slice(1)) : null;
    if (target) {
      target.hidden = false;
      target.open = true;
      target.scrollIntoView();
    }
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
    // Back from a chapter: show the reading rounds recorded meanwhile.
    else if (ev.persisted) {
      fillHubBadges();
      fillContinue();
      var pg = document.getElementById('ex-progress');
      if (pg) renderProgress(pg);
    }
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
    revealTarget();
    window.addEventListener('hashchange', revealTarget);
    var landing = initLanding();
    var resume = initReadingPosition(strip ? strip.getAttribute('data-progress-chapter') : '');
    if (strip) initReading(strip.getAttribute('data-progress-chapter'));
    fillHubBadges();
    fillContinue();
    var settle = landing || resume;
    var tocSide = document.querySelector('.ex-toc-side');
    if (tocSide) initTocSpy(tocSide);
    var hubSearchForm = document.querySelector('[data-hub-search]');
    if (hubSearchForm) initHubSearch(hubSearchForm);
    var concepts = document.getElementById('ex-cpt-all');
    if (concepts) initConcepts(concepts);
    var rank = document.querySelector('table.ex-rank[data-rank-step]');
    if (rank) initRank(rank);
    var authBar = document.querySelector('.ex-auth');
    if (authBar) initAuthBar(authBar, settle);
    var loginForm = document.querySelector('form.ex-login');
    if (loginForm) initLogin(loginForm);
    var progress = document.getElementById('ex-progress');
    if (progress) { initProgressBar(progress); renderProgress(progress); }
    var clearProgress = document.querySelector('.ex-clear-progress');
    if (clearProgress) {
      clearProgress.addEventListener('click', function () {
        if (!window.confirm('確定要清除這台裝置上的作答紀錄（含各題上次選的答案）與最後讀的日期嗎？（「課本已讀完」、重點閱讀次數與錯題本不受影響）')) return;
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
