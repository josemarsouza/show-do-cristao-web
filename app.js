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

  // Sound System
  const sounds = {
    ctx: null,
    
    getContext() {
      if (!this.ctx) {
        try {
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) {
          console.log('Sound not supported');
        }
      }
      return this.ctx;
    },
    
    playTone(frequency, duration, type = 'sine') {
      const ctx = this.getContext();
      if (!ctx) return;
      
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.value = frequency;
        osc.type = type;
        
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
      } catch(e) {
        console.log('Sound playback failed');
      }
    },
    
    welcome() {
      // Joyful ascending melody
      setTimeout(() => this.playTone(523.25, 0.15), 0);    // C5
      setTimeout(() => this.playTone(659.25, 0.15), 150);  // E5
      setTimeout(() => this.playTone(783.99, 0.25), 300);  // G5
    },
    
    select() {
      // Quick click sound
      this.playTone(800, 0.08);
    },
    
    correct() {
      // Success melody
      setTimeout(() => this.playTone(523.25, 0.12), 0);    // C5
      setTimeout(() => this.playTone(659.25, 0.12), 120);  // E5
      setTimeout(() => this.playTone(783.99, 0.12), 240);  // G5
      setTimeout(() => this.playTone(1046.50, 0.25), 360); // C6
    },
    
    wrong() {
      // Descending sad tones
      setTimeout(() => this.playTone(400, 0.15), 0);
      setTimeout(() => this.playTone(300, 0.15), 150);
      setTimeout(() => this.playTone(200, 0.3), 300);
    },
    
    gameEnd() {
      // Triumphant fanfare
      setTimeout(() => this.playTone(523.25, 0.15), 0);
      setTimeout(() => this.playTone(659.25, 0.15), 150);
      setTimeout(() => this.playTone(783.99, 0.15), 300);
      setTimeout(() => this.playTone(1046.50, 0.15), 450);
      setTimeout(() => this.playTone(1318.51, 0.4), 600);
    },
    
    giveUp() {
      // Gentle descending tones
      setTimeout(() => this.playTone(500, 0.2), 0);
      setTimeout(() => this.playTone(400, 0.2), 200);
      setTimeout(() => this.playTone(350, 0.3), 400);
    }
  };

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
    playerName: "", // player's name
    round: null,
    focusIndex: -1, // -1 means no focus initially
    selectedIndex: null, // index selected but not yet confirmed
    toast: null,
    lock: false, // prevents double submit during animations
    feedbackModal: null, // { type: 'correct' | 'wrong', message: string }
  };

  function buildRound(){
    // Select 6 questions: 1 per prize level, difficulty buckets:
    // Level 0 -> easy, 1-2 -> medium, 3 -> hard, 4 -> veryhard, 5 -> extreme
    const bank = window.QUESTION_BANK;
    const pick = (arr)=> shuffle(arr)[0];

    const easyPool = bank.easy;
    const medPool = bank.medium;
    const hardPool = bank.hard;
    const vhPool = bank.veryhard;
    const extremePool = bank.extreme;

    // Kids mode: use easier distribution
    const levels = state.settings.kidsMode
      ? [pick(easyPool), pick(easyPool), pick(medPool), pick(medPool), pick(hardPool), pick(hardPool)]
      : [pick(easyPool), pick(medPool), pick(medPool), pick(hardPool), pick(vhPool), pick(extremePool)];

    // Ensure unique questions (best effort)
    const unique = [];
    const used = new Set();
    for (const q of levels){
      const key = q.q + "||" + q.a.join("|");
      if(!used.has(key)){ unique.push(q); used.add(key); }
      else{
        // fallback: find another from same bucket
        const bucket = easyPool.includes(q) ? easyPool 
          : medPool.includes(q) ? medPool 
          : hardPool.includes(q) ? hardPool 
          : vhPool.includes(q) ? vhPool 
          : extremePool;
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
      gaveUp: false, // whether player gave up
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
          ${state.feedbackModal ? templates.feedbackModal(state.feedbackModal) : ""}
        </div>
      `;
    },
    header(){
      const playerInfo = state.playerName 
        ? `<div class="pill player-name"><span>👤 Jogador:</span> <strong>${escapeHtml(state.playerName)}</strong></div>`
        : "";
      
      const right = state.screen === "game" && state.round
        ? `<div class="pill"><span>🎁 Valendo:</span> <strong>R$ ${PRIZES[state.round.prizeIndex]}</strong></div>`
        : state.screen === "result" && state.round
        ? `<div class="pill"><span>🎄 Você conquistou:</span> <strong>R$ ${state.round.won}</strong></div>`
        : `<div class="pill"><span>Dica:</span> <strong>F11</strong> tela cheia</div>`;

      return `
        <div class="header">
          <div class="brand">
            <h1>🎅 Show do Cristão 🎄</h1>
            <div class="sub">Quiz Natalino em Família • Jesus é o motivo!</div>
          </div>
          <div class="header-right">
            ${playerInfo}
            ${right}
          </div>
        </div>
      `;
    },
    home(){
      return `
        <div class="center">
          <h2 class="title-big">🎄 Quiz Natalino em Família! 🎁</h2>
          <p class="lead">
            Neste Natal, vamos testar nosso conhecimento sobre Jesus de forma divertida! 
            A cada acerto, você sobe na premiação:
            <strong style="color:var(--christmas-gold)">R$ 2</strong>,
            <strong style="color:var(--christmas-gold)">R$ 5</strong>,
            <strong style="color:var(--christmas-gold)">R$ 10</strong>,
            <strong style="color:var(--christmas-gold)">R$ 20</strong>,
            <strong style="color:var(--christmas-gold)">R$ 50</strong>,
            <strong style="color:var(--christmas-gold)">R$ 100</strong>.
            É só responder e se divertir! 🌟
          </p>

          <div class="card rules-card">
            <h3 style="margin:0 0 12px; color:var(--christmas-red); font-size: clamp(22px, 2.8vw, 28px);">📜 Regras do Jogo</h3>
            <ul class="rules-list">
              <li><strong>6 perguntas</strong> sobre Jesus e a Bíblia</li>
              <li>Cada acerto aumenta sua <strong style="color:var(--christmas-gold)">premiação</strong></li>
              <li><strong style="color:var(--christmas-red)">Errou? O jogo termina!</strong> Você não leva prêmio</li>
              <li>Use <strong>3 ajudas</strong>: 🔄 Pular, ❌ Eliminar 2 alternativas, 💡 Dica</li>
              <li>Após usar todas as ajudas, pode <strong>desistir</strong> e levar metade do valor</li>
              <li>Perguntas ficam mais <strong style="color:var(--christmas-red)">difíceis</strong> conforme você avança!</li>
            </ul>
          </div>

          <div class="card" style="padding:16px 18px; margin-top: 6px">
            <label for="playerNameInput" style="display:block; margin-bottom:8px; font-size: clamp(16px, 2vw, 18px); font-weight:600;">
              👤 Digite seu nome para começar:
            </label>
            <input 
              type="text" 
              id="playerNameInput" 
              placeholder="Seu nome..." 
              maxlength="30"
              value="${escapeHtml(state.playerName)}"
              style="width:100%; padding:12px 14px; font-size: clamp(16px, 2vw, 18px); border-radius:12px; border:1px solid var(--border); background:rgba(0,0,0,0.35); color:var(--text); outline:none;"
            />
          </div>

          <div class="row" style="margin-top:10px">
            <button class="btn primary" id="btnStart">🎅 Começar a Brincadeira!</button>
            <button class="btn" id="btnSettings">⚙️ Configurações</button>
          </div>

          <div class="card" style="padding:14px 16px; margin-top: 10px">
            <div class="kbd">
              Controles: <code>1</code><code>2</code><code>3</code><code>4</code> alternativas •
              <code>P</code> pular • <code>E</code> eliminar duas • <code>H</code> ajuda •
              <code>Esc</code> início
            </div>
            <p class="smallnote">Sugestão: aperte <strong>F11</strong> para tela cheia e aproveite mais! 😉</p>
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

      // Build timeline
      const timelineHtml = `
        <div class="timeline">
          ${PRIZES.map((prize, i) => {
            const status = i < idx ? 'earned' : i === idx ? 'current' : 'pending';
            const label = i < idx ? '✓' : i === idx ? '→' : '';
            return `
              <div class="timeline-item">
                <div class="money-note ${status}">
                  ${prize}
                </div>
                <div class="timeline-label">${label}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      const answersHtml = q.a.map((txt, i)=>{
        const isElim = r.eliminated.has(i);
        const classes = [
          "answer",
          isElim ? "hidden" : "",
          i === state.focusIndex ? "focused" : "",
          i === state.selectedIndex ? "selected" : "",
        ].join(" ").trim();

        return `
          <div class="${classes}" data-idx="${i}" tabindex="0" role="button" aria-label="Alternativa ${letters[i]}">
            <div class="letter">${letters[i]}</div>
            <div class="txt">${escapeHtml(txt)}</div>
          </div>
        `;
      }).join("");

      const canGiveUp = r.helps.skip && r.helps.eliminate && r.helps.help;
      const helpBtns = `
        <button class="btn small ${r.helps.skip ? "" : "primary"}" id="helpSkip" ${r.helps.skip ? "disabled":""}>🔄 Pular (P)</button>
        <button class="btn small ${r.helps.eliminate ? "" : "primary"}" id="helpElim" ${r.helps.eliminate ? "disabled":""}>❌ Eliminar (E)</button>
        <button class="btn small ${r.helps.help ? "" : "primary"}" id="helpHelp" ${r.helps.help ? "disabled":""}>💡 Ajuda (H)</button>
        ${canGiveUp ? `<button class="btn small danger" id="btnGiveUp">🏳️ Desistir</button>` : ''}
      `;

      const confirmBtn = state.selectedIndex !== null 
        ? `<button class="confirm-btn" id="btnConfirm">✨ Confirmar Resposta ✨</button>`
        : `<button class="confirm-btn" id="btnConfirm" disabled>Selecione uma alternativa primeiro</button>`;

      return `
        <div class="row" style="justify-content:space-between">
          <div class="pill"><span>${escapeHtml(subtitle)}</span></div>
          <div class="pill"><span>Progresso:</span> <strong>${progress}/6</strong></div>
        </div>

        ${timelineHtml}

        <div class="card question">
          <h2>${escapeHtml(q.q)}</h2>
          <p>Escolha a alternativa correta e depois confirme sua resposta! 🤔</p>
        </div>

        <div class="answers">
          ${answersHtml}
        </div>

        ${confirmBtn}

        <div class="footer">
          <div class="helpbar">${helpBtns}</div>
          <div class="kbd">
            Teclado: <code>1</code><code>2</code><code>3</code><code>4</code> selecionar • <code>Enter</code> confirmar • <code>Esc</code> início
          </div>
        </div>
      `;
    },
    result(){
      const r = state.round;
      const ok = r?.lastResult?.ok;
      const gaveUp = r?.gaveUp;
      
      let title, msg, emoji;
      if(gaveUp){
        title = "Você desistiu! 😅";
        msg = "Tudo bem, o importante é ter tentado! Que tal jogar de novo? Você pode conseguir mais!";
        emoji = "🎄";
      } else if(ok){
        title = "Parabéns, campeão! 🎉";
        msg = "Você arrasou e conquistou o prêmio máximo! Jesus deve estar orgulhoso do seu conhecimento! 🌟";
        emoji = "🏆";
      } else {
        title = "Quase lá! 💪";
        msg = "Não foi dessa vez, mas você foi muito bem! O importante é ter participado. Vamos tentar de novo?";
        emoji = "🎁";
      }

      const motivational = [
        "Que Deus abençoe você e sua família neste Natal! 🙏",
        "Continue estudando a Palavra e você irá cada vez mais longe! 📖",
        "Cada pergunta é uma oportunidade de aprender mais sobre Jesus! ✨",
        "O conhecimento é um presente, e você está no caminho certo! 🎄"
      ];
      const randomMsg = motivational[Math.floor(Math.random() * motivational.length)];

      const summary = r ? `
        <div class="card" style="padding:16px 18px">
          <div class="row" style="justify-content:space-between; margin-bottom: 12px">
            <div class="pill"><span>Acertos:</span> <strong>${r.correctCount} ✓</strong></div>
            <div class="pill"><span>${emoji} Premiação:</span> <strong style="color: var(--christmas-gold)">R$ ${r.won}</strong></div>
          </div>
          <p class="lead" style="margin: 12px 0; text-align: center; font-size: 18px;">
            ${randomMsg}
          </p>
          <p class="smallnote" style="margin-top:10px">
            Dica: você pode jogar novamente! As perguntas e alternativas são embaralhadas a cada rodada. 🔄
          </p>
        </div>
      ` : "";

      return `
        <div class="center">
          <h2 class="title-big">${title}</h2>
          <p class="lead">${escapeHtml(msg)}</p>
          ${summary}
          <div class="row" style="margin-top: 10px">
            <button class="btn primary" id="btnRestart">🎮 Jogar Novamente</button>
            <button class="btn" id="btnGoHome">🏠 Voltar ao Início</button>
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
    },
    feedbackModal(f){
      const isCorrect = f.type === 'correct';
      const icon = isCorrect ? '🎉' : '😢';
      const title = isCorrect ? 'Resposta Correta!' : 'Resposta Incorreta';
      const cssClass = isCorrect ? 'correct' : 'wrong';
      
      return `
        <div class="feedback-modal">
          <div class="feedback-content ${cssClass}">
            <div class="feedback-icon">${icon}</div>
            <h2 class="feedback-title">${title}</h2>
            <p class="feedback-message">${escapeHtml(f.message)}</p>
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
          if(state.round && !state.round.eliminated.has(idx)){
            state.focusIndex = idx;
            selectAnswer(idx);
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
          // confirm selected answer
          if(state.selectedIndex !== null){
            confirmAnswer();
          }
        }
      }
    };
  }

  function bindHome(){
    const nameInput = $("#playerNameInput");
    
    // Update state when typing
    if(nameInput){
      nameInput.oninput = ()=> {
        state.playerName = nameInput.value.trim();
      };
      nameInput.focus();
    }
    
    $("#btnStart").onclick = ()=>{
      // Get the name from input
      const name = $("#playerNameInput")?.value?.trim() || "";
      state.playerName = name;
      
      sounds.welcome();
      state.round = buildRound();
      state.focusIndex = -1;
      state.selectedIndex = null;
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
        selectAnswer(idx);
      };
      el.onfocus = ()=>{
        const idx = Number(el.getAttribute("data-idx"));
        if(!Number.isNaN(idx)){
          state.focusIndex = idx;
          highlightFocus();
        }
      };
    });

    $("#helpSkip")?.addEventListener("click", ()=> useSkip());
    $("#helpElim")?.addEventListener("click", ()=> useEliminate());
    $("#helpHelp")?.addEventListener("click", ()=> useHelp());
    $("#btnConfirm")?.addEventListener("click", ()=> confirmAnswer());
    $("#btnGiveUp")?.addEventListener("click", ()=> giveUp());

    highlightFocus();
  }

  function bindResult(){
    $("#btnRestart").onclick = ()=>{
      state.round = buildRound();
      state.focusIndex = -1;
      state.selectedIndex = null;
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
    if(state.focusIndex >= 0){
      const focus = document.querySelector(`.answer[data-idx="${state.focusIndex}"]`);
      if(focus && !focus.classList.contains("hidden")){
        focus.classList.add("focused");
        // keep in view if needed
        focus.scrollIntoView({block:"nearest", inline:"nearest"});
      }
    }
  }

  function moveFocus(dir){
    if(!state.round) return;
    let idx = Math.max(state.focusIndex, 0);
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
    
    // Pick a new question from the same difficulty level
    const bank = window.QUESTION_BANK;
    const idx = r.prizeIndex;
    const pick = (arr)=> shuffle(arr)[0];
    
    const easyPool = bank.easy;
    const medPool = bank.medium;
    const hardPool = bank.hard;
    const vhPool = bank.veryhard;
    const extremePool = bank.extreme;
    
    // Determine difficulty based on prize index and mode
    let pool;
    if(state.settings.kidsMode){
      pool = idx < 2 ? easyPool : idx < 4 ? medPool : hardPool;
    } else {
      pool = idx === 0 ? easyPool 
           : idx <= 2 ? medPool 
           : idx === 3 ? hardPool 
           : idx === 4 ? vhPool 
           : extremePool;
    }
    
    // Pick a different question from the pool
    const currentQ = r.questions[idx].q;
    let newQ = pick(pool);
    let tries = 0;
    while(newQ.q === currentQ && tries < 10){
      newQ = pick(pool);
      tries++;
    }
    
    // Shuffle alternatives
    const indices = [0,1,2,3];
    const shuffledIdx = shuffle(indices);
    const answers = shuffledIdx.map(i=> newQ.a[i]);
    const correct = shuffledIdx.indexOf(newQ.c);
    
    r.questions[idx] = {
      q: newQ.q,
      a: answers,
      c: correct,
      tip: newQ.tip || "",
    };
    
    r.eliminated = new Set(); // reset eliminations on skip
    state.selectedIndex = null;
    state.focusIndex = -1;
    
    setToast("Pular usado!", "Nova pergunta no mesmo nível.");
    render();
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
    if(state.focusIndex >= 0 && r.eliminated.has(state.focusIndex)){
      state.focusIndex = [0,1,2,3].find(i=> !r.eliminated.has(i)) ?? -1;
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

  function selectAnswer(idx){
    if(state.lock) return;
    sounds.select();
    state.selectedIndex = idx;
    render();
  }

  function confirmAnswer(){
    if(state.selectedIndex === null || state.lock) return;
    choose(state.selectedIndex);
  }

  function giveUp(){
    const r = state.round;
    if(!r || state.lock) return;
    
    const canGiveUp = r.helps.skip && r.helps.eliminate && r.helps.help;
    if(!canGiveUp) {
      setToast("Não pode desistir ainda!", "Use todos os auxílios primeiro.");
      return;
    }

    const ok = window.confirm("Tem certeza que deseja desistir? Você receberá apenas metade do valor conquistado.");
    if(!ok) return;

    sounds.giveUp();
    // Give up: receive half of earned value
    r.won = Math.floor(r.won / 2);
    r.gaveUp = true;
    r.lastResult = { ok: false, correctIndex: null };
    state.screen = "result";
    render();
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

      sounds.correct();
      
      // Show feedback modal
      state.feedbackModal = { type: 'correct', message: explain };
      render();

      window.setTimeout(()=>{
        state.feedbackModal = null;
        nextQuestion(false);
        state.lock = false;
      }, 2200);
    }else{
      // finish - keep last won (if no correct yet, 0)
      const explain = state.settings.showExplanation && q.tip
        ? q.tip
        : "Não foi dessa vez — mas valeu a participação!";
      
      sounds.wrong();
      
      // Show feedback modal
      state.feedbackModal = { type: 'wrong', message: explain };
      render();

      window.setTimeout(()=>{
        state.feedbackModal = null;
        finishGame(false);
        state.lock = false;
      }, 2500);
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
    state.focusIndex = -1;
    state.selectedIndex = null;
    state.toast = state.toast; // keep toast if any
    render();
  }

  function finishGame(success){
    const r = state.round;
    if(!r) return;
    r.finished = true;
    if(success){
      sounds.gameEnd();
      r.won = PRIZES[PRIZES.length-1];
      r.lastResult = { ok: true, correctIndex: null };
    }else{
      // New rule: if participant makes a mistake, they don't win a prize
      r.won = 0;
    }
    state.screen = "result";
    render();
  }

  // initial render
  render();
})();
