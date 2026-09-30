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
        `<td>${escape(source)}</td><td style="color:${color};font-weight:700">${escape(label)}</td></tr>`;
    }).join('');
    return (notices.length ? `<p role="status">${notices.map(escape).join(' ')}</p>` : '') +
      '<div tabindex="0" role="region" aria-label="使用者體驗指標表，可橫向捲動" style="overflow-x:auto">' +
      '<table class="dict-table" style="min-width:680px;margin-bottom:18px"><thead><tr>' +
      '<th scope="col">指標</th><th scope="col">樣本 p75</th><th scope="col">平均值</th>' +
      '<th scope="col">樣本／回報數</th><th scope="col">取樣範圍</th><th scope="col">來源</th>' +
      '<th scope="col">樣本判讀</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p>第一方僅取每項指標最近最多 1,000 筆回報中、最多 30 天內的樣本，標準量測會依 ID 去重。' +
      'GA4 平均值來自事件總值／事件數，不能換算成 p75；兩者的樣本數均不是不重複訪客數。</p>' +
      '<p>此為本站近期樣本的觀察，並非全站完整分布或 Google CrUX 結果。樣本 p75 由原始樣本排序計算；' +
      '沒有樣本顯示「—」，實測為零仍顯示零。GA4 範圍包含尚未結束的今天。</p>';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { render };
  else globalThis.HsiaoCwvDashboard = { render };
})();
