// Rendering is shared by the authenticated dashboard and its DOM regression tests.
(function () {
  'use strict';
  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }
  function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }
  function format(value, metric) {
    return numeric(value) ? value.toFixed(metric === 'CLS' ? 3 : 0) + (metric === 'CLS' ? '' : ' ms') : '—';
  }
  function measurementMethod(metric, measured) {
    if (metric.source === 'ga4' && metric.status === 'mean_only') return 'GA4 事件平均；無 p75';
    if (!measured) return '—';
    const method = { 'web-vitals-6': 'web-vitals 6', legacy: '舊量測' }[metric.method];
    if (typeof method !== 'string') return '未提供量測方法';
    return method + (metric.percentileMethod === 'nearest-rank' ? '；原始樣本排序 p75' : '；p75 方法未提供');
  }
  function receiptRange(metric, measured) {
    if (metric.source !== 'kv' || !measured) return '—';
    const oldest = metric.oldestSampleAt, newest = metric.newestSampleAt;
    if (![oldest, newest].every(value => Number.isInteger(value) && value > 0 && value <= 8640000000000000) ||
        oldest > newest) return '尚無完整樣本時間';
    const time = value => {
      const date = new Date(value);
      const label = date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      return '<time datetime="' + date.toISOString() + '">' + escape(label) + '</time>';
    };
    return time(oldest) + ' 至 ' + time(newest);
  }
  function render(report) {
    if (!Array.isArray(report?.metrics) || !report.metrics.length) {
      return '<p role="status">尚無可讀取的量測回應，請重新載入。</p>';
    }
    const collection = report.collection || {};
    const notices = [];
    if (collection.kv?.configured === false) notices.push('第一方 KV 儲存尚未設定。');
    const ga4Status = collection.ga4?.status;
    if (ga4Status === 'not_configured') notices.push('GA4 尚未設定，仍保留可讀取的第一方樣本。');
    if (ga4Status === 'invalid_config') notices.push('GA4 設定無法使用，請檢查服務帳號設定。');
    if (ga4Status === 'unavailable' || ga4Status === 'partial') notices.push('GA4 本次未能完整讀取，仍顯示其他可用數據。');
    if (Array.isArray(report.issues) && report.issues.some(issue => issue?.source === 'kv')) {
      notices.push('部分第一方儲存讀取失敗；缺值不代表效能良好。');
    }
    const rows = report.metrics.filter(m => m && typeof m === 'object').map(m => {
      const count = Number.isInteger(m.samples) && m.samples >= 0 ? m.samples.toLocaleString('zh-TW') : '—';
      const hasP75 = m.source === 'kv' && m.status === 'measured' && m.samples > 0 && numeric(m.p75);
      const thresholds = { LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500], FCP: [1800, 3000], TTFB: [800, 1800] }[m.name];
      let label = m.status === 'no_samples' ? '無可用樣本' : '尚無可用數據';
      let color = '#64748b';
      if (hasP75 && Array.isArray(thresholds)) {
        const band = m.p75 <= thresholds[0] ? 0 : m.p75 <= thresholds[1] ? 1 : 2;
        label = ['樣本 p75 良好', '樣本 p75 待改善', '樣本 p75 不良'][band];
        color = ['#15803d', '#92400e', '#b91c1c'][band];
      } else if (m.status === 'mean_only') {
        label = '僅平均值，無法判定 p75';
      }
      const source = m.source === 'kv'
        ? (m.method === 'legacy' ? '第一方／舊量測演算法' : '第一方樣本')
        : m.source === 'ga4' ? 'GA4 事件平均' : '尚無來源';
      const period = Number.isInteger(m.windowDays) && m.windowDays > 0
        ? (m.source === 'ga4' ? `含今日 ${m.windowDays} 曆日` : `滾動 ${m.windowDays} 天`) : '—';
      return `<tr><th scope="row">${escape(m.name)}</th><td>${hasP75 ? format(m.p75, m.name) : '—'}</td>` +
        `<td>${format(m.avg, m.name)}</td><td>${escape(count)}</td><td>${escape(period)}</td>` +
        `<td>${escape(source)}</td><td>${escape(measurementMethod(m, hasP75))}</td>` +
        `<td>${receiptRange(m, hasP75)}</td><td style="color:${color};font-weight:700">${escape(label)}</td></tr>`;
    }).join('');
    return (notices.length ? `<p role="status">${notices.map(escape).join(' ')}</p>` : '') +
      '<div tabindex="0" role="region" aria-label="使用者體驗指標表，可橫向捲動" style="overflow-x:auto">' +
      '<table class="dict-table" style="min-width:980px;margin-bottom:18px"><thead><tr>' +
      '<th scope="col">指標</th><th scope="col">樣本 p75</th><th scope="col">平均值</th>' +
      '<th scope="col">樣本／回報數</th><th scope="col">取樣範圍</th><th scope="col">來源</th>' +
      '<th scope="col">量測／p75 方法</th><th scope="col">保留樣本收件時間（台灣時間）</th>' +
      '<th scope="col">樣本判讀</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p>第一方僅取每項指標最近最多 1,000 筆回報中、最多 30 天內的樣本，標準量測會依 ID 去重。' +
      'GA4 平均值來自事件總值／事件數，不能換算成 p75；兩者的樣本數均不是不重複訪客數。</p>' +
      '<p>此為本站近期樣本的觀察，並非全站完整分布或 Google CrUX 結果。樣本 p75 由原始樣本排序計算；' +
      '沒有樣本顯示「—」，實測為零仍顯示零。GA4 範圍包含尚未結束的今天。</p>' +
      '<p>表中的時間是保留樣本的收件時間，不代表造訪時間，亦不代表取樣範圍內每一天都有資料。' +
      'GA4 事件平均未提供各筆收件時間。INP 僅涵蓋有可量測互動的頁面回報，樣本少時判讀有限。</p>';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { render };
  else globalThis.HsiaoCwvDashboard = { render };
})();
