/* 物流轨迹页面逻辑 */
(function () {
  'use strict';

  function fmt(dt) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) +
      ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  }

  function fmtDate(dt) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return (dt.getMonth() + 1) + '月' + dt.getDate() + '日 ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  }

  function query() {
    var tn = document.getElementById('tn-input').value.trim();
    var routeType = document.getElementById('route-type').value;
    var errBox = document.getElementById('error-box');
    var result = document.getElementById('result');

    errBox.classList.add('hidden');
    result.classList.add('hidden');

    if (!tn) {
      errBox.textContent = '请输入运单号';
      errBox.classList.remove('hidden');
      return;
    }

    var carrier = TrackEngine.detectCarrier(tn);
    if (!carrier) {
      errBox.innerHTML = '无法识别承运商。支持格式：<br>' +
        TrackEngine.CARRIERS.map(function (c) {
          return c.name + '：' + c.pattern.source.replace(/\\/g, '');
        }).join('<br>');
      errBox.classList.remove('hidden');
      return;
    }

    /* 演示：发货时间设为 40 小时前（跨境 96 小时前），查询时间为现在 */
    var now = new Date();
    var shippedHoursAgo = routeType === 'cross' ? 96 : 40;
    var shippedAt = new Date(now.getTime() - shippedHoursAgo * 3600 * 1000);

    var trace = TrackEngine.generateTrace(tn, shippedAt, now, routeType);
    render(tn, trace);
  }

  function render(tn, trace) {
    var result = document.getElementById('result');
    result.classList.remove('hidden');

    /* 概要卡 */
    var badge = document.getElementById('carrier-badge');
    badge.textContent = trace.carrier.code;
    badge.style.background = trace.carrier.color;
    document.getElementById('sum-tn').textContent = trace.carrier.name + ' · ' + tn;

    var statusEl = document.getElementById('sum-status');
    var abnormal = trace.events.some(function (e) { return e.abnormal; }) && !trace.delivered;
    statusEl.textContent = trace.delivered ? '✅ 已签收' : (abnormal ? '⚠️ ' + trace.currentStatus + '（有延误提醒）' : '🚚 ' + trace.currentStatus);
    statusEl.className = 'status-line' + (abnormal ? ' abnormal' : '');

    var etaEl = document.getElementById('sum-eta');
    if (trace.delivered) {
      document.getElementById('eta-label').textContent = '签收时间';
      etaEl.textContent = fmtDate(trace.events[0].time);
      etaEl.classList.add('delivered');
    } else {
      document.getElementById('eta-label').textContent = '预计送达';
      etaEl.textContent = trace.eta ? fmtDate(trace.eta) : '--';
      etaEl.classList.remove('delivered');
    }

    renderRouteBar(trace);
    renderTimeline(trace);
  }

  /* 路由节点进度条 */
  function renderRouteBar(trace) {
    var bar = document.getElementById('route-bar');
    bar.innerHTML = '';
    var passed = {};
    trace.events.forEach(function (e) { passed[e.node] = true; });
    var currentNode = trace.events.length ? trace.events[0].node : null;

    trace.route.forEach(function (node, i) {
      if (i > 0) {
        var line = document.createElement('div');
        line.className = 'rb-line' + (passed[node] ? ' done' : '');
        bar.appendChild(line);
      }
      var el = document.createElement('div');
      var cls = 'rb-node';
      if (passed[node]) cls += ' done';
      if (node === currentNode && !trace.delivered) cls += ' current';
      el.className = cls;
      el.innerHTML = '<div class="rb-dot"></div><div class="rb-name">' + node + '</div>';
      bar.appendChild(el);
    });
  }

  function renderTimeline(trace) {
    var box = document.getElementById('timeline');
    box.innerHTML = '';
    if (!trace.events.length) {
      box.innerHTML = '<div style="color:#8894a8;font-size:13px;">暂无轨迹信息，包裹待揽收</div>';
      return;
    }
    trace.events.forEach(function (e, i) {
      var item = document.createElement('div');
      item.className = 'tl-item' + (i === 0 ? ' latest' : '') + (e.abnormal ? ' abnormal' : '');
      item.innerHTML =
        '<div class="tl-head"><span class="tl-status">' + e.status + '</span>' +
        '<span class="tl-time">' + fmt(e.time) + '</span></div>' +
        '<div class="tl-desc">' + e.desc + '</div>' +
        '<div class="tl-node">📍 ' + e.node + '</div>';
      box.appendChild(item);
    });
  }

  document.getElementById('btn-query').onclick = query;
  document.getElementById('tn-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') query();
  });
  document.querySelectorAll('.qk').forEach(function (btn) {
    btn.onclick = function () {
      document.getElementById('tn-input').value = btn.dataset.tn;
      query();
    };
  });
})();
