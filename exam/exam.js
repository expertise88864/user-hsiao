/* Board-exam review pages (/exam/**): quiz/browse mode, practice exams, wrong-answer
 * notebook, search and Anki export. Pages are fully rendered as static HTML; this
 * script only adds interaction. Progress lives in localStorage on this device only.
 * All dynamic text is inserted with textContent / DOM nodes (no innerHTML), and the
 * pages carry no inline script, so this file also starts the shared site chrome. */
(function () {
  'use strict';
  var MODE_KEY = 'hs:exam:mode';
  var WRONG_KEY = 'hs:exam:wrong';
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

  function setMode(mode) {
    body.classList.toggle('ex-quiz', mode === 'quiz');
    document.querySelectorAll('.ex-mode').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-mode') === mode ? 'true' : 'false');
    });
    store(MODE_KEY, mode);
  }

  function resetQuestion(card) {
    if (card.classList.contains('ex-unanswered')) return;
    card.classList.remove('ex-done');
    card.removeAttribute('data-outcome');
    card.querySelectorAll('.ex-opt').forEach(function (opt) { opt.classList.remove('ex-picked'); });
    card.querySelectorAll('input[type=radio]').forEach(function (input) { input.checked = false; input.disabled = false; });
    var result = card.querySelector('.ex-result');
    if (result) result.textContent = '';
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
    var ok = picked.value === answer;
    card.classList.add('ex-done');
    card.setAttribute('data-outcome', ok ? 'right' : 'wrong');
    picked.closest('.ex-opt').classList.add('ex-picked');
    card.querySelectorAll('input[type=radio]').forEach(function (input) { input.disabled = true; });
    if (result) result.textContent = ok ? '答對了' : '答錯了，答案是 ' + answer;
    markWrong(card.getAttribute('data-qid'), !ok);
    return ok;
  }

  function wireQuestion(card) {
    var submit = card.querySelector('.ex-submit');
    var reset = card.querySelector('.ex-reset');
    if (submit) submit.addEventListener('click', function () { grade(card, false); });
    if (reset) reset.addEventListener('click', function () { resetQuestion(card); });
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
      scope.querySelectorAll('.ex-q').forEach(resetQuestion);
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
    } else {
      reveal.appendChild(el('p', 'ex-pending', '這題的答案與詳解尚未整理（讀到相關章節時會補上）。'));
    }
    card.appendChild(reveal);
    wireQuestion(card);
    return card;
  }

  var dataPromise = null;
  function examData() {
    if (!dataPromise) {
      var src = document.querySelector('script[src^="/exam/exam.js"]');
      var v = src ? (src.getAttribute('src').split('?v=')[1] || '') : '';
      dataPromise = fetch('/exam/exam-data.json' + (v ? '?v=' + v : ''), { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          try { if (data.taxa) taxonRe = new RegExp(data.taxa, 'g'); } catch (e) { taxonRe = null; }
          return data;
        });
    }
    return dataPromise;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------------------------------------------------------- review page
  function renderReview(list) {
    examData().then(function (data) {
      var wrong = wrongList();
      var byN = {};
      data.questions.forEach(function (q) { byN[q.n] = q; });
      clear(list);
      var rows = wrong.map(function (n) { return byN[n]; }).filter(function (q) { return q && q.answer; });
      if (!rows.length) {
        list.appendChild(el('p', 'ex-pending', '目前沒有錯題。到章節頁或模擬考切換「作答模式」作答，答錯的題目會出現在這裡。'));
        return;
      }
      list.appendChild(el('p', 'ex-meta', '共 ' + rows.length + ' 題錯題'));
      rows.forEach(function (q) { list.appendChild(renderCard(q, data, { removable: true })); });
    }).catch(function () {
      clear(list);
      list.appendChild(el('p', 'ex-pending', '題庫載入失敗，請重新整理頁面。'));
    });
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
      front += '<small>眼科專科歷屆題 第 ' + q.n + ' 題 · ' + q.ch.map(function (c) { return 'BCSC ' + c; }).join('、') + '</small>';
      var back = '答案：' + q.answer + '<br>' + htmlText(q.expl.summary);
      q.expl.items.forEach(function (it) {
        back += '<br>' + htmlText(it.key + ' ' + it.label + '：' + it.text + '（' + it.refs.join('；') + '）');
      });
      (q.expl.flags || []).forEach(function (f) { back += '<br>' + htmlText('⚠ ' + f); });
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
      }).catch(function () {
        note.textContent = '題庫載入失敗，請重新整理頁面。';
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
      q.expl.items.forEach(function (it) { parts.push(it.text); });
    }
    return parts.join(' ');
  }

  function runSearch(query, out) {
    var words = terms(query);
    clear(out);
    if (!words.length) return;
    out.appendChild(el('p', 'ex-pending', '搜尋中…'));
    examData().then(function (data) {
      clear(out);
      var noteHits = [];
      Object.keys(data.notes).forEach(function (key) {
        data.notes[key].forEach(function (para) {
          if (matches(para.t, words)) noteHits.push({ key: key, h: para.h, t: para.t });
        });
      });
      var qHits = data.questions.filter(function (q) { return matches(questionText(q), words); });
      out.appendChild(el('p', 'ex-meta', '重點 ' + noteHits.length + ' 筆 · 考題 ' + qHits.length + ' 題'));
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
      if (qHits.length) {
        out.appendChild(el('h2', 'ex-h2', '歷屆考題'));
        if (qHits.length > 80) out.appendChild(el('p', 'ex-meta', '只顯示前 80 題，請加關鍵字縮小範圍。'));
        qHits.slice(0, 80).forEach(function (q) { out.appendChild(renderCard(q, data, { suffix: '-s' })); });
      }
      if (!noteHits.length && !qHits.length) out.appendChild(el('p', 'ex-pending', '找不到符合的重點或考題。'));
    }).catch(function () {
      clear(out);
      out.appendChild(el('p', 'ex-pending', '題庫載入失敗，請重新整理頁面。'));
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

  // ---------------------------------------------------------- init
  function init() {
    if (window.DN && typeof window.DN.initBlog === 'function') window.DN.initBlog({});
    document.querySelectorAll('.ex-mode').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.getAttribute('data-mode')); });
    });
    setMode(load(MODE_KEY, 'browse') === 'quiz' ? 'quiz' : 'browse');
    document.querySelectorAll('.ex-q').forEach(wireQuestion);
    var form = document.querySelector('[data-practice-form]');
    if (form) initPractice(form);
    var list = document.getElementById('ex-review-list');
    if (list) renderReview(list);
    var search = document.querySelector('[data-search-form]');
    if (search) initSearch(search);
    document.querySelectorAll('.ex-anki').forEach(function (btn) {
      btn.addEventListener('click', function () {
        examData().then(function (data) {
          var scope = btn.getAttribute('data-scope');
          var wrong = wrongList();
          var rows = data.questions.filter(function (q) {
            return q.answer && (scope !== 'wrong' || wrong.indexOf(q.n) !== -1);
          });
          download(scope === 'wrong' ? 'ophtho-board-wrong.csv' : 'ophtho-board-answered.csv', ankiRows(rows));
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
