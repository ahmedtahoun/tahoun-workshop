/* Tahoun AI Academy · three small learning games. No AI calls: everything runs in the browser.
   Put <div data-play="doctor|fact|next"></div> on a page, or call Play.mount(element, type). */
(function () {
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function calm() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /* ---------- 1. Prompt Doctor ---------- */
  var PARTS = [
    { k: 'Who', re: /\b(you'?re|you are|act as|acting as|play (a|an|the)|pretend|as (a|an|my) [a-z]+ (expert|coach|manager|assistant|writer|editor|consultant|teacher|advisor|adviser))\b/i,
      tip: 'Give the AI a role: “You’re a friendly customer service manager.”' },
    { k: 'Why', re: /\b(i'?m|i am|i run|i work|i have|i need|we are|we run|we have|our (client|clients|customer|customers|team|business|shop|studio|company)|my (client|clients|customer|customers|team|business|shop|studio|company|audience|boss)|because|so that|the situation|context|for (my|our|a) [a-z]+)\b/i,
      tip: 'Add the situation only you know: who it’s for, what happened, what you want to achieve.' },
    { k: 'What', re: /\b(write|draft|reply|respond|answer|summari[sz]e|list|create|make|translate|explain|sort|plan|give me|suggest|rewrite|turn|compare|find|analy[sz]e|design|prepare|check|review|edit|fix|improve)\b/i,
      tip: 'Start the task with one clear verb: write, sort, summarise, compare…' },
    { k: 'How', re: /(\b\d+\s*(words?|sentences?|bullets?|points?|lines?|ideas?|options?|paragraphs?|items?)\b|\b(under|max(imum)?|short|shorter|brief|table|bullet|tone|friendly|formal|warm|direct|casual|polite|format|step by step|one line|in (english|arabic|german|french|russian|italian|spanish))\b)/i,
      tip: 'Say what good looks like: length, structure and tone. “Under 80 words, warm, end with a question.”' },
    { k: 'Don’t', re: /(\b(don'?t|do not|avoid|never|without|no more than)\b|\bno [a-z“"']+|if (something|anything)('s| is) (missing|unclear)|ask me (first|before))/i,
      tip: 'Add a limit and what to do when unsure: “No jargon. If something is missing, ask me first.”' }
  ];
  var DOC_EX = {
    weak: 'Write a post about my yoga studio.',
    strong: 'You’re a friendly social media manager. I run a small yoga studio in Dahab and want more remote workers to try our sunrise class. Write an Instagram post. Under 80 words, warm, end with a question. No hashtags, no clichés. If something is missing, ask me first.'
  };
  function doctor(root) {
    root.classList.add('pl-box');
    root.appendChild(el('p', 'pl-k', 'Prompt Doctor'));
    root.appendChild(el('h3', 'pl-h', 'Paste a prompt. Get an instant check-up.'));
    var ta = el('textarea', 'pl-ta'); ta.rows = 4; ta.placeholder = 'Paste or type a prompt you’d send to ChatGPT, Claude or Gemini…'; ta.setAttribute('aria-label', 'Your prompt');
    root.appendChild(ta);
    var ex = el('div', 'pl-row');
    var b1 = el('button', 'pl-chip', 'Try a weak one'); b1.type = 'button';
    var b2 = el('button', 'pl-chip', 'Try a strong one'); b2.type = 'button';
    ex.appendChild(b1); ex.appendChild(b2); root.appendChild(ex);
    var out = el('div', 'pl-out'); out.setAttribute('aria-live', 'polite'); root.appendChild(out);
    root.appendChild(el('p', 'pl-note', 'A quick check that looks for the five parts of a good brief. It runs on this page; nothing is sent anywhere.'));
    function run() {
      var t = ta.value.trim().replace(/[’‘]/g, "'"); out.textContent = '';
      if (!t) return;
      var words = t.split(/\s+/).length, score = 0, res = PARTS.map(function (p) { var ok = p.re.test(t); if (ok) score++; return ok; });
      var meter = el('div', 'pl-meter'); var fill = el('i'); meter.appendChild(fill); out.appendChild(meter);
      setTimeout(function () { fill.style.width = (score / 5 * 100) + '%'; fill.className = score >= 4 ? 'good' : score >= 2 ? 'mid' : 'low'; }, 30);
      var v = score === 5 ? 'Excellent brief. The AI has almost nothing to guess.' : score >= 4 ? 'Strong brief. One small addition makes it great.' : score >= 2 ? 'Getting there. Add the missing parts and the answer changes a lot.' : 'This is a question, not a brief. The AI will have to guess.';
      var hd = el('p', 'pl-verdict'); hd.appendChild(el('b', null, score + '/5 · ')); hd.appendChild(document.createTextNode(v)); out.appendChild(hd);
      var chips = el('div', 'pl-parts');
      PARTS.forEach(function (p, i) { chips.appendChild(el('span', res[i] ? 'ok' : 'no', (res[i] ? '✓ ' : '✗ ') + p.k)); });
      out.appendChild(chips);
      var tips = el('ul', 'pl-tips');
      PARTS.forEach(function (p, i) { if (!res[i]) { var li = el('li'); li.appendChild(el('b', null, p.k + ': ')); li.appendChild(document.createTextNode(p.tip)); tips.appendChild(li); } });
      if (words < 8) { var li2 = el('li'); li2.appendChild(el('b', null, 'Length: ')); li2.appendChild(document.createTextNode('Under 8 words. Good briefs are usually 3 to 5 short lines.')); tips.appendChild(li2); }
      if (tips.children.length) out.appendChild(tips);
    }
    var timer; ta.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 250); });
    b1.onclick = function () { ta.value = DOC_EX.weak; run(); };
    b2.onclick = function () { ta.value = DOC_EX.strong; run(); };
  }

  /* ---------- 2. Spot the made-up fact ---------- */
  var FACTS = [
    { ask: 'Tell me about Dahab.', s: ['Dahab is a small town on the Gulf of Aqaba, in Egypt’s South Sinai.', 'It’s known for diving, especially at the Blue Hole.', 'Dahab was named a UNESCO World Heritage Site in 2015.', 'Many remote workers and freelancers stay there for months.'], bad: 2,
      why: 'Dahab has no UNESCO listing. An official-sounding award with a date is a classic invented fact.' },
    { ask: 'Give me a short history of the Eiffel Tower.', s: ['The Eiffel Tower stands in Paris.', 'It was built for the 1889 World’s Fair.', 'It was designed and built by Gustave Eiffel’s company.', 'It was moved to its current spot in 1925 to make room for a metro line.'], bad: 3,
      why: 'It has never been moved. A precise year and a believable reason make a story feel true.' },
    { ask: 'What is ChatGPT?', s: ['ChatGPT is an AI chatbot made by OpenAI.', 'It was released to the public in November 2022.', 'It can write, summarise and translate text.', 'It always checks the web before it answers.'], bad: 3,
      why: 'Without search turned on, it answers from memory. That’s why you turn on search for anything current.' },
    { ask: 'How much time can AI save a small business?', s: ['Many small businesses use AI to draft emails and social posts.', 'AI tools can summarise long documents in seconds.', 'A 2021 Harvard study found that people who use AI save exactly 11.4 hours a week.', 'Results depend on how clearly you brief the AI.'], bad: 2,
      why: 'A famous name plus an exact number is the most common fake. Ask for the source and open it.' },
    { ask: 'Tell me about the Red Sea.', s: ['The Red Sea lies between Africa and the Arabian Peninsula.', 'It’s one of the saltiest seas connected to the ocean.', 'Its coral reefs are home to many fish found nowhere else.', 'It gets its name from red sand that blows in from the Sahara every spring.'], bad: 3,
      why: 'Nobody knows for sure where the name comes from; there are several theories. AI likes one neat explanation.' }
  ];
  function fact(root) {
    root.classList.add('pl-box');
    var i = 0, score = 0;
    function draw() {
      root.textContent = '';
      root.appendChild(el('p', 'pl-k', 'Spot the made-up fact'));
      if (i >= FACTS.length) {
        root.appendChild(el('p', 'pl-big', score + '/' + FACTS.length));
        root.appendChild(el('h3', 'pl-h', score === FACTS.length ? 'Sharp eye! Nothing gets past you.' : score >= 3 ? 'Good instincts.' : 'Tricky, right? That’s the point.'));
        root.appendChild(el('p', 'pl-p', 'AI sounds just as sure when it’s wrong. The fakes hide in awards, exact numbers, famous names and neat explanations. Check those before anything goes out under your name.'));
        var again = el('button', 'pl-btn', 'Play again'); again.type = 'button'; again.onclick = function () { i = 0; score = 0; draw(); }; root.appendChild(again);
        return;
      }
      var F = FACTS[i];
      var dots = el('div', 'pl-dots'); for (var d = 0; d < FACTS.length; d++) dots.appendChild(el('i', d < i ? 'done' : d === i ? 'now' : '')); root.appendChild(dots);
      root.appendChild(el('h3', 'pl-h', 'One sentence is invented. Tap it.'));
      var you = el('div', 'pl-bub you'); you.appendChild(el('span', 'pl-who', 'You asked')); you.appendChild(document.createTextNode(F.ask)); root.appendChild(you);
      var ai = el('div', 'pl-bub ai'); ai.appendChild(el('span', 'pl-who', 'AI answered'));
      var picked = false;
      F.s.forEach(function (s, j) {
        var b = el('button', 'pl-sent', s); b.type = 'button';
        b.onclick = function () {
          if (picked) return; picked = true;
          var right = j === F.bad; if (right) score++;
          [].forEach.call(ai.querySelectorAll('.pl-sent'), function (x, n) { x.disabled = true; if (n === F.bad) x.classList.add('fake'); else if (n === j) x.classList.add('miss'); });
          var r = el('div', 'pl-res ' + (right ? 'good' : 'bad'));
          r.appendChild(el('b', null, right ? '✓ Caught it! ' : '✗ That one is true. '));
          r.appendChild(document.createTextNode(F.why)); root.appendChild(r);
          var nx = el('button', 'pl-btn', i + 1 < FACTS.length ? 'Next round' : 'See my score'); nx.type = 'button';
          nx.onclick = function () { i++; draw(); }; root.appendChild(nx);
        };
        ai.appendChild(b);
      });
      root.appendChild(ai);
    }
    draw();
  }

  /* ---------- 3. Guess the next word ---------- */
  var NEXT = [
    { s: 'Thank you for your email. I will get back to you…', o: [['soon', 46], ['shortly', 24], ['tomorrow', 15], ['as', 10]],
      note: 'Polite emails all over the internet end this way, so “soon” is the most likely word.' },
    { s: 'Once upon a…', o: [['time', 97], ['hill', 1], ['night', 1], ['dream', 1]],
      note: 'Almost certain. When one word dominates, the AI sounds sure, whether or not it’s right.' },
    { s: 'The best time to dive in Dahab is early in the…', o: [['morning', 70], ['day', 13], ['season', 9], ['week', 8]],
      note: 'It isn’t checking the weather. It’s picking the word that usually follows in text it has seen.' },
    { s: 'My favourite drink at the café is…', o: [['coffee', 34], ['tea', 23], ['a', 21], ['mint', 12]],
      note: 'Many good options are close. That’s why you get a different answer each time you ask.' },
    { s: 'The capital of Egypt is…', o: [['Cairo', 96], ['the', 2], ['located', 1], ['not', 1]],
      note: 'Right, but only because “Cairo” is so common after these words. For anything that changes, turn on search.' }
  ];
  function next(root) {
    root.classList.add('pl-box');
    var i = 0, hits = 0;
    function draw() {
      root.textContent = '';
      root.appendChild(el('p', 'pl-k', 'Guess the next word'));
      if (i >= NEXT.length) {
        root.appendChild(el('p', 'pl-big', hits + '/' + NEXT.length));
        root.appendChild(el('h3', 'pl-h', 'You think like a language model.'));
        root.appendChild(el('p', 'pl-p', 'That’s all an AI chat does: guess the most likely next word, again and again, very fast. A good brief changes what “likely” means, so the words it picks fit your situation.'));
        var again = el('button', 'pl-btn', 'Play again'); again.type = 'button'; again.onclick = function () { i = 0; hits = 0; draw(); }; root.appendChild(again);
        return;
      }
      var R = NEXT[i];
      var dots = el('div', 'pl-dots'); for (var d = 0; d < NEXT.length; d++) dots.appendChild(el('i', d < i ? 'done' : d === i ? 'now' : '')); root.appendChild(dots);
      root.appendChild(el('h3', 'pl-h', 'Which word would an AI write next?'));
      var sent = el('p', 'pl-sentence'); sent.appendChild(document.createTextNode(R.s + ' ')); var gap = el('span', 'pl-gap', '____'); sent.appendChild(gap); root.appendChild(sent);
      var opts = el('div', 'pl-nw');
      var order = R.o.map(function (x, n) { return n; }).sort(function () { return Math.random() - .5; });
      var done = false;
      order.forEach(function (n) {
        var w = R.o[n], b = el('button', 'pl-word'); b.type = 'button';
        var bar = el('i', 'pl-bar'); b.appendChild(bar); b.appendChild(el('span', 'pl-w', w[0])); var pct = el('span', 'pl-pct', ''); b.appendChild(pct);
        b.onclick = function () {
          if (done) return; done = true;
          var top = n === 0; if (top) hits++;
          gap.textContent = R.o[0][0]; gap.classList.add('on');
          [].forEach.call(opts.children, function (x) { x.disabled = true; });
          order.forEach(function (m, k) {
            var bt = opts.children[k], p = R.o[m][1];
            bt.querySelector('.pl-pct').textContent = p + '%';
            if (m === 0) bt.classList.add('top'); if (m === n && m !== 0) bt.classList.add('mine');
            setTimeout(function () { bt.querySelector('.pl-bar').style.width = p + '%'; }, calm() ? 0 : 60 + k * 90);
          });
          var r = el('div', 'pl-res ' + (top ? 'good' : 'mid'));
          r.appendChild(el('b', null, top ? '✓ Same as the AI. ' : 'The AI would most likely pick “' + R.o[0][0] + '”. '));
          r.appendChild(document.createTextNode(R.note)); root.appendChild(r);
          var nx = el('button', 'pl-btn', i + 1 < NEXT.length ? 'Next sentence' : 'See my score'); nx.type = 'button';
          nx.onclick = function () { i++; draw(); }; root.appendChild(nx);
        };
        opts.appendChild(b);
      });
      root.appendChild(opts);
      root.appendChild(el('p', 'pl-note', 'Percentages are an illustration of how a model ranks words, not exact numbers from one model.'));
    }
    draw();
  }

  var GAMES = { doctor: doctor, fact: fact, next: next };
  window.Play = {
    mount: function (node, type) { if (!node || !GAMES[type] || node.dataset.mounted) return; node.dataset.mounted = '1'; GAMES[type](node); }
  };
  function auto() { [].forEach.call(document.querySelectorAll('[data-play]'), function (n) { window.Play.mount(n, n.getAttribute('data-play')); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
