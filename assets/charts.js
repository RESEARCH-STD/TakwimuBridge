/*
 * Chart rendering helpers shared by the dashboard, analysis and cloud pages.
 * Wraps Chart.js (bar charts) and wordcloud2.js (theme cloud + word cloud),
 * plus a small heat-color helper used for the respondent×theme matrix table
 * (rendered as a plain HTML table rather than a canvas, so cells stay
 * clickable/accessible).
 */
(function () {
  "use strict";

  var registry = {};

  var BRAND_COLORS = ["#1B4F9C", "#17B8A6", "#E08E45", "#2F6FED", "#C0392B", "#1E8A5F", "#8E44AD", "#D35400"];
  var FONT_BODY = "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif";
  var FONT_DISPLAY = "'Space Grotesk', Inter, sans-serif";

  function applyDefaults() {
    if (!window.Chart || applyDefaults.done) return;
    window.Chart.defaults.font.family = FONT_BODY;
    window.Chart.defaults.color = "#5B6B82";
    window.Chart.defaults.borderColor = "rgba(27, 79, 156, 0.08)";
    applyDefaults.done = true;
  }

  function destroy(canvasId) {
    if (registry[canvasId]) { registry[canvasId].destroy(); delete registry[canvasId]; }
  }

  // Charts and clouds measure their text when drawn; drawing before the web
  // fonts arrive sizes everything for the fallback font and clips labels.
  // Only the latest request per canvas runs, so quick re-renders can't race.
  var fontsReady = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load("12px Inter"), document.fonts.load("600 12px 'Space Grotesk'")]).catch(function () {})
    : Promise.resolve();
  var latest = {};
  function whenReady(canvasId, draw) {
    var token = (latest[canvasId] = (latest[canvasId] || 0) + 1);
    fontsReady.then(function () { if (latest[canvasId] === token) draw(); });
  }

  function truncate(label, max) {
    label = String(label);
    return label.length > max ? label.slice(0, max - 1) + "…" : label;
  }

  function barChart(canvasId, labels, values, opts) {
    opts = opts || {};
    destroy(canvasId);
    var el = document.getElementById(canvasId);
    if (!el || !window.Chart) return null;
    applyDefaults();
    var categoryAxis = opts.horizontal ? "y" : "x";
    var valueAxis = opts.horizontal ? "x" : "y";
    var maxLabel = opts.maxLabelLength || (opts.horizontal ? 26 : 16);
    var scales = {};
    scales[categoryAxis] = {
      grid: { display: false },
      ticks: {
        autoSkip: false,
        callback: function (value) { return truncate(this.getLabelForValue(value), maxLabel); }
      }
    };
    scales[valueAxis] = {
      beginAtZero: true,
      max: opts.max,
      ticks: { precision: 0, callback: function (v) { return v + (opts.suffix || ""); } }
    };
    var chart = new window.Chart(el, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: opts.label || "Value",
          data: values,
          backgroundColor: opts.colors || labels.map(function (_, i) { return BRAND_COLORS[i % BRAND_COLORS.length]; }),
          borderRadius: 6,
          maxBarThickness: 44
        }]
      },
      options: {
        indexAxis: categoryAxis,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) {
                var i = items[0].dataIndex;
                return opts.tooltipTitles ? opts.tooltipTitles[i] : labels[i];
              },
              label: function (item) {
                return " " + (opts.label || "Value") + ": " + item.formattedValue + (opts.suffix || "");
              }
            }
          }
        },
        scales: scales,
        onHover: opts.onClick ? function (evt, elements) {
          evt.native.target.style.cursor = elements.length ? "pointer" : "default";
        } : undefined,
        onClick: opts.onClick ? function (evt, elements) {
          if (elements && elements.length) opts.onClick(elements[0].index);
        } : undefined
      }
    });
    registry[canvasId] = chart;
    return chart;
  }

  function groupedBarChart(canvasId, labels, series, opts) {
    // series: [{ name, values, color? }]
    opts = opts || {};
    destroy(canvasId);
    var el = document.getElementById(canvasId);
    if (!el || !window.Chart) return null;
    applyDefaults();
    var chart = new window.Chart(el, {
      type: "bar",
      data: {
        labels: labels,
        datasets: series.map(function (s, i) {
          return { label: s.name, data: s.values, backgroundColor: s.color || BRAND_COLORS[i % BRAND_COLORS.length], borderRadius: 5, maxBarThickness: 34 };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            callbacks: {
              title: function (items) {
                var i = items[0].dataIndex;
                return opts.tooltipTitles ? opts.tooltipTitles[i] : labels[i];
              },
              label: function (item) { return " " + item.dataset.label + ": " + item.formattedValue + (opts.suffix || ""); }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { autoSkip: false, callback: function (v) { return truncate(this.getLabelForValue(v), opts.maxLabelLength || 16); } } },
          y: { beginAtZero: true, max: opts.max, ticks: { precision: 0, callback: function (v) { return v + (opts.suffix || ""); } } }
        }
      }
    });
    registry[canvasId] = chart;
    return chart;
  }

  function heatColor(value, max) {
    if (!max || value <= 0) return "#F5F7FA";
    var t = Math.min(1, value / max);
    // interpolate light gray (#F5F7FA) -> brand primary (#1B4F9C)
    var from = [245, 247, 250], to = [27, 79, 156];
    var rgb = from.map(function (c, i) { return Math.round(c + (to[i] - c) * t); });
    return "rgb(" + rgb.join(",") + ")";
  }

  function heatTextColor(value, max) {
    if (!max) return "#1E2A3A";
    return (value / max) > 0.55 ? "#ffffff" : "#1E2A3A";
  }

  // Size the canvas backing store to its laid-out box so clouds stay crisp
  // on high-DPI screens; returns the device-pixel ratio used.
  function fitCanvas(el) {
    var dpr = window.devicePixelRatio || 1;
    var w = el.clientWidth || (el.parentElement && el.parentElement.clientWidth) || 600;
    var h = el.clientHeight || (el.parentElement && el.parentElement.clientHeight) || 320;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    return dpr;
  }

  function drawEmpty(el, message, dpr) {
    var ctx = el.getContext("2d");
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, el.width, el.height);
    ctx.fillStyle = "#8A97AB";
    ctx.font = (14 * dpr) + "px " + FONT_BODY;
    ctx.textAlign = "center";
    ctx.fillText(message, el.width / 2, el.height / 2);
  }

  function hashColor(word) {
    var h = 0;
    for (var i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
    return BRAND_COLORS[h % BRAND_COLORS.length];
  }

  // items: [{ id, label, value, color }] — labels must be unique.
  function renderThemeCloud(canvasId, items, opts) {
    opts = opts || {};
    var el = document.getElementById(canvasId);
    if (!el) return;
    var dpr = fitCanvas(el);
    var list = items.filter(function (i) { return i.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    if (!list.length || !window.WordCloud) {
      drawEmpty(el, opts.emptyMessage || "No coded references yet", dpr);
      return;
    }
    var byLabel = {};
    list.forEach(function (i) { byLabel[i.label] = i; });
    var max = list[0].value;
    var maxFont = Math.min(
      (el.width * 0.88) / (Math.max(6, list[0].label.length) * 0.58),
      el.height / 3.2,
      64 * dpr
    );
    var minFont = Math.max(11 * dpr, maxFont * 0.3);
    window.WordCloud(el, {
      list: list.map(function (i) { return [i.label, minFont + (i.value / max) * (maxFont - minFont)]; }),
      // List weights are already font sizes. shrinkToFit retries a word that
      // won't fit at 3/4 of its weight, so the size must be able to fall
      // below minSize — a floor inside weightFactor would recurse forever.
      weightFactor: 1,
      minSize: Math.round(7 * dpr),
      fontFamily: FONT_DISPLAY,
      fontWeight: 600,
      color: function (word) { return (byLabel[word] && byLabel[word].color) || BRAND_COLORS[0]; },
      backgroundColor: "#ffffff",
      gridSize: Math.round(6 * dpr),
      rotateRatio: 0,
      shuffle: false,
      shrinkToFit: true,
      drawOutOfBound: false,
      hover: function (item) { el.style.cursor = item ? "pointer" : "default"; },
      click: function (item) {
        if (item && opts.onClick && byLabel[item[0]]) opts.onClick(byLabel[item[0]]);
      }
    });
  }

  function renderWordCloud(canvasId, wordFreqArray, opts) {
    opts = opts || {};
    var el = document.getElementById(canvasId);
    if (!el) return;
    var dpr = fitCanvas(el);
    if (!wordFreqArray.length || !window.WordCloud) {
      drawEmpty(el, opts.emptyMessage || "No words found for this scope", dpr);
      return;
    }
    var max = wordFreqArray[0].count;
    window.WordCloud(el, {
      list: wordFreqArray.slice(0, opts.limit || 60).map(function (w) { return [w.word, (12 + (w.count / max) * 46) * dpr]; }),
      weightFactor: 1,
      minSize: Math.round(7 * dpr),
      gridSize: Math.round(7 * dpr),
      fontFamily: FONT_DISPLAY,
      fontWeight: 600,
      color: function (word) { return hashColor(word); },
      backgroundColor: "#ffffff",
      rotateRatio: 0.15,
      shuffle: false,
      shrinkToFit: true,
      drawOutOfBound: false
    });
  }

  function deferred(fn) {
    return function (canvasId) {
      var args = arguments;
      whenReady(canvasId, function () { fn.apply(null, args); });
    };
  }

  window.TB = window.TB || {};
  window.TB.charts = {
    barChart: deferred(barChart), groupedBarChart: deferred(groupedBarChart),
    renderThemeCloud: deferred(renderThemeCloud), renderWordCloud: deferred(renderWordCloud),
    heatColor: heatColor, heatTextColor: heatTextColor,
    destroy: function (canvasId) { whenReady(canvasId, function () { destroy(canvasId); }); },
    BRAND_COLORS: BRAND_COLORS
  };
})();