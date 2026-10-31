// Local review overlay only. Never imported by apps/web or copied into dist.
(() => {
  const box = document.createElement("aside");
  box.id = "domino-local-qa";
  box.setAttribute("aria-label", "Local QA tools, not repository data");
  box.style.cssText =
    "position:fixed;z-index:2147483647;right:12px;top:12px;background:#fff;color:#111;border:2px solid #111;border-radius:8px;padding:12px;font:12px system-ui;max-width:290px;box-shadow:0 8px 24px #0003";
  box.innerHTML =
    '<strong>LOCAL QA · NOT PRODUCT DATA</strong><div style="display:flex;gap:6px;margin-top:8px"><button type="button">Audit accessibility</button><button type="button">Measure 5s</button><button type="button" aria-label="Hide local QA tools">×</button></div><output style="display:block;margin-top:8px" aria-live="polite">Ready</output>';
  document.body.append(box);
  const [audit, profile, hide] = box.querySelectorAll("button"),
    output = box.querySelector("output");
  for (const button of [audit, profile, hide])
    button.style.cssText =
      "font:12px system-ui;color:#111;background:#eee;border:1px solid #777;padding:6px;cursor:pointer";
  const send = async (data) => {
    const r = await fetch("/__qa/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error("Could not save review result");
    return r.json();
  };
  audit.onclick = async () => {
    audit.disabled = true;
    output.textContent = "Auditing actual page…";
    try {
      const result = await window.axe.run(
        { exclude: [["#domino-local-qa"]] },
        { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } },
      );
      const data = {
        type: "accessibility",
        url: location.href,
        viewport: { width: innerWidth, height: innerHeight },
        userAgent: navigator.userAgent,
        at: new Date().toISOString(),
        violations: result.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            html: n.html,
            failureSummary: n.failureSummary,
          })),
        })),
        incomplete: result.incomplete.map((v) => ({
          id: v.id,
          help: v.help,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            failureSummary: n.failureSummary,
          })),
        })),
        passes: result.passes.length,
      };
      const saved = await send(data);
      output.textContent = `${data.violations.length} violations; ${data.incomplete.length} manual checks. Saved ${saved.saved}`;
    } catch (error) {
      output.textContent = "Audit failed: " + error.message;
    } finally {
      audit.disabled = false;
    }
  };
  profile.onclick = () => {
    profile.disabled = true;
    output.textContent = "Measuring 5s—perform the interaction now";
    const start = performance.now(),
      initialUrl = location.href,
      intervals = [],
      longTasks = [],
      longFrames = [],
      visibility = [document.visibilityState];
    let last = start,
      raf;
    const changed = () => visibility.push(document.visibilityState);
    document.addEventListener("visibilitychange", changed);
    let observer, frameObserver;
    try {
      observer = new PerformanceObserver((list) =>
        longTasks.push(
          ...list
            .getEntries()
            .map((e) => ({ start: e.startTime, duration: e.duration })),
        ),
      );
      observer.observe({ type: "longtask", buffered: false });
    } catch {}
    try {
      frameObserver = new PerformanceObserver((list) =>
        longFrames.push(...list.getEntries().map((entry) => entry.toJSON())),
      );
      frameObserver.observe({ type: "long-animation-frame", buffered: false });
    } catch {}
    const frame = (now) => {
      intervals.push(now - last);
      last = now;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    setTimeout(async () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      frameObserver?.disconnect();
      document.removeEventListener("visibilitychange", changed);
      const sorted = [...intervals].sort((a, b) => a - b);
      const percentile = (p) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ??
        null;
      const data = {
        type: "profile",
        initialUrl,
        url: location.href,
        at: new Date().toISOString(),
        viewport: { width: innerWidth, height: innerHeight },
        userAgent: navigator.userAgent,
        durationMs: performance.now() - start,
        visibility,
        samples: intervals.length,
        medianMs: percentile(0.5),
        p95Ms: percentile(0.95),
        maxMs: sorted.at(-1),
        longTasks,
        longFrames,
        graphStages: performance
          .getEntriesByType("measure")
          .filter(
            (entry) =>
              entry.name.startsWith("domino.graph.") &&
              entry.startTime >= start,
          )
          .map((entry) => entry.toJSON()),
        longTaskTotalMs: longTasks.reduce((sum, t) => sum + t.duration, 0),
      };
      try {
        const saved = await send(data);
        output.textContent = `p95 ${data.p95Ms?.toFixed(1)}ms; max ${data.maxMs?.toFixed(1)}ms; ${longTasks.length} long tasks. Saved ${saved.saved}`;
      } catch (error) {
        output.textContent = error.message;
      } finally {
        profile.disabled = false;
      }
    }, 5000);
  };
  hide.onclick = () => box.remove();
})();
