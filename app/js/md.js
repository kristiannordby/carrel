/* Small markdown renderer for Claude's replies: headings, lists, code, tables, quotes, emphasis. Math is left for KaTeX. */
(function () {
  'use strict';
  const C = window.C;

  function protectMath(src) {
    const store = [];
    // "\$" is kept as written, a literal dollar for C.renderMath, and never opens or closes math
    const out = src.replace(new RegExp(String.raw`\\\$|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|` + C.MATH1 + String.raw`|\\\([\s\S]+?\\\)`, 'g'), (m) => { store.push(m); return '\u0000' + (store.length - 1) + '\u0000'; });
    return { out, restore: (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => C.esc(store[+i])) };
  }

  function inline(s) {
    let h = C.esc(s);
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
    h = h.replace(/(^|\s)_([^_\s][^_]*?)_(?=\s|$|[.,;:])/g, '$1<em>$2</em>');
    h = h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return h;
  }

  C.md = function (src) {
    const pm = protectMath(String(src || ''));
    const lines = pm.out.replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      let l = lines[i];
      if (/^```/.test(l)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push('<pre><code>' + C.esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      const hm = l.match(/^(#{1,4})\s+(.*)/);
      if (hm) { const n = Math.min(4, hm[1].length + 2); out.push('<h' + n + '>' + inline(hm[2]) + '</h' + n + '>'); i++; continue; }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
        const ordered = /^\s*\d+[.)]/.test(l);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          let item = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
          items.push('<li>' + inline(item) + '</li>');
        }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
        continue;
      }
      if (/^>\s?/.test(l)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
        continue;
      }
      if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const row = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = row(l);
        i += 2;
        const body = [];
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
        out.push('<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + body.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }
      if (!l.trim()) { i++; continue; }
      const buf = [l];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+[.)])\s+|\|)/.test(lines[i])) buf.push(lines[i++]);
      out.push('<p>' + inline(buf.join('\n')).replace(/\n/g, '<br>') + '</p>');
    }
    return pm.restore(out.join(''));
  };
})();
