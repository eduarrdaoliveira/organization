(function(){
  "use strict";

  /* ---------- Constantes ---------- */
  var CHAVE_TOPICOS = "organizador_topicos_v1";
  var CHAVE_TAREFAS = "organizador_tarefas_v1";
  var CHAVE_CONCLUSOES = "organizador_conclusoes_v1";

  var PALETA_CORES = [
    "#3D6B5C","#7A5C8E","#C97B63","#C9A227","#4C7A9E",
    "#B5566B","#6E7B45","#5B6B78","#3D8A82","#8C4A6B"
  ];

  var PALETA_ICONES = [
    "🎓","📚","💼","📈","💪","🏋️","💊","🧘","🏠","🧹",
    "🛒","🍎","💰","📅","✏️","🎨","🐾","🚿","😴","🧺",
    "🎯","🚗","📖","🧴"
  ];

  var NOMES_DIAS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  var NOMES_MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

  /* ---------- Firebase / sincronização ---------- */
  var firebaseApp = null;
  var auth = null;
  var db = null;
  var usuarioAtual = null;
  var syncTimer = null;
  var inicializando = true;
  var erroConfiguracao = false;
  var statusSync = "offline";

  /* ---------- Estado ---------- */
  var estado = {
    abaAtiva: "hoje",
    topicos: carregar(CHAVE_TOPICOS, []),
    tarefas: carregar(CHAVE_TAREFAS, []),
    conclusoes: carregar(CHAVE_CONCLUSOES, {}), // { "tarefaId_YYYY-MM-DD": true }
    mesCalendario: new Date(),
    diaSelecionadoCalendario: null,
    topicoEvolucaoId: null,
    modal: null // {tipo:'topico'|'tarefa'|'diaCalendario', dados:{...}}
  };

  function carregar(chave, padrao){
    try{
      var v = localStorage.getItem(chave);
      return v ? JSON.parse(v) : padrao;
    }catch(e){ return padrao; }
  }
  function salvar(chave, valor){
    try{ localStorage.setItem(chave, JSON.stringify(valor)); }catch(e){}
  }
  function persistirTudo(){
    salvar(CHAVE_TOPICOS, estado.topicos);
    salvar(CHAVE_TAREFAS, estado.tarefas);
    salvar(CHAVE_CONCLUSOES, estado.conclusoes);
    agendarSincronizacao();
  }

  function dadosAtuais(){
    return {topicos:estado.topicos,tarefas:estado.tarefas,conclusoes:estado.conclusoes,atualizadoEm:Date.now()};
  }

  function agendarSincronizacao(){
    if(!usuarioAtual || !db) return;
    statusSync = "salvando";
    render();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async function(){
      try{
        await db.collection("usuarios").doc(usuarioAtual.uid).set(dadosAtuais(), {merge:true});
        statusSync = "salvo";
      }catch(e){
        console.error(e); statusSync = "erro";
      }
      render();
    }, 350);
  }

  async function carregarDaNuvem(user){
    var ref = db.collection("usuarios").doc(user.uid);
    var snap = await ref.get();
    if(snap.exists){
      var d=snap.data()||{};
      estado.topicos=Array.isArray(d.topicos)?d.topicos:[];
      estado.tarefas=Array.isArray(d.tarefas)?d.tarefas:[];
      estado.conclusoes=d.conclusoes&&typeof d.conclusoes==="object"?d.conclusoes:{};
      salvar(CHAVE_TOPICOS, estado.topicos); salvar(CHAVE_TAREFAS, estado.tarefas); salvar(CHAVE_CONCLUSOES, estado.conclusoes);
    }else{
      await ref.set(dadosAtuais());
    }
    statusSync="salvo";
  }
  function gerarId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  /* ---------- Utilidades de data ---------- */
  function paraISO(d){
    var y=d.getFullYear(), m=(d.getMonth()+1+"").padStart(2,"0"), day=(d.getDate()+"").padStart(2,"0");
    return y+"-"+m+"-"+day;
  }
  function hojeISO(){ return paraISO(new Date()); }
  function chaveConclusao(tarefaId, dataISO){ return tarefaId+"_"+dataISO; }

  function tarefaOcorreEm(tarefa, dataISO){
    var d = new Date(dataISO+"T00:00:00");
    if(tarefa.recorrencia === "unica"){
      return tarefa.dataUnica === dataISO;
    }
    if(tarefa.recorrencia === "diaria"){
      return true;
    }
    if(tarefa.recorrencia === "semanal"){
      return (tarefa.diasSemana||[]).indexOf(d.getDay()) !== -1;
    }
    return false;
  }

  function topicoPorId(id){
    for(var i=0;i<estado.topicos.length;i++){ if(estado.topicos[i].id===id) return estado.topicos[i]; }
    return null;
  }

  function renderCarregando(){ return '<main class="tela-central"><div class="loader-ios"></div><p>Preparando seu organizador…</p></main>'; }
  function renderConfigPendente(){ return '<main class="tela-central"><section class="login-card"><div class="app-icon">✓</div><h1>Conecte ao Firebase</h1><p>Preencha o arquivo <strong>assets/firebase-config.js</strong> com as credenciais do seu projeto Firebase.</p><div class="aviso-ios">O pacote inclui um guia completo no README.</div></section></main>'; }
  function renderLogin(){ return '<main class="tela-central"><section class="login-card"><div class="app-icon">✓</div><h1>Meu Organizador</h1><p>Suas tarefas, calendário e progresso sincronizados em todos os dispositivos.</p><button class="btn-login-google" data-acao="entrar-google"><span class="google-g">G</span>Continuar com Google</button><small>Os dados ficam vinculados à sua conta.</small></section></main>'; }

  /* ---------- Render raiz ---------- */
  function render(){
    var app = document.getElementById("app");
    if(inicializando){ app.innerHTML=renderCarregando(); return; }
    if(erroConfiguracao){ app.innerHTML=renderConfigPendente(); ligarEventos(); return; }
    if(!usuarioAtual){ app.innerHTML=renderLogin(); ligarEventos(); return; }
    var html = "";
    html += renderHeader();
    html += renderNav();
    html += '<div id="conteudo-view">';
    if(estado.abaAtiva === "hoje") html += renderHoje();
    else if(estado.abaAtiva === "tarefas") html += renderTarefas();
    else if(estado.abaAtiva === "calendario") html += renderCalendario();
    else if(estado.abaAtiva === "evolucao") html += renderEvolucao();
    html += '</div>';
    app.innerHTML = html;

    if(estado.modal){
      app.insertAdjacentHTML("beforeend", renderModal());
    }
    ligarEventos();
  }

  function renderHeader(){
    var d = new Date();
    var diasSemanaLongo = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
    var dataFormatada = diasSemanaLongo[d.getDay()]+", "+d.getDate()+" de "+NOMES_MESES[d.getMonth()]+" de "+d.getFullYear();
    var nome = usuarioAtual && (usuarioAtual.displayName || usuarioAtual.email || "Conta");
    var syncLabel = statusSync==="salvando"?"Salvando…":statusSync==="erro"?"Erro ao sincronizar":"Sincronizado";
    return '<header class="topo">'
      + '<div><h1>Meu Organizador</h1><div class="data-hoje">'+dataFormatada+'</div></div>'
      + '<div class="conta-ios"><div class="sync-status '+statusSync+'"><span></span>'+syncLabel+'</div><button class="avatar-conta" data-acao="sair" title="Sair">'+escapeHTML((nome||"U").charAt(0).toUpperCase())+'</button></div>'
      + '</header>';
  }

  function renderNav(){
    var abas = [
      {id:"hoje", rotulo:"Hoje"},
      {id:"tarefas", rotulo:"Tarefas"},
      {id:"calendario", rotulo:"Calendário"},
      {id:"evolucao", rotulo:"Evolução"}
    ];
    var html = '<nav class="abas">';
    abas.forEach(function(a){
      html += '<button data-aba="'+a.id+'" class="'+(estado.abaAtiva===a.id?"ativa":"")+'">'+a.rotulo+'</button>';
    });
    html += '</nav>';
    return html;
  }

  /* ---------- VIEW: HOJE ---------- */
  function renderHoje(){
    if(estado.topicos.length===0){
      return '<div class="cartao">' + estadoVazio(
        "🌱","Comece criando seus tópicos",
        "Crie tópicos como Faculdade, Estágio, Treinos ou Vitaminas para organizar suas tarefas.",
        '<button class="btn" data-acao="abrir-modal-topico">Criar primeiro tópico</button>'
      ) + '</div>';
    }
    var iso = hojeISO();
    var tarefasHoje = estado.tarefas.filter(function(t){ return tarefaOcorreEm(t, iso); });

    if(estado.tarefas.length===0){
      return '<div class="cartao">' + estadoVazio(
        "🗒️","Nenhuma tarefa cadastrada ainda",
        "Adicione suas tarefas do dia a dia na aba Tarefas para vê-las aparecer aqui.",
        '<button class="btn" data-acao="ir-tarefas">Ir para Tarefas</button>'
      ) + '</div>';
    }

    if(tarefasHoje.length===0){
      return '<div class="cartao">' + estadoVazio(
        "☀️","Nada agendado para hoje",
        "Aproveite o dia livre ou adicione uma nova tarefa para hoje.",
        '<button class="btn" data-acao="abrir-modal-tarefa">Nova tarefa</button>'
      ) + '</div>';
    }

    tarefasHoje.sort(function(a,b){
      var ha = a.horario||"99:99", hb = b.horario||"99:99";
      return ha.localeCompare(hb);
    });

    var html = '<div class="cartao">';
    html += '<h2 class="titulo-secao">Tarefas de hoje</h2>';
    html += '<p class="sub-secao">'+tarefasHoje.filter(function(t){return concluidaEm(t.id, iso);}).length+' de '+tarefasHoje.length+' concluídas</p>';
    html += '<ul class="lista-tarefas">';
    tarefasHoje.forEach(function(t){
      html += renderItemTarefa(t, iso, false);
    });
    html += '</ul></div>';
    return html;
  }

  function concluidaEm(tarefaId, dataISO){
    return !!estado.conclusoes[chaveConclusao(tarefaId, dataISO)];
  }

  function renderItemTarefa(tarefa, dataISO, mostrarTopicoSempre){
    var topico = topicoPorId(tarefa.topicoId);
    var marcada = concluidaEm(tarefa.id, dataISO);
    var corTopico = topico ? topico.cor : "#999";
    var html = '<li class="item-tarefa '+(marcada?"concluida":"")+'">';
    html += '<button class="check '+(marcada?"marcado":"")+'" data-acao="alternar-conclusao" data-tarefa="'+tarefa.id+'" data-data="'+dataISO+'">'+(marcada?"✓":"")+'</button>';
    html += '<div class="conteudo">';
    html += '<div class="titulo-tarefa">'+escapeHTML(tarefa.titulo)+'</div>';
    html += '<div class="meta">';
    if(topico){
      html += '<span class="pilula-topico" style="background:'+corTopico+'22;color:'+corTopico+'">'+topico.icone+' '+escapeHTML(topico.nome)+'</span>';
    }
    if(tarefa.horario) html += '<span>⏰ '+tarefa.horario+'</span>';
    if(tarefa.recorrencia==="diaria") html += '<span>🔁 Diária</span>';
    if(tarefa.recorrencia==="semanal") html += '<span>🔁 '+ (tarefa.diasSemana||[]).map(function(n){return NOMES_DIAS[n];}).join(", ") +'</span>';
    html += '</div></div>';
    html += '<div class="acoes-tarefa">';
    html += '<button class="icone-btn" data-acao="editar-tarefa" data-tarefa="'+tarefa.id+'" title="Editar">✎</button>';
    html += '<button class="icone-btn" data-acao="excluir-tarefa" data-tarefa="'+tarefa.id+'" title="Excluir">🗑</button>';
    html += '</div>';
    html += '</li>';
    return html;
  }

  /* ---------- VIEW: TAREFAS ---------- */
  function renderTarefas(){
    var html = '';
    html += '<div class="cartao">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px;">';
    html += '<div><h2 class="titulo-secao">Tarefas por tópico</h2><p class="sub-secao" style="margin-bottom:0">Organize e acompanhe tudo o que você precisa fazer</p></div>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn secundario" data-acao="abrir-modal-topico">+ Tópico</button>';
    html += '<button class="btn" data-acao="abrir-modal-tarefa" '+(estado.topicos.length===0?"disabled":"")+'>+ Tarefa</button>';
    html += '</div></div></div>';

    if(estado.topicos.length===0){
      html += '<div class="cartao">' + estadoVazio(
        "🌱","Nenhum tópico criado ainda",
        "Tópicos ajudam a separar sua rotina: Faculdade, Estágio, Treinos, Vitaminas, Casa...",
        '<button class="btn" data-acao="abrir-modal-topico">Criar tópico</button>'
      ) + '</div>';
      return html;
    }

    var semTarefas = estado.tarefas.length === 0;
    estado.topicos.forEach(function(topico){
      var tarefasDoTopico = estado.tarefas.filter(function(t){ return t.topicoId===topico.id; });
      html += '<div class="cartao grupo-topico">';
      html += '<div class="cabecalho-grupo">';
      html += '<span style="font-size:1.1rem">'+topico.icone+'</span>';
      html += '<span class="nome-topico" style="color:'+topico.cor+'">'+escapeHTML(topico.nome)+'</span>';
      html += '<span style="margin-left:auto;display:flex;gap:4px;">';
      html += '<button class="icone-btn" data-acao="editar-topico" data-topico="'+topico.id+'" title="Editar tópico">✎</button>';
      html += '<button class="icone-btn" data-acao="excluir-topico" data-topico="'+topico.id+'" title="Excluir tópico">🗑</button>';
      html += '</span></div>';

      if(tarefasDoTopico.length===0){
        html += '<p style="color:var(--ink-soft);font-size:0.88rem;margin:6px 0 0;">Nenhuma tarefa neste tópico ainda.</p>';
      }else{
        html += '<ul class="lista-tarefas">';
        tarefasDoTopico.forEach(function(t){
          html += renderItemTarefa(t, hojeISO(), true);
        });
        html += '</ul>';
      }
      html += '</div>';
    });
    return html;
  }

  /* ---------- VIEW: CALENDÁRIO ---------- */
  function renderCalendario(){
    var mes = estado.mesCalendario;
    var ano = mes.getFullYear(), mesIdx = mes.getMonth();
    var primeiroDia = new Date(ano, mesIdx, 1);
    var ultimoDia = new Date(ano, mesIdx+1, 0);
    var diaSemanaInicio = primeiroDia.getDay();
    var totalDias = ultimoDia.getDate();
    var iso = hojeISO();

    var html = '<div class="cartao">';
    html += '<div class="cabecalho-calendario">';
    html += '<button class="btn fantasma pequeno" data-acao="mes-anterior">‹</button>';
    html += '<span class="mes-atual">'+NOMES_MESES[mesIdx]+' de '+ano+'</span>';
    html += '<button class="btn fantasma pequeno" data-acao="mes-proximo">›</button>';
    html += '</div>';

    if(estado.topicos.length===0){
      html += estadoVazio("📅","Seu calendário está vazio","Crie tópicos e tarefas para ver seus compromissos aqui.",
        '<button class="btn" data-acao="abrir-modal-topico">Criar tópico</button>');
      html += '</div>';
      return html;
    }

    html += '<div class="grade-semana">';
    NOMES_DIAS.forEach(function(d){ html += '<div class="rotulo-dia">'+d+'</div>'; });
    html += '</div>';

    html += '<div class="grade-mes">';
    for(var i=0;i<diaSemanaInicio;i++){
      var diaAnteriorNum = new Date(ano, mesIdx, i - diaSemanaInicio + 1).getDate();
      html += '<div class="celula-dia fora-mes"><span class="num-dia">'+diaAnteriorNum+'</span></div>';
    }
    for(var dia=1; dia<=totalDias; dia++){
      var dataAtual = new Date(ano, mesIdx, dia);
      var dataISO = paraISO(dataAtual);
      var ehHoje = dataISO === iso;
      var tarefasDoDia = estado.tarefas.filter(function(t){ return tarefaOcorreEm(t, dataISO); });
      var topicosUnicos = [];
      tarefasDoDia.forEach(function(t){
        if(topicosUnicos.indexOf(t.topicoId)===-1) topicosUnicos.push(t.topicoId);
      });
      html += '<div class="celula-dia '+(ehHoje?"hoje":"")+'">';
      html += '<button class="clique-dia" data-acao="selecionar-dia" data-data="'+dataISO+'"></button>';
      html += '<span class="num-dia">'+dia+'</span>';
      html += '<div class="pontos-dia">';
      topicosUnicos.slice(0,5).forEach(function(tid){
        var tp = topicoPorId(tid);
        if(tp) html += '<span class="ponto" style="background:'+tp.cor+'"></span>';
      });
      html += '</div></div>';
    }
    var totalCelulas = diaSemanaInicio + totalDias;
    var restante = (7 - (totalCelulas % 7)) % 7;
    for(var j=1;j<=restante;j++){
      html += '<div class="celula-dia fora-mes"><span class="num-dia">'+j+'</span></div>';
    }
    html += '</div></div>';

    if(estado.diaSelecionadoCalendario){
      html += renderPainelDiaSelecionado(estado.diaSelecionadoCalendario);
    }

    return html;
  }

  function renderPainelDiaSelecionado(dataISO){
    var d = new Date(dataISO+"T00:00:00");
    var diasSemanaLongo = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
    var titulo = diasSemanaLongo[d.getDay()]+", "+d.getDate()+" de "+NOMES_MESES[d.getMonth()];
    var tarefasDoDia = estado.tarefas.filter(function(t){ return tarefaOcorreEm(t, dataISO); });
    var html = '<div class="cartao">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    html += '<h2 class="titulo-secao" style="text-transform:capitalize;">'+titulo+'</h2>';
    html += '<button class="icone-btn" data-acao="fechar-painel-dia">✕</button>';
    html += '</div>';
    if(tarefasDoDia.length===0){
      html += '<p style="color:var(--ink-soft);font-size:0.9rem;">Nenhuma tarefa para este dia.</p>';
    }else{
      html += '<ul class="lista-tarefas">';
      tarefasDoDia.forEach(function(t){ html += renderItemTarefa(t, dataISO, true); });
      html += '</ul>';
    }
    html += '</div>';
    return html;
  }

  /* ---------- VIEW: EVOLUÇÃO ---------- */
  function renderEvolucao(){
    if(estado.topicos.length===0){
      return '<div class="cartao">' + estadoVazio(
        "📈","Ainda não há dados de evolução",
        "Crie tópicos e conclua tarefas para acompanhar seu progresso e sequências aqui.",
        '<button class="btn" data-acao="abrir-modal-topico">Criar tópico</button>'
      ) + '</div>';
    }

    if(!estado.topicoEvolucaoId || !topicoPorId(estado.topicoEvolucaoId)){
      estado.topicoEvolucaoId = estado.topicos[0].id;
    }

    var html = '<div class="cartao">';
    html += '<h2 class="titulo-secao">Evolução</h2>';
    html += '<p class="sub-secao">Acompanhe sua constância em cada tópico</p>';
    html += '<div class="abas-topico-evolucao">';
    estado.topicos.forEach(function(t){
      var ativo = t.id === estado.topicoEvolucaoId;
      html += '<button class="chip-topico '+(ativo?"ativo":"")+'" data-acao="selecionar-topico-evolucao" data-topico="'+t.id+'">'+t.icone+' '+escapeHTML(t.nome)+'</button>';
    });
    html += '</div>';

    var topico = topicoPorId(estado.topicoEvolucaoId);
    var tarefasDoTopico = estado.tarefas.filter(function(t){ return t.topicoId===topico.id; });

    if(tarefasDoTopico.length===0){
      html += estadoVazio("🗒️","Nenhuma tarefa neste tópico","Adicione tarefas a este tópico para começar a ver sua evolução.",
        '<button class="btn" data-acao="abrir-modal-tarefa">Nova tarefa</button>');
      html += '</div>';
      return html;
    }

    var stats = calcularEstatisticasTopico(topico.id, tarefasDoTopico);

    html += '<div class="estatisticas">';
    html += '<div class="estat"><div class="valor">'+stats.sequenciaAtual+'</div><div class="rotulo">Sequência atual</div></div>';
    html += '<div class="estat"><div class="valor">'+stats.melhorSequencia+'</div><div class="rotulo">Melhor sequência</div></div>';
    html += '<div class="estat"><div class="valor">'+stats.taxaConclusao+'%</div><div class="rotulo">Taxa de conclusão (12 sem.)</div></div>';
    html += '</div>';

    html += renderHeatmap(topico.id, tarefasDoTopico, topico.cor);

    html += '</div>';
    return html;
  }

  function diaTemTarefaPrevista(tarefasDoTopico, dataISO){
    return tarefasDoTopico.some(function(t){ return tarefaOcorreEm(t, dataISO); });
  }
  function diaTotalmenteConcluido(tarefasDoTopico, dataISO){
    var previstas = tarefasDoTopico.filter(function(t){ return tarefaOcorreEm(t, dataISO); });
    if(previstas.length===0) return false;
    return previstas.every(function(t){ return concluidaEm(t.id, dataISO); });
  }

  function calcularEstatisticasTopico(topicoId, tarefasDoTopico){
    var hoje = new Date(); hoje.setHours(0,0,0,0);
    var sequenciaAtual = 0, melhorSequencia = 0, seqTemp = 0;
    var previstosTotal = 0, concluidosTotal = 0;

    // 84 dias (12 semanas) para trás
    var dias = [];
    for(var i=83;i>=0;i--){
      var d = new Date(hoje); d.setDate(d.getDate()-i);
      dias.push(paraISO(d));
    }
    dias.forEach(function(dataISO){
      var previsto = diaTemTarefaPrevista(tarefasDoTopico, dataISO);
      var concluido = diaTotalmenteConcluido(tarefasDoTopico, dataISO);
      if(previsto){ previstosTotal++; if(concluido) concluidosTotal++; }
    });

    // sequência atual: contar retroativamente a partir de hoje enquanto dias previstos estiverem concluídos
    for(var i=dias.length-1;i>=0;i--){
      var dataISO = dias[i];
      var previsto = diaTemTarefaPrevista(tarefasDoTopico, dataISO);
      if(!previsto) continue; // dias sem previsão não quebram a sequência
      var concluido = diaTotalmenteConcluido(tarefasDoTopico, dataISO);
      if(concluido){ sequenciaAtual++; } else { break; }
    }
    // melhor sequência histórica
    dias.forEach(function(dataISO){
      var previsto = diaTemTarefaPrevista(tarefasDoTopico, dataISO);
      if(!previsto) return;
      var concluido = diaTotalmenteConcluido(tarefasDoTopico, dataISO);
      if(concluido){ seqTemp++; melhorSequencia = Math.max(melhorSequencia, seqTemp); }
      else { seqTemp = 0; }
    });

    var taxa = previstosTotal>0 ? Math.round((concluidosTotal/previstosTotal)*100) : 0;
    return {sequenciaAtual:sequenciaAtual, melhorSequencia:melhorSequencia, taxaConclusao:taxa};
  }

  function renderHeatmap(topicoId, tarefasDoTopico, cor){
    var hoje = new Date(); hoje.setHours(0,0,0,0);
    var diaSemanaHoje = hoje.getDay();
    var fimGrade = new Date(hoje); fimGrade.setDate(fimGrade.getDate() + (6 - diaSemanaHoje));
    var totalSemanas = 12;
    var inicioGrade = new Date(fimGrade); inicioGrade.setDate(inicioGrade.getDate() - (totalSemanas*7 - 1));

    var html = '<div class="heatmap">';
    var cursor = new Date(inicioGrade);
    for(var s=0; s<totalSemanas; s++){
      html += '<div class="coluna-semana">';
      for(var d=0; d<7; d++){
        var dataISO = paraISO(cursor);
        var noFuturo = cursor > hoje;
        var cls = "quadrado-dia";
        var estilo = "";
        if(!noFuturo){
          var previsto = diaTemTarefaPrevista(tarefasDoTopico, dataISO);
          if(previsto){
            var concluido = diaTotalmenteConcluido(tarefasDoTopico, dataISO);
            estilo = concluido ? ("background:"+cor) : ("background:"+cor+"33");
          }
        } else {
          estilo = "opacity:0.25";
        }
        html += '<div class="'+cls+'" style="'+estilo+'" title="'+dataISO+'"></div>';
        cursor.setDate(cursor.getDate()+1);
      }
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="legenda-heatmap"><span>Menos</span><div class="quadrado-dia" style="background:var(--surface-alt)"></div><div class="quadrado-dia" style="background:'+cor+'33"></div><div class="quadrado-dia" style="background:'+cor+'"></div><span>Mais</span></div>';
    return html;
  }

  /* ---------- Estado vazio (helper) ---------- */
  function estadoVazio(icone, titulo, texto, acaoHtml){
    return '<div class="vazio"><span class="icone-vazio">'+icone+'</span><strong>'+titulo+'</strong><span>'+texto+'</span>'+(acaoHtml||"")+'</div>';
  }

  /* ---------- Modais ---------- */
  function renderModal(){
    var m = estado.modal;
    if(m.tipo === "topico") return renderModalTopico(m.dados);
    if(m.tipo === "tarefa") return renderModalTarefa(m.dados);
    if(m.tipo === "confirmar") return renderModalConfirmar(m.dados);
    return "";
  }

  function renderModalTopico(dados){
    var editando = !!dados.id;
    var cor = dados.cor || PALETA_CORES[0];
    var icone = dados.icone || PALETA_ICONES[0];
    var html = '<div class="fundo-modal" data-acao="fechar-modal-fundo"><div class="modal" onclick="event.stopPropagation()">';
    html += '<h3>'+(editando?"Editar tópico":"Novo tópico")+'</h3>';
    html += '<div class="campo"><label>Nome</label><input type="text" id="campo-nome-topico" value="'+escapeAttr(dados.nome||"")+'" placeholder="Ex: Faculdade, Treinos, Casa..."></div>';
    html += '<div class="campo"><label>Cor</label><div class="grade-cores">';
    PALETA_CORES.forEach(function(c){
      html += '<button class="amostra-cor '+(c===cor?"selecionada":"")+'" style="background:'+c+'" data-acao="escolher-cor-topico" data-cor="'+c+'"></button>';
    });
    html += '</div></div>';
    html += '<div class="campo"><label>Ícone</label><div class="grade-icones">';
    PALETA_ICONES.forEach(function(ic){
      html += '<button class="amostra-icone '+(ic===icone?"selecionada":"")+'" data-acao="escolher-icone-topico" data-icone="'+ic+'">'+ic+'</button>';
    });
    html += '</div></div>';
    html += '<div class="acoes-modal">';
    html += '<button class="btn secundario" data-acao="fechar-modal">Cancelar</button>';
    html += '<button class="btn" data-acao="salvar-topico">'+(editando?"Salvar":"Criar tópico")+'</button>';
    html += '</div></div></div>';
    return html;
  }

  function renderModalTarefa(dados){
    var editando = !!dados.id;
    var recorrencia = dados.recorrencia || "unica";
    var diasSemana = dados.diasSemana || [];
    var html = '<div class="fundo-modal" data-acao="fechar-modal-fundo"><div class="modal" onclick="event.stopPropagation()">';
    html += '<h3>'+(editando?"Editar tarefa":"Nova tarefa")+'</h3>';
    html += '<div class="campo"><label>Título</label><input type="text" id="campo-titulo-tarefa" value="'+escapeAttr(dados.titulo||"")+'" placeholder="Ex: Tomar vitamina D"></div>';
    html += '<div class="campo"><label>Tópico</label><select id="campo-topico-tarefa" class="seletor-topico-form">';
    estado.topicos.forEach(function(t){
      html += '<option value="'+t.id+'" '+(dados.topicoId===t.id?"selected":"")+'>'+t.icone+' '+escapeHTML(t.nome)+'</option>';
    });
    html += '</select></div>';

    html += '<div class="campo"><label>Repetição</label><select id="campo-recorrencia-tarefa">';
    html += '<option value="unica" '+(recorrencia==="unica"?"selected":"")+'>Uma vez</option>';
    html += '<option value="diaria" '+(recorrencia==="diaria"?"selected":"")+'>Todos os dias</option>';
    html += '<option value="semanal" '+(recorrencia==="semanal"?"selected":"")+'>Dias específicos da semana</option>';
    html += '</select></div>';

    html += '<div class="campo" id="campo-data-unica-wrap" style="display:'+(recorrencia==="unica"?"block":"none")+'">';
    html += '<label>Data</label><input type="date" id="campo-data-unica" value="'+(dados.dataUnica||hojeISO())+'">';
    html += '</div>';

    html += '<div class="campo" id="campo-dias-semana-wrap" style="display:'+(recorrencia==="semanal"?"block":"none")+'">';
    html += '<label>Dias da semana</label><div class="dias-semana">';
    NOMES_DIAS.forEach(function(nome, idx){
      html += '<button type="button" class="dia-toggle '+(diasSemana.indexOf(idx)!==-1?"selecionado":"")+'" data-acao="alternar-dia-semana" data-dia="'+idx+'">'+nome+'</button>';
    });
    html += '</div></div>';

    html += '<div class="campo"><label>Horário (opcional)</label><input type="time" id="campo-horario-tarefa" value="'+(dados.horario||"")+'"></div>';

    html += '<div class="acoes-modal">';
    html += '<button class="btn secundario" data-acao="fechar-modal">Cancelar</button>';
    html += '<button class="btn" data-acao="salvar-tarefa">'+(editando?"Salvar":"Criar tarefa")+'</button>';
    html += '</div></div></div>';
    return html;
  }

  function renderModalConfirmar(dados){
    var html = '<div class="fundo-modal" data-acao="fechar-modal-fundo"><div class="modal" onclick="event.stopPropagation()">';
    html += '<h3>'+escapeHTML(dados.titulo)+'</h3>';
    html += '<p style="color:var(--ink-soft);font-size:0.92rem;">'+escapeHTML(dados.mensagem)+'</p>';
    html += '<div class="acoes-modal">';
    html += '<button class="btn secundario" data-acao="fechar-modal">Cancelar</button>';
    html += '<button class="btn perigo" data-acao="confirmar-acao">Excluir</button>';
    html += '</div></div></div>';
    return html;
  }

  /* ---------- Escape helpers ---------- */
  function escapeHTML(str){
    return String(str==null?"":str).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function escapeAttr(str){ return escapeHTML(str); }

  /* ---------- Eventos ---------- */
  function ligarEventos(){
    var app = document.getElementById("app");

    app.querySelectorAll("[data-acao], [data-aba]").forEach(function(el){
      el.addEventListener("click", function(ev){
        var acao = el.getAttribute("data-acao");
        manipularAcao(acao, el, ev);
      });
    });

    var selRec = document.getElementById("campo-recorrencia-tarefa");
    if(selRec){
      selRec.addEventListener("change", function(){
        var wrapUnica = document.getElementById("campo-data-unica-wrap");
        var wrapSemanal = document.getElementById("campo-dias-semana-wrap");
        wrapUnica.style.display = selRec.value==="unica" ? "block":"none";
        wrapSemanal.style.display = selRec.value==="semanal" ? "block":"none";
      });
    }
  }

  function estadoModalAtualDados(){
    return estado.modal ? estado.modal.dados : {};
  }

  function manipularAcao(acao, el, ev){
    if(acao === "fechar-modal-fundo" && ev.target !== el) return; // clique dentro do modal não fecha

    switch(acao){
      case "hoje": case "tarefas": case "calendario": case "evolucao":
        break;
    }

    if(el.hasAttribute && el.hasAttribute("data-aba")){
      estado.abaAtiva = el.getAttribute("data-aba");
      estado.diaSelecionadoCalendario = null;
      render();
      return;
    }

    switch(acao){
      case "entrar-google":
        entrarComGoogle(); break;
      case "sair":
        if(auth) auth.signOut(); break;
      case "ir-tarefas":
        estado.abaAtiva = "tarefas"; render(); break;

      case "abrir-modal-topico":
        var idTopico = el.getAttribute("data-topico");
        var topicoExistente = idTopico ? topicoPorId(idTopico) : null;
        estado.modal = {tipo:"topico", dados: topicoExistente ? Object.assign({}, topicoExistente) : {}};
        render(); break;

      case "editar-topico":
        var tId = el.getAttribute("data-topico");
        var tp = topicoPorId(tId);
        estado.modal = {tipo:"topico", dados: Object.assign({}, tp)};
        render(); break;

      case "escolher-cor-topico":
        estadoModalAtualDados().cor = el.getAttribute("data-cor");
        render(); break;

      case "escolher-icone-topico":
        estadoModalAtualDados().icone = el.getAttribute("data-icone");
        render(); break;

      case "salvar-topico":
        salvarTopico(); break;

      case "excluir-topico":
        var idExcluir = el.getAttribute("data-topico");
        var topicoAExcluir = topicoPorId(idExcluir);
        var qtdTarefas = estado.tarefas.filter(function(t){return t.topicoId===idExcluir;}).length;
        estado.modal = {tipo:"confirmar", dados:{
          titulo:"Excluir tópico?",
          mensagem: "O tópico \""+topicoAExcluir.nome+"\" será excluído"+(qtdTarefas>0?" junto com "+qtdTarefas+" tarefa(s) relacionada(s)":"")+". Essa ação não pode ser desfeita.",
          aoConfirmar: function(){ excluirTopico(idExcluir); }
        }};
        render(); break;

      case "abrir-modal-tarefa":
        if(estado.topicos.length===0) return;
        var dadosPadrao = {topicoId: estado.topicoEvolucaoId || estado.topicos[0].id, recorrencia:"unica", dataUnica:hojeISO()};
        estado.modal = {tipo:"tarefa", dados:dadosPadrao};
        render(); break;

      case "editar-tarefa":
        var idT = el.getAttribute("data-tarefa");
        var tarefaExistente = estado.tarefas.filter(function(t){return t.id===idT;})[0];
        estado.modal = {tipo:"tarefa", dados: Object.assign({}, tarefaExistente, {diasSemana:(tarefaExistente.diasSemana||[]).slice()})};
        render(); break;

      case "alternar-dia-semana":
        var dados = estadoModalAtualDados();
        dados.diasSemana = dados.diasSemana || [];
        var diaNum = parseInt(el.getAttribute("data-dia"),10);
        var pos = dados.diasSemana.indexOf(diaNum);
        if(pos===-1) dados.diasSemana.push(diaNum); else dados.diasSemana.splice(pos,1);
        render(); break;

      case "salvar-tarefa":
        salvarTarefa(); break;

      case "excluir-tarefa":
        var idExc = el.getAttribute("data-tarefa");
        estado.modal = {tipo:"confirmar", dados:{
          titulo:"Excluir tarefa?",
          mensagem:"Esta tarefa e seu histórico de conclusões serão excluídos. Essa ação não pode ser desfeita.",
          aoConfirmar: function(){ excluirTarefa(idExc); }
        }};
        render(); break;

      case "confirmar-acao":
        if(estado.modal && estado.modal.dados.aoConfirmar) estado.modal.dados.aoConfirmar();
        estado.modal = null;
        render(); break;

      case "fechar-modal":
      case "fechar-modal-fundo":
        estado.modal = null; render(); break;

      case "alternar-conclusao":
        var tarefaId = el.getAttribute("data-tarefa");
        var dataISO = el.getAttribute("data-data");
        var chave = chaveConclusao(tarefaId, dataISO);
        if(estado.conclusoes[chave]) delete estado.conclusoes[chave];
        else estado.conclusoes[chave] = true;
        persistirTudo();
        render(); break;

      case "mes-anterior":
        estado.mesCalendario = new Date(estado.mesCalendario.getFullYear(), estado.mesCalendario.getMonth()-1, 1);
        estado.diaSelecionadoCalendario = null;
        render(); break;
      case "mes-proximo":
        estado.mesCalendario = new Date(estado.mesCalendario.getFullYear(), estado.mesCalendario.getMonth()+1, 1);
        estado.diaSelecionadoCalendario = null;
        render(); break;

      case "selecionar-dia":
        estado.diaSelecionadoCalendario = el.getAttribute("data-data");
        render(); break;
      case "fechar-painel-dia":
        estado.diaSelecionadoCalendario = null; render(); break;

      case "selecionar-topico-evolucao":
        estado.topicoEvolucaoId = el.getAttribute("data-topico");
        render(); break;
    }
  }

  function salvarTopico(){
    var dados = estadoModalAtualDados();
    var nomeInput = document.getElementById("campo-nome-topico");
    var nome = nomeInput.value.trim();
    if(!nome){ nomeInput.focus(); nomeInput.style.borderColor = "var(--danger)"; return; }
    var cor = dados.cor || PALETA_CORES[0];
    var icone = dados.icone || PALETA_ICONES[0];

    if(dados.id){
      var topico = topicoPorId(dados.id);
      topico.nome = nome; topico.cor = cor; topico.icone = icone;
    } else {
      estado.topicos.push({id:gerarId(), nome:nome, cor:cor, icone:icone});
    }
    persistirTudo();
    estado.modal = null;
    render();
  }

  function excluirTopico(id){
    estado.topicos = estado.topicos.filter(function(t){return t.id!==id;});
    var idsRemovidos = estado.tarefas.filter(function(t){return t.topicoId===id;}).map(function(t){return t.id;});
    estado.tarefas = estado.tarefas.filter(function(t){return t.topicoId!==id;});
    idsRemovidos.forEach(function(tid){
      Object.keys(estado.conclusoes).forEach(function(chave){
        if(chave.indexOf(tid+"_")===0) delete estado.conclusoes[chave];
      });
    });
    if(estado.topicoEvolucaoId===id) estado.topicoEvolucaoId = null;
    persistirTudo();
  }

  function salvarTarefa(){
    var dados = estadoModalAtualDados();
    var tituloInput = document.getElementById("campo-titulo-tarefa");
    var titulo = tituloInput.value.trim();
    if(!titulo){ tituloInput.focus(); tituloInput.style.borderColor = "var(--danger)"; return; }
    var topicoId = document.getElementById("campo-topico-tarefa").value;
    var recorrencia = document.getElementById("campo-recorrencia-tarefa").value;
    var horario = document.getElementById("campo-horario-tarefa").value;
    var dataUnica = document.getElementById("campo-data-unica").value;
    var diasSemana = dados.diasSemana || [];

    if(recorrencia==="semanal" && diasSemana.length===0){
      alert("Selecione ao menos um dia da semana.");
      return;
    }

    var payload = {
      titulo: titulo, topicoId: topicoId, recorrencia: recorrencia,
      horario: horario || null,
      dataUnica: recorrencia==="unica" ? (dataUnica || hojeISO()) : null,
      diasSemana: recorrencia==="semanal" ? diasSemana.slice() : []
    };

    if(dados.id){
      var idx = estado.tarefas.findIndex(function(t){return t.id===dados.id;});
      estado.tarefas[idx] = Object.assign({id:dados.id, criadaEm:estado.tarefas[idx].criadaEm}, payload);
    } else {
      payload.id = gerarId();
      payload.criadaEm = Date.now();
      estado.tarefas.push(payload);
    }
    persistirTudo();
    estado.modal = null;
    render();
  }

  function excluirTarefa(id){
    estado.tarefas = estado.tarefas.filter(function(t){return t.id!==id;});
    Object.keys(estado.conclusoes).forEach(function(chave){
      if(chave.indexOf(id+"_")===0) delete estado.conclusoes[chave];
    });
    persistirTudo();
  }

  async function entrarComGoogle(){
    try{
      var provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    }catch(e){
      console.error(e);
      alert("Não foi possível entrar com o Google. Verifique se o provedor Google está ativado no Firebase Authentication.");
    }
  }

  function iniciarFirebase(){
    try{
      if(!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey || String(window.FIREBASE_CONFIG.apiKey).indexOf("COLE_")===0){
        inicializando=false; erroConfiguracao=true; render(); return;
      }
      firebaseApp = firebase.initializeApp(window.FIREBASE_CONFIG);
      auth = firebase.auth(); db = firebase.firestore();
      auth.onAuthStateChanged(async function(user){
        usuarioAtual=user||null;
        if(user){
          try{ await carregarDaNuvem(user); }catch(e){ console.error(e); statusSync="erro"; }
        }
        inicializando=false; render();
      });
    }catch(e){ console.error(e); inicializando=false; erroConfiguracao=true; render(); }
  }

  /* ---------- Início ---------- */
  render();
  iniciarFirebase();
})();
