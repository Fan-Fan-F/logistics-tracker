/* 物流轨迹引擎（纯逻辑）
 *
 * 多承运商轨迹查询模拟：
 * 1. 按运单号规则识别承运商
 * 2. 基于发货时间确定性生成轨迹（同一单号多次查询结果一致）
 * 3. 状态机：已揽收 → 运输中 → 到达派送城市 → 派送中 → 已签收（含异常分支）
 */
(function (global) {
  'use strict';

  var CARRIERS = [
    { code: 'SF', name: '顺丰速运', pattern: /^SF\d{12}$/i, speed: 1.6, color: '#e64545' },
    { code: 'ZTO', name: '中通快递', pattern: /^7\d{11,14}$/, speed: 1.0, color: '#3a6df0' },
    { code: 'YTO', name: '圆通速递', pattern: /^YT\d{13}$/i, speed: 1.0, color: '#7b2ff2' },
    { code: 'JD', name: '京东物流', pattern: /^JD\d{14}$/i, speed: 1.4, color: '#c81623' },
    { code: 'EMS', name: 'EMS 邮政', pattern: /^E[A-Z]\d{9}CN$/i, speed: 0.7, color: '#1e9e4a' }
  ];

  var STATUS_FLOW = ['已揽收', '干线运输', '到达转运中心', '离开转运中心', '到达派送网点', '派送中', '已签收'];

  /* 示例路由库（跨境与国内混合） */
  var ROUTES = {
    domestic: ['广州白云仓', '广州转运中心', '武汉转运中心', '北京转运中心', '北京派送网点', '收件地址'],
    cross: ['深圳保税仓', '深圳口岸', '香港葵涌货站', '法兰克福机场', '杜伊斯堡分拨中心', '柏林派送网点', '收件地址']
  };

  function detectCarrier(trackingNo) {
    for (var i = 0; i < CARRIERS.length; i++) {
      if (CARRIERS[i].pattern.test(trackingNo)) return CARRIERS[i];
    }
    return null;
  }

  /* 由单号派生确定性随机源 */
  function seedFrom(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
    }
    return function () {
      h |= 0; h = (h + 0x6D2B79F5) | 0;
      var t = Math.imul(h ^ (h >>> 15), 1 | h);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 生成轨迹
   * trackingNo: 运单号
   * shippedAt: 发货时间（Date）
   * now: 查询时间（Date）
   * routeType: 'domestic' | 'cross'
   */
  function generateTrace(trackingNo, shippedAt, now, routeType) {
    var carrier = detectCarrier(trackingNo);
    if (!carrier) return { error: '无法识别承运商，请检查单号格式' };

    var route = ROUTES[routeType || 'domestic'];
    var rnd = seedFrom(trackingNo + shippedAt.getTime());

    /* 总时效：基础 72h / speed，跨境 ×3 */
    var baseHours = (routeType === 'cross' ? 216 : 72) / carrier.speed;
    var jitter = 0.85 + rnd() * 0.3;
    var totalHours = baseHours * jitter;

    /* 将总时长按段分配（干线段更长） */
    var segWeights = route.map(function (_, i) {
      if (i === 0) return 0.08;
      if (i === route.length - 1) return 0.06;
      return (i % 2 === 1) ? 0.22 : 0.12;
    });
    var wSum = segWeights.reduce(function (a, b) { return a + b; }, 0);

    var events = [];
    var cursor = shippedAt.getTime();
    var statusIdx = 0;
    route.forEach(function (node, i) {
      var segMs = (segWeights[i] / wSum) * totalHours * 3600 * 1000;
      if (i === 0) {
        events.push({ time: new Date(cursor), node: node, status: STATUS_FLOW[0], desc: '快件已揽收，正在称重扫描' });
      } else {
        cursor += segMs;
        var status = i === route.length - 1 ? STATUS_FLOW[6] : (STATUS_FLOW[1 + (statusIdx++ % 4)]);
        var descMap = {
          '干线运输': '快件已发出，下一站 ' + node,
          '到达转运中心': '快件到达 ' + node,
          '离开转运中心': '快件已离开 ' + node,
          '到达派送网点': '快件到达派送网点，即将安排派送',
          '派送中': '快递员正在派送，请保持电话畅通',
          '已签收': '快件已签收，感谢使用'
        };
        /* 到达最终节点前最后一段强制派送中状态 */
        if (i === route.length - 1) status = STATUS_FLOW[6];
        else if (i === route.length - 2) status = STATUS_FLOW[5];
        events.push({ time: new Date(cursor), node: node, status: status, desc: descMap[status] });
      }
    });

    /* 异常事件：12% 概率在运输中段插入一次延误 */
    if (rnd() < 0.12 && events.length > 4) {
      var at = 2 + Math.floor(rnd() * (events.length - 3));
      events.splice(at, 0, {
        time: new Date(events[at - 1].time.getTime() + 3600 * 1000 * (4 + rnd() * 10)),
        node: events[at - 1].node,
        status: '异常提醒',
        desc: '因天气原因干线运输延误，预计延迟 4-12 小时',
        abnormal: true
      });
    }

    /* 按查询时间截断：now 之后的事件不展示 */
    var elapsed = events.filter(function (e) { return e.time <= now; });
    var upcoming = events.filter(function (e) { return e.time > now; });
    var currentStatus = elapsed.length ? elapsed[elapsed.length - 1].status : '待揽收';
    var delivered = currentStatus === '已签收';

    /* 预计送达 */
    var eta = events.length ? events[events.length - 1].time : null;

    /* 进度百分比（节点维度） */
    var progress = elapsed.length / events.length;

    return {
      carrier: carrier,
      route: route,
      events: elapsed.reverse(), // 最新在前
      upcomingCount: upcoming.length,
      currentStatus: delivered ? '已签收' : currentStatus,
      delivered: delivered,
      eta: eta,
      progress: progress,
      routeType: routeType || 'domestic'
    };
  }

  global.TrackEngine = {
    CARRIERS: CARRIERS,
    detectCarrier: detectCarrier,
    generateTrace: generateTrace
  };
})(window);
