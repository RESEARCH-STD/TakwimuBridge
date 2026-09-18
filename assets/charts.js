/*
 * Chart rendering helpers shared by analysis.qmd and wordfrequency.qmd.
 * Wraps Chart.js (bar/doughnut) and wordcloud2.js, plus a small heat-color
 * helper used for the respondent×theme matrix table (rendered as a plain
 * HTML table rather than a canvas, so cells stay clickable/accessible).
 */
(function () {
  "use strict";

  var registry = {};

  var BRAND_COLORS = ["#1B4F9C", "#17B8A6", "#E08E45", "#2F6FED", "#C0392B", "#1E8A5F", "#8E44AD", "#D35400"];

  function destroy(canvasId) {
    if (registry[canvasId]) { registry[canvasId].destroy(); delete registry[canvasId]; }
  }

  function barChart(canvasId, labels, values, opts) {
    opts = opts || {};
    destroy(canvasId);
    var el = document.getElementById(canvasId);
    if (!el || !window.Chart) return null;
    var chart = new window.Chart(el, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: opts.label || "Value",
          data: values,
          backgroundColor: opts.colors || labels.map(function (_, i) { return BRAND_COLORS[i % BRAND_COLORS.length]; }),
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: opts.horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true }
        },
        scales: {
          y: { beginAtZero: true },
          x: { beginAtZero: true }
        },
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
    var chart = new window.Chart(el, {
      type: "bar",
      data: {
        labels: labels,
        datasets: series.map(function (s, i) {
          return { label: s.name, data: s.values, backgroundColor: s.color || BRAND_COLORS[i % BRAND_COLORS.length], borderRadius: 4 };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: "bottom" } },
        scales: { y: { beginAtZero: true } }
      }
    });
    registry[canvasId] = chart;
    return chart;
  }

  function doughnutChart(canvasId, labels, values, opts) {
    opts = opts || {};
    destroy(canvasId);
    var el = document.getElementById(canvasId);
    if (!el || !window.Chart) return null;
    var chart = new window.Chart(el, {
      type: "doughnut",
      data: { labels: labels, datasets: [{ data: values, backgroundColor: labels.map(function (_, i) { return BRAND_COLORS[i % BRAND_COLORS.length]; }) }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
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
    if (!max) return "#241A33";
    return (value / max) > 0.55 ? "#ffffff" : "#241A33";
  }

  function renderWordCloud(canvasId, wordFreqArray, opts) {
    opts = opts || {};
    var el = document.getElementById(canvasId);
    if (!el || !window.WordCloud) return;
    if (!wordFreqArray.length) {
      var ctx = el.getContext("2d");
      ctx.clearRect(0, 0, el.width, el.height);
      return;
    }
    var list = wordFreqArray.slice(0, opts.limit || 60).map(function (w) { return [w.word, w.count]; });
    window.WordCloud(el, {
      list: list,
      gridSize: Math.round(8 * el.width / 1024),
      weightFactor: function (size) {
        var max = list[0][1];
        return 12 + (size / max) * 46;
      },
      fontFamily: "Poppins, Inter, sans-serif",
      color: function () { return BRAND_COLORS[Math.floor(Math.random() * BRAND_COLORS.length)]; },
      backgroundColor: "#ffffff",
      rotateRatio: 0.15
    });
  }

  window.TB = window.TB || {};
  window.TB.charts = {
    barChart: barChart, groupedBarChart: groupedBarChart, doughnutChart: doughnutChart,
    heatColor: heatColor, heatTextColor: heatTextColor, renderWordCloud: renderWordCloud,
    destroy: destroy, BRAND_COLORS: BRAND_COLORS
  };
})();
