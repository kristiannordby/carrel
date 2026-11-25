/* Claude: one streaming call that works through the local server (Claude Code CLI, no key needed)
   or straight from the browser with an API key kept in this browser only. Plus the study context builder. */
(function () {
  'use strict';
  const C = window.C;

  const SYSTEM = [
    "You are a tutor inside Carrel, a student's study app for MIT Sloan's Master of Business Analytics.",
    'Courses: 15.C57 Optimization Methods, 15.095 Machine Learning under a Modern Optimization Lens (ML Ops), 15.072 Advanced Analytics Edge, 15.572 Analytics Lab, 15.681 From Analytics to Action, 15.776 Hands-On Deep Learning (HODL, half-semester from Nov 2: LLMs, agents, PyTorch, transformers).',
    'Ground every answer in the lecture material supplied in the context block; when you go beyond it, say so.',
    'Be direct and technical. No preamble, no compliments, no summary of what you are about to do.',
    'Use Markdown sparingly (short paragraphs, a list when it helps). Write math in LaTeX between $...$ or $$...$$.',
    'When asked about a quiz question, explain why the right answer is right and why each tempting wrong answer fails.',
  ].join('\n');

  class NoBackend extends Error {}

  async function* sse(reader) {
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (data) yield data;
      }
    }
  }

  async function viaServer(body, onText, signal) {
    const s = C.settings();
    const r = await fetch('/api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ model: s.model }, body)), signal });
    if (!r.ok || !r.body) throw new Error((await r.text()) || 'The local server did not answer.');
    let full = '';
    for await (const data of sse(r.body.getReader())) {
      const ev = JSON.parse(data);
      if (ev.error) throw new Error(ev.error);
      if (ev.t) { full += ev.t; onText(full, ev.t); }
    }
    return full;
  }

  async function viaApi(body, onText, signal) {
    const key = C.store.get('settings.secret', {}).apiKey;
    if (!key) throw new NoBackend('no key');
    const s = C.settings();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: s.apiModel, max_tokens: 2000, stream: true, system: body.system, messages: body.messages }),
    });
    if (!r.ok) { let msg = r.statusText; try { msg = (await r.json()).error.message; } catch (e) {} throw new Error('Anthropic API: ' + msg); }
    let full = '';
    for await (const data of sse(r.body.getReader())) {
      let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.text) { full += ev.delta.text; onText(full, ev.delta.text); }
      if (ev.type === 'error') throw new Error(ev.error && ev.error.message);
    }
    return full;
  }

  // what went wrong, in words, and what to do about it
  C.friendlyError = function (e) {
    const m = String((e && e.message) || e || '');
    if (/Failed to fetch|NetworkError|ERR_CONNECTION|load failed/i.test(m)) return 'Could not reach the local server. Check that the Start Carrel window is still open, then retry.';
    if (/not found on this machine|was not found/i.test(m)) return 'Claude Code is not installed or not on the PATH. Install it, or add an API key in Settings.';
    if (/signed out|OAuth|Failed to authenticate/i.test(m)) return 'Claude Code on your PC is signed out. On the PC, run "claude auth login" in a terminal and sign in, then retry.';
    if (/401|invalid x-api-key|authentication/i.test(m)) return 'The API key was rejected. Check it in Settings.';
    if (/overloaded|529|rate limit|429/i.test(m)) return 'Claude is busy right now. Wait a minute, then retry.';
    if (/not connected/i.test(m)) return m;
    return 'Claude could not answer (' + m.slice(0, 160) + '). Retry, or start a new chat.';
  };
  C.claude = {
    SYSTEM,
    NoBackend,
    available() {
      const s = C.settings();
      if (s.backend !== 'api' && C.server.ok && C.server.claude) return 'cli';
      if (C.store.get('settings.secret', {}).apiKey) return 'api';
      return null;
    },
    describe() {
      const b = C.claude.available();
      if (b === 'cli') return 'Claude Code on this machine';
      if (b === 'api') return 'Anthropic API key in this browser';
      return 'not connected';
    },
    async stream({ system, messages, onText, signal, thread }) {
      const body = { system: system || SYSTEM, messages, thread: thread || null };
      const b = C.claude.available();
      if (b === 'cli') return viaServer(body, onText || (() => {}), signal);
      if (b === 'api') return viaApi(body, onText || (() => {}), signal);
      throw new NoBackend('Claude is not connected. Start Carrel with "Start Carrel.cmd" so it can use Claude Code on this machine, or add an API key in Settings.');
    },
  };

  // ------------------------------------------------------------ context: what Claude should know about the thing in front of you
  // ctx = { course, unit, kind: 'quiz'|'card'|'written'|'topic'|'slide', item, selection, slide: [fileIdx, page] }
  C.describeItem = function (ctx) {
    const it = ctx.item;
    if (!it) return '';
    if (ctx.kind === 'quiz') {
      const L = 'ABCDEFG';
      const order = ctx.order || it.o.map((_, i) => i);
      return 'Quiz question: ' + it.q + '\n' + order.map((oi, pos) => L[pos] + ') ' + it.o[oi] + (oi === it.a ? '   [correct]' : '')).join('\n') +
        (ctx.picked != null ? '\n' + C.who() + ' picked: ' + L[order.indexOf(ctx.picked)] + ') ' + it.o[ctx.picked] + (ctx.picked === it.a ? ' (right)' : ' (wrong)') : '') +
        (it.e ? '\nDeck explanation: ' + it.e : '');
    }
    if (ctx.kind === 'card') return 'Flashcard front: ' + it.f + '\nBack: ' + it.b + (it.x ? '\nMore: ' + it.x : '');
    if (ctx.kind === 'written') return 'Written practice question: ' + it.q + (it.m ? '\nModel answer: ' + it.m : '') + (it.k && it.k.length ? '\nRubric points: ' + it.k.join('; ') : '');
    if (ctx.kind === 'topic') return 'Topic: ' + it.n + (it.x ? '\nSummary: ' + it.x : '');
    return '';
  };

  C.contextBlock = async function (ctx) {
    const parts = [];
    const course = ctx.course && C.data.course(ctx.course);
    const unit = ctx.course && ctx.unit && C.data.unit(ctx.course, ctx.unit);
    if (course) parts.push('Course: ' + course.code + ' ' + course.name);
    if (unit) parts.push('Lecture set: ' + unit.label + ' ' + unit.title + (unit.src ? ' (sources: ' + unit.src + ')' : ''));
    if (unit && ctx.item && ctx.item.t != null && unit.topics[ctx.item.t]) parts.push('Topic: ' + unit.topics[ctx.item.t].n);
    const d = C.describeItem(ctx);
    if (d) parts.push(d);
    if (unit && ctx.item && ctx.item.t != null && C.study && (ctx.kind === 'quiz' || ctx.kind === 'card' || ctx.kind === 'topic')) {
      const p = C.store.get('progress', {});
      const ti = ctx.kind === 'topic' ? unit.topics.indexOf(ctx.item) : ctx.item.t;
      const qs = unit.quiz.filter((q) => (unit.topics.length === 1 ? true : q.t === ti));
      const seen = qs.filter((q) => p[C.study.qkey(ctx.course, unit.id, q)]);
      if (seen.length) {
        const missed = seen.filter((q) => p[C.study.qkey(ctx.course, unit.id, q)].last === 0 && q !== ctx.item);
        const right = seen.filter((q) => p[C.study.qkey(ctx.course, unit.id, q)].last === 1).length;
        parts.push(C.who() + "'s record on this topic: " + right + ' of ' + seen.length + ' answered right on the last try.' +
          (missed.length ? ' Other questions on it they missed: ' + missed.slice(0, 3).map((q) => '"' + q.q.slice(0, 110) + '"').join('; ') + '.' : ''));
      }
    }
    const note = ctx.noteKey && C.store.get('notes', {})[ctx.noteKey];
    if (note) parts.push(C.who() + "'s own note on this item: " + note);
    if (ctx.vnote && C.notes) {
      const ex = C.notes.excerpt(ctx.vnote, ctx.selection);
      if (ex) parts.push('From ' + C.who() + "'s own study note \"" + ctx.vnote.split('/').pop().replace(/\.md$/, '') + '" (their words, may contain their mistakes):\n' + ex);
    } else if (unit && ctx.item && C.notes && /^(quiz|card|written|topic)$/.test(ctx.kind)) {
      // the section of the student's own note on this lecture that covers the item, when one clearly does
      const it = ctx.item;
      const s = await C.notes.sectionFor(ctx.course, unit, [it.q, it.f, it.n, ctx.selection].filter(Boolean).join(' ').replace(/\n/g, ' ') + '\n' + [it.e, it.b, it.x].filter(Boolean).join(' '));
      if (s) parts.push(C.who() + "'s own study note on this lecture (\"" + s.n.title + '", their words; if it disagrees with the slides, say so):\n' + s.text);
    }
    if (ctx.selection) parts.push('Highlighted text: "' + ctx.selection + '"');
    const sl = ctx.slide || (ctx.item && ctx.item.s);
    if (sl) {
      const text = await C.loadSlideText();
      const f = C.data.files()[sl[0]];
      const pages = text[sl[0]] || [];
      if (f && pages.length) {
        const from = Math.max(1, sl[1] - 1), to = Math.min(pages.length, sl[1] + 1);
        const chunk = [];
        for (let p = from; p <= to; p++) chunk.push('--- ' + f.f + ', page ' + p + (p === sl[1] ? ' (linked slide)' : '') + '\n' + (pages[p - 1] || '').slice(0, 1800));
        parts.push('Lecture slide text (extracted from the PDF, layout lost):\n' + chunk.join('\n'));
      }
    } else if (unit && unit.brief) parts.push('Lecture summary: ' + unit.brief);
    return parts.join('\n\n');
  };

  C.EXPLAIN_SPOILER = 'The student has not answered this question yet: explain the concept it tests without saying which option is correct or eliminating any option.';
  C.EXPLAIN_ASK = 'Explain this concept at a high level, for review before an exam: what it is, why it matters in this course, one small worked intuition or example, and the trap students fall into. Keep it under 220 words. Finish with one line that starts "Go deeper:" followed by two follow-up questions separated by " | ".';
})();
