/* Show do Cristão - app.js
   Controles:
   1/2/3/4 -> selecionar A/B/C/D
   Enter -> confirmar (quando houver foco) / avançar
   P -> Pular | E -> Eliminar duas | H -> Pedir ajuda
   Esc -> voltar ao início (com confirmação se estiver em jogo)
*/
(function(){
  const PRIZES = [2, 5, 10, 20, 50, 100];
  const STORAGE_KEY = "show_do_cristao_settings_v1";

  function $(sel){ return document.querySelector(sel); }
  function escapeHtml(s){
    return (s ?? "").toString()
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }
  function shuffle(arr){
    const a = arr.slice();
    for (let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  function loadSettings(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return { kidsMode: false, showExplanation: true };
      const parsed = JSON.parse(raw);
      return {
        kidsMode: !!parsed.kidsMode,
        showExplanation: parsed.showExplanation !== false
      };
    }catch{
      return { kidsMode: false, showExplanation: true };
    }
  }
  function saveSettings(s){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  const state = {
    screen: "home", // home | settings | game | result
    settings: loadSettings(),
    round: null,
    focusIndex: 0,
    toast: null,
    lock: false, // prevents double submit during animations
  };

  function buildRound(){
    // Select 6 questions: 1 per prize level, difficulty buckets:
    // Level 0 -> easy, 1-2 -> medium, 3 -> hard, 4-5 -> veryhard
    const bank = window.QUESTION_BANK;
    const pick = (arr)=> shuffle(arr)[0];

    const easyPool = bank.easy;
    const medPool = bank.medium;
    const hardPool = bank.hard;
    const vhPool = bank.veryhard;

    // Kids mode: use easier distribution
    const levels = state.settings.kidsMode
      ? [pick(easyPool), pick(easyPool), pick(medPool), pick(medPool), pick(hardPool), pick(hardPool)]
      : [pick(easyPool), pick(medPool), pick(medPool), pick(hardPool), pick(vhPool), pick(vhPool)];

    // Ensure unique questions (best effort)
    const unique = [];
    const used = new Set();
    for (const q of levels){
      const key = q.q + "||" + q.a.join("|");
      if(!used.has(key)){ unique.push(q); used.add(key); }
      else{
        // fallback: find another from same bucket
        const bucket = easyPool.includes(q) ? easyPool : medPool.includes(q) ? medPool : hardPool.includes(q) ? hardPool : vhPool;
        const alt = shuffle(bucket).find(x=>{
          const k = x.q + "||" + x.a.join("|");
          return !used.has(k);
        }) || q;
        const k2 = alt.q + "||" + alt.a.join("|");
        unique.push(alt); used.add(k2);
      }
    }

    // For each question, we will optionally shuffle alternatives while tracking correct index
    const prepared = unique.map((qObj)=>{
      const indices = [0,1,2,3];
      const shuffledIdx = shuffle(indices);
      const answers = shuffledIdx.map(i=> qObj.a[i]);
      const correct = shuffledIdx.indexOf(qObj.c);
      return {
        q: qObj.q,
        a: answers,
        c: correct,
        tip: qObj.tip || "",
      };
    });

    return {
      prizeIndex: 0,
      questions: prepared,
      helps: { skip: false, eliminate: false, help: false },
      eliminated: new Set(), // indices hidden (incorrect only)
      selected: null, // selected index
      correctCount: 0,
      finished: false,
      won: 0, // last prize achieved
      lastResult: null, // { ok: boolean, correctIndex: number }
    };
  }

  function setToast(title, detail){
    state.toast = { title, detail };
    render();
    // auto hide after 3.3s
    window.clearTimeout(setToast._t);
    setToast._t = window.setTimeout(()=>{
      state.toast = null;
      render();
    }, 3300);
  }

  function render(){
    const app = $("#app");
    app.innerHTML = templates.shell();
    bindCommon();
    if(state.screen === "home") bindHome();
    if(state.screen === "settings") bindSettings();
    if(state.screen === "game") bindGame();
    if(state.screen === "result") bindResult();
  }

  const templates = {
    shell(){
      return `
        <div class="shell">
          ${templates.header()}
          <div class="content">
            ${state.screen === "home" ? templates.home()
            : state.screen === "settings" ? templates.settings()
            : state.screen === "game" ? templates.game()
            : templates.result()}
          </div>
          ${state.toast ? templates.toast(state.toast) : ""}
        </div>
      `;
    },
    header(){
      const right = state.screen === "game" && state.round
        ? `<div class="pill"><span>Valendo:</span> <strong>R$ ${PRIZES[state.round.prizeIndex]}</strong></div>`
        : state.screen === "result" && state.round
        ? `<div class="pill"><span>Você conquistou:</span> <strong>R$ ${state.round.won}</strong></div>`
        : `<div class="pill"><span>Dicas:</span> <strong>F11</strong> tela cheia</div>`;

      return `
        <div class="header">
          <div class="brand">
            <h1>Show do Cristão</h1>
            <div class="sub">Quiz sobre Jesus • Natal em família</div>
          </div>
          ${right}
        </div>
      `;
    },
    home(){
      return `
        <div class="center">
          <h2 class="title-big">Brincadeira de Natal</h2>
          <p class="lead">
            Responda perguntas sobre Jesus. A cada acerto, avance na premiação:
            <strong style="color:var(--text)">R$ 2</strong>,
            <strong style="color:var(--text)">R$ 5</strong>,
            <strong style="color:var(--text)">R$ 10</strong>,
            <strong style="color:var(--text)">R$ 20</strong>,
            <strong style="color:var(--text)">R$ 50</strong>,
            <strong style="color:var(--text)">R$ 100</strong>.
          </p>

          <div class="row" style="margin-top:10px">
            <button class="btn primary" id="btnStart">Começar</button>
            <button class="btn" id="btnSettings">Configurações</button>
          </div>

          <div class="card" style="padding:14px 16px; margin-top: 10px">
            <div class="kbd">
              Controles: <code>1</code><code>2</code><code>3</code><code>4</code> alternativas •
              <code>P</code> pular • <code>E</code> eliminar duas • <code>H</code> ajuda •
              <code>Esc</code> início
            </div>
            <p class="smallnote">Sugestão: aperte <strong>F11</strong> para tela cheia antes de começar.</p>
          </div>
        </div>
      `;
    },
    settings(){
      const s = state.settings;
      return `
        <div class="center">
          <h2 class="title-big">Configurações</h2>
          <p class="lead">Ajustes rápidos para deixar o jogo do jeito ideal para sua família.</p>

          <div class="switch">
            <div class="label">
              <strong>Modo crianças</strong>
              <span>Perguntas mais fáceis na rodada.</span>
            </div>
            <div class="toggle ${s.kidsMode ? "on":""}" id="toggleKids" role="switch" aria-checked="${s.kidsMode}"></div>
          </div>

          <div class="switch">
            <div class="label">
              <strong>Mostrar explicação bíblica</strong>
              <span>Após responder, mostrar uma dica/explicação curta.</span>
            </div>
            <div class="toggle ${s.showExplanation ? "on":""}" id="toggleExplain" role="switch" aria-checked="${s.showExplanation}"></div>
          </div>

          <div class="row" style="margin-top: 10px">
            <button class="btn primary" id="btnSaveSettings">Salvar</button>
            <button class="btn" id="btnBackHome">Voltar</button>
          </div>

          <p class="smallnote">Dica: você pode ajustar isso antes de cada rodada.</p>
        </div>
      `;
    },
    game(){
      const r = state.round;
      const idx = r.prizeIndex;
      const q = r.questions[idx];

      const progress = idx; // correct answers so far in this round
      const subtitle = `Pergunta ${idx+1} de ${PRIZES.length} • Acertos: ${r.correctCount}`;

      const letters = ["A","B","C","D"];

      const answersHtml = q.a.map((txt, i)=>{
        const isElim = r.eliminated.has(i);
        const classes = [
          "answer",
          isElim ? "hidden" : "",
          i === state.focusIndex ? "focused" : "",
        ].join(" ").trim();

        return `
          <div class="${classes}" data-idx="${i}" tabindex="0" role="button" aria-label="Alternativa ${letters[i]}">
            <div class="letter">${letters[i]}</div>
            <div class="txt">${escapeHtml(txt)}</div>
          </div>
        `;
      }).join("");

      const helpBtns = `
        <button class="btn small ${r.helps.skip ? "" : "primary"}" id="helpSkip" ${r.helps.skip ? "disabled":""}>Pular (P)</button>
        <button class="btn small ${r.helps.eliminate ? "" : "primary"}" id="helpElim" ${r.helps.eliminate ? "disabled":""}>Eliminar duas (E)</button>
        <button class="btn small ${r.helps.help ? "" : "primary"}" id="helpHelp" ${r.helps.help ? "disabled":""}>Pedir ajuda (H)</button>
      `;

      return `
        <div class="row" style="justify-content:space-between">
          <div class="pill"><span>${escapeHtml(subtitle)}</span></div>
          <div class="pill"><span>Progresso:</span> <strong>${progress}/6</strong></div>
        </div>

        <div class="card question">
          <h2>${escapeHtml(q.q)}</h2>
          <p>Escolha a alternativa correta.</p>
        </div>

        <div class="answers">
          ${answersHtml}
        </div>

        <div class="footer">
          <div class="helpbar">${helpBtns}</div>
          <div class="kbd">
            Teclado: <code>1</code><code>2</code><code>3</code><code>4</code> • <code>Enter</code> confirmar • <code>Esc</code> início
          </div>
        </div>
      `;
    },
    result(){
      const r = state.round;
      const ok = r?.lastResult?.ok;
      const title = ok ? "Parabéns!" : "Que pena!";
      const msg = ok
        ? `Você concluiu todas as perguntas e chegou ao topo!`
        : `Você errou e o jogo terminou.`;

      const summary = r ? `
        <div class="card" style="padding:16px 18px">
          <div class="row" style="justify-content:space-between">
            <div class="pill"><span>Acertos:</span> <strong>${r.correctCount}</strong></div>
            <div class="pill"><span>Premiação:</span> <strong>R$ ${r.won}</strong></div>
          </div>
          <p class="smallnote" style="margin-top:10px">
            Dica: você pode jogar novamente para cair perguntas diferentes (as alternativas embaralham).
          </p>
        </div>
      ` : "";

      return `
        <div class="center">
          <h2 class="title-big">${title}</h2>
          <p class="lead">${escapeHtml(msg)}</p>
          ${summary}
          <div class="row" style="margin-top: 10px">
            <button class="btn primary" id="btnRestart">Jogar novamente</button>
            <button class="btn" id="btnGoHome">Voltar ao início</button>
          </div>
          <div class="card" style="padding:14px 16px; margin-top: 10px">
            <div class="kbd">
              Atalhos: <code>Enter</code> jogar novamente • <code>Esc</code> início
            </div>
          </div>
        </div>
      `;
    },
    toast(t){
      return `
        <div class="toast" role="status" aria-live="polite">
          <div class="badge">i</div>
          <div>
            <p class="msg">${escapeHtml(t.title)}</p>
            ${t.detail ? `<div class="muted">${escapeHtml(t.detail)}</div>` : ""}
          </div>
        </div>
      `;
    }
  };

  function bindCommon(){
    document.onkeydown = (e)=>{
      if(e.key === "F11") return; // let browser handle
      if(state.screen === "home"){
        if(e.key === "Enter") $("#btnStart")?.click();
        if(e.key === "Escape") return;
      }
      if(state.screen === "settings"){
        if(e.key === "Escape") $("#btnBackHome")?.click();
      }
      if(state.screen === "result"){
        if(e.key === "Enter") $("#btnRestart")?.click();
        if(e.key === "Escape") $("#btnGoHome")?.click();
      }
      if(state.screen === "game"){
        if(e.key === "Escape"){
          e.preventDefault();
          confirmGoHome();
          return;
        }
        const key = e.key.toLowerCase();
        if(key === "p") { $("#helpSkip")?.click(); return; }
        if(key === "e") { $("#helpElim")?.click(); return; }
        if(key === "h") { $("#helpHelp")?.click(); return; }

        if(["1","2","3","4"].includes(e.key)){
          const idx = Number(e.key) - 1;
          // allow choose even if eliminated? we ignore if hidden
          if(state.round && !state.round.eliminated.has(idx)){
            state.focusIndex = idx;
            choose(idx);
          }
          return;
        }
        if(e.key === "ArrowRight" || e.key === "ArrowDown"){
          moveFocus(1);
          return;
        }
        if(e.key === "ArrowLeft" || e.key === "ArrowUp"){
          moveFocus(-1);
          return;
        }
        if(e.key === "Enter"){
          // confirm focused selection
          if(state.round && !state.round.eliminated.has(state.focusIndex)){
            choose(state.focusIndex);
          }
        }
      }
    };
  }

  function bindHome(){
    $("#btnStart").onclick = ()=>{
      state.round = buildRound();
      state.focusIndex = 0;
      state.screen = "game";
      state.toast = null;
      render();
    };
    $("#btnSettings").onclick = ()=>{
      state.screen = "settings";
      render();
    };
  }

  function bindSettings(){
    const s = state.settings;
    const kids = $("#toggleKids");
    const exp = $("#toggleExplain");

    kids.onclick = ()=>{ s.kidsMode = !s.kidsMode; kids.classList.toggle("on", s.kidsMode); };
    exp.onclick = ()=>{ s.showExplanation = !s.showExplanation; exp.classList.toggle("on", s.showExplanation); };

    $("#btnSaveSettings").onclick = ()=>{
      saveSettings(s);
      setToast("Configurações salvas!", "Elas serão usadas nas próximas rodadas.");
    };
    $("#btnBackHome").onclick = ()=>{
      state.screen = "home";
      render();
    };
  }

  function bindGame(){
    const answerEls = document.querySelectorAll(".answer");
    answerEls.forEach(el=>{
      el.onclick = ()=> {
        const idx = Number(el.getAttribute("data-idx"));
        if(state.round.eliminated.has(idx)) return;
        state.focusIndex = idx;
        choose(idx);
      };
      el.onfocus = ()=>{
        const idx = Number(el.getAttribute("data-idx"));
        if(!Number.isNaN(idx)){
          state.focusIndex = idx;
          highlightFocus();
        }
      };
    });

    $("#helpSkip").onclick = ()=> useSkip();
    $("#helpElim").onclick = ()=> useEliminate();
    $("#helpHelp").onclick = ()=> useHelp();

    highlightFocus();
  }

  function bindResult(){
    $("#btnRestart").onclick = ()=>{
      state.round = buildRound();
      state.focusIndex = 0;
      state.screen = "game";
      state.toast = null;
      render();
    };
    $("#btnGoHome").onclick = ()=>{
      state.screen = "home";
      state.round = null;
      state.toast = null;
      render();
    };
  }

  function confirmGoHome(){
    if(!state.round) { state.screen = "home"; render(); return; }
    const ok = window.confirm("Voltar ao início e encerrar a rodada atual?");
    if(ok){
      state.screen = "home";
      state.round = null;
      state.toast = null;
      render();
    }
  }

  function highlightFocus(){
    const nodes = document.querySelectorAll(".answer");
    nodes.forEach(n=> n.classList.remove("focused"));
    const focus = document.querySelector(`.answer[data-idx="${state.focusIndex}"]`);
    if(focus && !focus.classList.contains("hidden")){
      focus.classList.add("focused");
      // keep in view if needed
      focus.scrollIntoView({block:"nearest", inline:"nearest"});
    }
  }

  function moveFocus(dir){
    if(!state.round) return;
    let idx = state.focusIndex;
    for(let tries=0; tries<6; tries++){
      idx = (idx + dir + 4) % 4;
      if(!state.round.eliminated.has(idx)){
        state.focusIndex = idx;
        highlightFocus();
        break;
      }
    }
  }

  function useSkip(){
    const r = state.round;
    if(!r || r.helps.skip) return;
    r.helps.skip = true;
    r.eliminated = new Set(); // reset eliminations on skip
    setToast("Pular usado!", "Você avançou para a próxima pergunta.");
    nextQuestion(true);
  }

  function useEliminate(){
    const r = state.round;
    if(!r || r.helps.eliminate) return;
    r.helps.eliminate = true;

    const q = r.questions[r.prizeIndex];
    const incorrect = [0,1,2,3].filter(i=> i !== q.c);
    const toRemove = shuffle(incorrect).slice(0,2);
    toRemove.forEach(i=> r.eliminated.add(i));

    // adjust focus if focused got eliminated
    if(r.eliminated.has(state.focusIndex)){
      state.focusIndex = [0,1,2,3].find(i=> !r.eliminated.has(i)) ?? 0;
    }
    setToast("Eliminadas duas alternativas!", "Agora ficou mais fácil 😉");
    render();
  }

  function useHelp(){
    const r = state.round;
    if(!r || r.helps.help) return;
    r.helps.help = true;

    const q = r.questions[r.prizeIndex];
    // 50/50: either show tip or show audience guess
    const showTip = Math.random() < 0.55 && q.tip;
    if(showTip){
      setToast("Dica", q.tip);
    }else{
      const correct = q.c;
      const perc = [0,0,0,0].map(()=> 0);
      // give more weight to correct
      let remaining = 100;
      const correctPerc = 55 + Math.floor(Math.random()*26); // 55-80
      perc[correct] = correctPerc;
      remaining -= correctPerc;
      const others = [0,1,2,3].filter(i=> i!==correct && !r.eliminated.has(i));
      const parts = others.length ? others.length : 3;
      for(let i=0;i<others.length;i++){
        const v = i===others.length-1 ? remaining : Math.floor(Math.random()*(remaining+1));
        perc[others[i]] = v;
        remaining -= v;
      }
      const letters = ["A","B","C","D"];
      const top2 = [0,1,2,3].sort((i,j)=> perc[j]-perc[i]).slice(0,2)
        .map(i=> `${letters[i]} (${perc[i]}%)`).join(" • ");
      setToast("Opinião da maioria", top2);
    }
  }

  function choose(idx){
    const r = state.round;
    if(!r || state.lock) return;
    const q = r.questions[r.prizeIndex];
    if(r.eliminated.has(idx)) return;

    state.lock = true;

    const nodes = document.querySelectorAll(".answer");
    nodes.forEach(n=> n.classList.add("disabled"));

    // Mark correct/wrong
    const correctEl = document.querySelector(`.answer[data-idx="${q.c}"]`);
    const chosenEl = document.querySelector(`.answer[data-idx="${idx}"]`);
    if(correctEl) correctEl.classList.add("correct");
    if(chosenEl && idx !== q.c) chosenEl.classList.add("wrong");

    const ok = idx === q.c;
    r.lastResult = { ok, correctIndex: q.c };

    if(ok){
      r.correctCount += 1;
      const won = PRIZES[r.prizeIndex];
      r.won = won;

      const explain = state.settings.showExplanation && q.tip
        ? q.tip
        : "Boa! Vamos para a próxima.";

      setToast("Resposta correta! 🎉", explain);

      window.setTimeout(()=>{
        nextQuestion(false);
        state.lock = false;
      }, 900);
    }else{
      // finish - keep last won (if no correct yet, 0)
      const explain = state.settings.showExplanation && q.tip
        ? q.tip
        : "Não foi dessa vez — mas valeu a participação!";
      setToast("Resposta incorreta ❌", explain);

      window.setTimeout(()=>{
        finishGame(false);
        state.lock = false;
      }, 1100);
    }
  }

  function nextQuestion(fromSkip){
    const r = state.round;
    if(!r) return;

    // advance prizeIndex
    r.prizeIndex += 1;
    r.eliminated = new Set();

    if(r.prizeIndex >= PRIZES.length){
      finishGame(true);
      return;
    }
    state.focusIndex = 0;
    state.toast = state.toast; // keep toast if any
    render();
  }

  function finishGame(success){
    const r = state.round;
    if(!r) return;
    r.finished = true;
    if(success){
      r.won = PRIZES[PRIZES.length-1];
      r.lastResult = { ok: true, correctIndex: null };
    }else{
      // r.won already last achieved; if none, keep 0
      r.won = r.won || 0;
    }
    state.screen = "result";
    render();
  }

  // initial render
  render();
})();
