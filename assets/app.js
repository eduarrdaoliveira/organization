(function(){
  "use strict";

  /* ---------- Constantes ---------- */
  var CHAVE_TOPICOS = "organizador_topicos_v1";
  var CHAVE_TAREFAS = "organizador_tarefas_v1";
  var CHAVE_CONCLUSOES = "organizador_conclusoes_v1";

  var TONS_CINZA = ["#1c1c1e","#48484a","#6e6e73","#8e8e93","#aeaeb2","#c7c7cc"];

  /* ---------- Ícones (SVG inline, sem emoji) ---------- */
  var ICONES = {
    check:'<svg class="icone" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    plus:'<svg class="icone" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    x:'<svg class="icone" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    chevronLeft:'<svg class="icone" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    chevronRight:'<svg class="icone" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
    pencil:'<svg class="icone" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash:'<svg class="icone" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>',
    circlePlus:'<svg class="icone" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    clipboard:'<svg class="icone" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6M9 15h6"/></svg>',
    sun:'<svg class="icone" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>',
    calendar:'<svg class="icone" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
    chart:'<svg class="icone" viewBox="0 0 24 24"><path d="M5 19V10M12 19V5M19 19v-7"/></svg>',
    checkCircle:'<svg class="icone" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.3l2.4 2.4 4.6-5.2"/></svg>'
  };
  function ic(nome){ return ICONES[nome] || ""; }
  function iniciais(nome){
    var n = (nome||"?").trim();
    return n ? n.charAt(0).toUpperCase() : "?";
  }

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
    topicos: migrarTonsTopicos(carregar(CHAVE_TOPICOS, [])),
    tarefas: carregar(CHAVE_TAREFAS, []),
    conclusoes: carregar(CHAVE_CONCLUSOES, {}), // { "tarefaId_YYYY-MM-DD": true }
    mesCalendario: new Date(),
    diaSelecionadoCalendario: null,
    topicoEvolucaoId: null,
    topicosAbertos: {},
    modal: null // {tipo:'topico'|'tarefa'|'diaCalendario', dados:{...}}
  };

  function migrarTonsTopicos(lista){
    if(!Array.isArray(lista)) return [];
    return lista.map(function(t, i){
      if(!t || typeof t !== "object") return t;
      if(TONS_CINZA.indexOf(t.cor) === -1){
        t.cor = TONS_CINZA[i % TONS_CINZA.length];
      }
      return t;
    });
  }

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
    // remove valores "undefined" (o Firestore rejeita e derruba a gravação inteira)
    return JSON.parse(JSON.stringify({topicos:estado.topicos,tarefas:estado.tarefas,conclusoes:estado.conclusoes,atualizadoEm:Date.now()}));
  }

  var tentativasFalhas = 0;

  function agendarSincronizacao(){
    if(!usuarioAtual || !db) return;
    statusSync = "salvando";
    render();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function(){ tentarSincronizar(0); }, 350);
  }

  function tentarSincronizar(tentativa){
    db.collection("usuarios").doc(usuarioAtual.uid).set(dadosAtuais(), {merge:true}).then(function(){
      tentativasFalhas = 0;
      statusSync = "salvo";
      render();
    }).catch(function(e){
      console.error("Erro ao sincronizar com o Firestore:", e);
      if(tentativa < 2){
        setTimeout(function(){ tentarSincronizar(tentativa+1); }, 1500);
      } else {
        tentativasFalhas++;
        statusSync = "erro";
        render();
      }
    });
  }

  async function carregarDaNuvem(user){
    var ref = db.collection("usuarios").doc(user.uid);
    var snap = await ref.get();
    if(snap.exists){
      var d=snap.data()||{};
      estado.topicos=migrarTonsTopicos(Array.isArray(d.topicos)?d.topicos:[]);
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
  function renderConfigPendente(){ return '<main class="tela-central"><section class="login-card"><div class="app-icon">'+ic("checkCircle")+'</div><h1>Conecte ao Firebase</h1><p>Preencha o arquivo <strong>assets/firebase-config.js</strong> com as credenciais do seu projeto Firebase.</p><div class="aviso-ios">O pacote inclui um guia completo no README.</div></section></main>'; }
  function renderLogin(){ return '<main class="tela-central"><section class="login-card"><div class="app-icon">'+ic("checkCircle")+'</div><h1>Meu Organizador</h1><p>Suas tarefas, calendário e progresso sincronizados em todos os dispositivos.</p><button class="btn-login-google" data-acao="entrar-google"><span class="google-g">G</span>Continuar com Google</button><small>Os dados ficam vinculados à sua conta.</small></section></main>'; }

  /* ---------- Render raiz ---------- */
  function render(){
    var app = document.getElementById("app");
    if(inicializando){ app.innerHTML=renderCarregando(); return; }
    if(erroConfiguracao){ app.innerHTML=renderConfigPendente(); return; }
    if(!usuarioAtual){ app.innerHTML=renderLogin(); return; }

    try{
      var html = "";
      html += renderHeader();
      html += renderNav();
      html += '<div id="conteudo-view">';
      if(estado.abaAtiva === "hoje") html += renderHoje();
      else if(estado.abaAtiva === "tarefas") html += renderTarefas();
      else if(estado.abaAtiva === "calendario") html += renderCalendario();
      else if(estado.abaAtiva === "evolucao") html += renderEvolucao();
      else html += renderHoje();
      html += '</div>';
      if(estado.modal){ html += renderModal(); }
      app.innerHTML = html;
    }catch(e){
      console.error("Erro ao renderizar:", e);
      app.innerHTML = renderHeader() + renderNav() + '<div class="erro-app"><h2>Algo não carregou direito</h2><p>Houve um problema ao mostrar esta tela. Toque para tentar novamente.</p><button class="btn" data-acao="tentar-novamente">Tentar novamente</button></div>';
    }
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
        "circlePlus","Comece criando seus tópicos",
        "Crie tópicos como Faculdade, Estágio, Treinos ou Vitaminas para organizar suas tarefas.",
        '<button class="btn" data-acao="abrir-modal-topico">Criar primeiro tópico</button>'
      ) + '</div>';
    }
    var iso = hojeISO();
    var tarefasHoje = estado.tarefas.filter(function(t){ return tarefaOcorreEm(t, iso); });

    if(estado.tarefas.length===0){
      return '<div class="cartao">' + estadoVazio(
        "clipboard","Nenhuma tarefa cadastrada ainda",
        "Adicione suas tarefas do dia a dia na aba Tarefas para vê-las aparecer aqui.",
        '<button class="btn" data-acao="ir-tarefas">Ir para Tarefas</button>'
      ) + '</div>';
    }

    if(tarefasHoje.length===0){
      return '<div class="cartao">' + estadoVazio(
        "sun","Nada agendado para hoje",
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

  function renderItemTarefa(tarefa, dataISO, mostrarAvatarTopico){
    var topico = topicoPorId(tarefa.topicoId);
    var marcada = concluidaEm(tarefa.id, dataISO);
    var corTopico = topico ? topico.cor : "#999";
    var html = '<li class="item-tarefa '+(marcada?"concluida":"")+'">';
    html += '<button class="check '+(marcada?"marcado":"")+'" data-acao="alternar-conclusao" data-tarefa="'+tarefa.id+'" data-data="'+dataISO+'" aria-label="'+(marcada?'Desmarcar tarefa':'Concluir tarefa')+'">'+(marcada?ic("check"):"")+'</button>';
    html += '<div class="conteudo linha-tarefa">';
    html += '<span class="titulo-tarefa">'+escapeHTML(tarefa.titulo)+'</span>';
    if(topico){
      var avatarHtml = mostrarAvatarTopico ? ('<span class="avatar-topico" style="background:'+corTopico+'">'+escapeHTML(iniciais(topico.nome))+'</span>') : '';
      html += '<span class="pilula-topico" style="background:'+corTopico+'14;color:'+corTopico+'">'+avatarHtml+escapeHTML(topico.nome)+'</span>';
    }
    if(tarefa.recorrencia==="diaria") html += '<span class="info-recorrencia">Diária</span>';
    if(tarefa.recorrencia==="semanal") html += '<span class="info-recorrencia">'+(tarefa.diasSemana||[]).map(function(n){return NOMES_DIAS[n];}).join(", ")+'</span>';
    if(tarefa.horario) html += '<span class="info-horario">'+tarefa.horario+'</span>';
    html += '</div>';
    html += '<div class="acoes-tarefa">';
    html += '<button class="icone-btn" data-acao="editar-tarefa" data-tarefa="'+tarefa.id+'" title="Editar">'+ic("pencil")+'</button>';
    html += '<button class="icone-btn" data-acao="excluir-tarefa" data-tarefa="'+tarefa.id+'" title="Excluir">'+ic("trash")+'</button>';
    html += '</div>';
    html += '</li>';
    return html;
  }

  /* ---------- VIEW: TAREFAS ---------- */
  function renderTarefas(){
    var html = '';
    html += '<div class="cartao">';
    html += '<div class="cabecalho-pagina-tarefas">';
    html += '<div><h2 class="titulo-secao">Tarefas por tópico</h2><p class="sub-secao" style="margin-bottom:0">Toque em um tópico para abrir ou recolher sua lista</p></div>';
    html += '<button class="btn secundario" data-acao="abrir-modal-topico">+ Tópico</button>';
    html += '</div></div>';

    if(estado.topicos.length===0){
      html += '<div class="cartao">' + estadoVazio(
        "circlePlus","Nenhum tópico criado ainda",
        "Tópicos ajudam a separar sua rotina: Faculdade, Estágio, Treinos, Vitaminas, Casa...",
        '<button class="btn" data-acao="abrir-modal-topico">Criar tópico</button>'
      ) + '</div>';
      return html;
    }

    html += '<div class="lista-topicos-alternantes">';
    estado.topicos.forEach(function(topico){
      var tarefasDoTopico = estado.tarefas.filter(function(t){ return t.topicoId===topico.id; });
      var aberto = estado.topicosAbertos[topico.id] !== false;
      html += '<section class="cartao grupo-topico '+(aberto?'aberto':'fechado')+'">';
      html += '<div class="cabecalho-grupo">';
      html += '<button class="alternador-topico" data-acao="alternar-topico" data-topico="'+topico.id+'" aria-expanded="'+aberto+'">';
      html += '<span class="seta-alternador">'+ic("chevronRight")+'</span><span class="avatar-topico" style="background:'+topico.cor+'">'+escapeHTML(iniciais(topico.nome))+'</span>';
      html += '<span class="nome-topico" style="color:'+topico.cor+'">'+escapeHTML(topico.nome)+'</span>';
      html += '<span class="contador-topico">'+tarefasDoTopico.length+'</span></button>';
      html += '<div class="acoes-topico">';
      html += '<button class="btn-add-tarefa-topico" data-acao="abrir-modal-tarefa" data-topico="'+topico.id+'" title="Adicionar tarefa">＋ Tarefa</button>';
      html += '<button class="icone-btn" data-acao="editar-topico" data-topico="'+topico.id+'" title="Editar tópico">'+ic("pencil")+'</button>';
      html += '<button class="icone-btn" data-acao="excluir-topico" data-topico="'+topico.id+'" title="Excluir tópico">'+ic("trash")+'</button>';
      html += '</div></div>';
      if(aberto){
        html += '<div class="conteudo-topico">';
        if(tarefasDoTopico.length===0){
          html += '<div class="topico-sem-tarefas"><span>Nenhuma tarefa neste tópico.</span><button data-acao="abrir-modal-tarefa" data-topico="'+topico.id+'">Adicionar primeira tarefa</button></div>';
        }else{
          html += '<ul class="lista-tarefas">';
          tarefasDoTopico.forEach(function(t){ html += renderItemTarefa(t, hojeISO(), true); });
          html += '</ul>';
        }
        html += '</div>';
      }
      html += '</section>';
    });
    html += '</div>';
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
    html += '<button class="btn fantasma pequeno" data-acao="mes-anterior">'+ic("chevronLeft")+'</button>';
    html += '<span class="mes-atual">'+NOMES_MESES[mesIdx]+' de '+ano+'</span>';
    html += '<button class="btn fantasma pequeno" data-acao="mes-proximo">'+ic("chevronRight")+'</button>';
    html += '</div>';

    if(estado.topicos.length===0){
      html += estadoVazio("calendar","Seu calendário está vazio","Crie tópicos e tarefas para ver seus compromissos aqui.",
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
    html += '<button class="icone-btn" data-acao="fechar-painel-dia">'+ic("x")+'</button>';
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
        "chart","Ainda não há dados de evolução",
        "Crie tópicos e conclua tarefas para acompanhar seu progresso e sequências aqui.",
        '<button class="btn" data-acao="abrir-modal-topico">Criar tópico</button>'
      ) + '</div>';
    }

    var html = '<div class="cabecalho-evolucao">';
    html += '<div class="cabecalho-evolucao-topo"><h2 class="titulo-secao">Evolução</h2>' + renderLegendaEvolucao() + '</div>';
    html += '<p class="sub-secao">Cada quadro mostra a constância de um tópico nas últimas 12 semanas</p>';
    html += '</div><div class="grade-evolucao">';

    estado.topicos.forEach(function(topico){
      var tarefasDoTopico = estado.tarefas.filter(function(t){ return t.topicoId===topico.id; });
      html += '<section class="cartao quadro-evolucao">';
      html += '<div class="titulo-quadro-evolucao"><span class="avatar-topico" style="background:'+topico.cor+'">'+escapeHTML(iniciais(topico.nome))+'</span><strong>'+escapeHTML(topico.nome)+'</strong></div>';
      if(tarefasDoTopico.length===0){
        html += '<div class="evolucao-vazia"><span>Nenhuma tarefa cadastrada.</span><button data-acao="abrir-modal-tarefa" data-topico="'+topico.id+'">Adicionar tarefa</button></div>';
      }else{
        var stats = calcularEstatisticasTopico(topico.id, tarefasDoTopico);
        html += '<div class="estatisticas">';
        html += '<div class="estat"><div class="valor">'+stats.sequenciaAtual+'</div><div class="rotulo">Sequência atual</div></div>';
        html += '<div class="estat"><div class="valor">'+stats.melhorSequencia+'</div><div class="rotulo">Melhor sequência</div></div>';
        html += '<div class="estat"><div class="valor">'+stats.taxaConclusao+'%</div><div class="rotulo">Conclusão</div></div>';
        html += '</div>';
        html += renderHeatmap(topico.id, tarefasDoTopico);
      }
      html += '</section>';
    });
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

  function quantidadeConcluidaNoDia(tarefasDoTopico, dataISO){
    var previstas = tarefasDoTopico.filter(function(t){ return tarefaOcorreEm(t, dataISO); });
    var concluidas = previstas.filter(function(t){ return concluidaEm(t.id, dataISO); }).length;
    return {previstas:previstas.length, concluidas:concluidas};
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

  function renderLegendaEvolucao(){
    return '<div class="legenda-heatmap legenda-topo">'
      + '<span class="item-legenda"><i class="quadrado-dia total"></i>Tudo concluído</span>'
      + '<span class="item-legenda"><i class="quadrado-dia parcial"></i>Parcial</span>'
      + '<span class="item-legenda"><i class="quadrado-dia nenhuma"></i>Nada concluído</span>'
      + '</div>';
  }

  function renderHeatmap(topicoId, tarefasDoTopico){
    var hoje = new Date(); hoje.setHours(0,0,0,0);
    var diaSemanaHoje = hoje.getDay();
    var fimGrade = new Date(hoje); fimGrade.setDate(fimGrade.getDate() + (6 - diaSemanaHoje));
    var totalSemanas = 24;
    var inicioGrade = new Date(fimGrade); inicioGrade.setDate(inicioGrade.getDate() - (totalSemanas*7 - 1));

    var html = '<div class="heatmap">';
    var cursor = new Date(inicioGrade);
    for(var s=0; s<totalSemanas; s++){
      html += '<div class="coluna-semana">';
      for(var d=0; d<7; d++){
        var dataISO = paraISO(cursor);
        var noFuturo = cursor > hoje;
        var classeNivel = 'sem-dados';
        var titulo = dataISO;
        if(noFuturo){
          classeNivel = 'futuro';
        }else{
          var resumo = quantidadeConcluidaNoDia(tarefasDoTopico, dataISO);
          if(resumo.previstas>0){
            if(resumo.concluidas===resumo.previstas) classeNivel='total';
            else if(resumo.concluidas>0) classeNivel='parcial';
            else classeNivel='nenhuma';
            titulo += ' — '+resumo.concluidas+' de '+resumo.previstas+' concluídas';
          }
        }
        html += '<div class="quadrado-dia '+classeNivel+'" title="'+titulo+'"></div>';
        cursor.setDate(cursor.getDate()+1);
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  /* ---------- Estado vazio (helper) ---------- */
  function estadoVazio(nomeIcone, titulo, texto, acaoHtml){
    return '<div class="vazio"><span class="icone-vazio">'+ic(nomeIcone)+'</span><strong>'+titulo+'</strong><span>'+texto+'</span>'+(acaoHtml||"")+'</div>';
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
    var cor = dados.cor || TONS_CINZA[0];
    var html = '<div class="fundo-modal" data-acao="fechar-modal-fundo"><div class="modal" onclick="event.stopPropagation()">';
    html += '<h3>'+(editando?"Editar tópico":"Novo tópico")+'</h3>';
    html += '<div class="campo"><label>Nome</label><input type="text" id="campo-nome-topico" value="'+escapeAttr(dados.nome||"")+'" placeholder="Ex: Faculdade, Treinos, Casa..."></div>';
    html += '<div class="campo"><label>Tom</label><div class="grade-cores">';
    TONS_CINZA.forEach(function(c){
      html += '<button class="amostra-cor '+(c===cor?"selecionada":"")+'" style="background:'+c+'" data-acao="escolher-cor-topico" data-cor="'+c+'"></button>';
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
      html += '<option value="'+t.id+'" '+(dados.topicoId===t.id?"selected":"")+'>'+escapeHTML(t.nome)+'</option>';
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

  /* ---------- Eventos (um único listener delegado, não é reanexado a cada render) ---------- */
  function ligarEventosGlobais(){
    document.addEventListener("click", function(ev){
      if(!ev.target || !ev.target.closest) return;

      var fundo = ev.target.closest(".fundo-modal");
      if(fundo && ev.target === fundo){
        estado.modal = null; render(); return;
      }

      var el = ev.target.closest('[data-acao], [data-aba]');
      if(!el) return;
      try{
        manipularAcao(el.getAttribute("data-acao"), el, ev);
      }catch(e){
        console.error("Erro ao processar ação:", e);
      }
    });

    document.addEventListener("change", function(ev){
      if(ev.target && ev.target.id === "campo-recorrencia-tarefa"){
        var wrapUnica = document.getElementById("campo-data-unica-wrap");
        var wrapSemanal = document.getElementById("campo-dias-semana-wrap");
        if(wrapUnica) wrapUnica.style.display = ev.target.value==="unica" ? "block":"none";
        if(wrapSemanal) wrapSemanal.style.display = ev.target.value==="semanal" ? "block":"none";
      }
    });
  }

  function estadoModalAtualDados(){
    return estado.modal ? estado.modal.dados : {};
  }

  function manipularAcao(acao, el, ev){
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
        if(!tp) return;
        estado.modal = {tipo:"topico", dados: Object.assign({}, tp)};
        render(); break;

      case "escolher-cor-topico":
        estadoModalAtualDados().cor = el.getAttribute("data-cor");
        render(); break;


      case "salvar-topico":
        salvarTopico(); break;

      case "excluir-topico":
        var idExcluir = el.getAttribute("data-topico");
        var topicoAExcluir = topicoPorId(idExcluir);
        if(!topicoAExcluir) return;
        var qtdTarefas = estado.tarefas.filter(function(t){return t.topicoId===idExcluir;}).length;
        estado.modal = {tipo:"confirmar", dados:{
          titulo:"Excluir tópico?",
          mensagem: "O tópico \""+topicoAExcluir.nome+"\" será excluído"+(qtdTarefas>0?" junto com "+qtdTarefas+" tarefa(s) relacionada(s)":"")+". Essa ação não pode ser desfeita.",
          aoConfirmar: function(){ excluirTopico(idExcluir); }
        }};
        render(); break;

      case "abrir-modal-tarefa":
        if(estado.topicos.length===0) return;
        var topicoDestino = el.getAttribute("data-topico") || estado.topicoEvolucaoId || estado.topicos[0].id;
        var dadosPadrao = {topicoId: topicoDestino, recorrencia:"unica", dataUnica:hojeISO()};
        estado.modal = {tipo:"tarefa", dados:dadosPadrao};
        render(); break;

      case "alternar-topico":
        var topicoAlternado = el.getAttribute("data-topico");
        estado.topicosAbertos[topicoAlternado] = estado.topicosAbertos[topicoAlternado] === false ? true : false;
        render(); break;

      case "editar-tarefa":
        var idT = el.getAttribute("data-tarefa");
        var tarefaExistente = estado.tarefas.filter(function(t){return t.id===idT;})[0];
        if(!tarefaExistente) return;
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

      case "tentar-novamente":
        render(); break;
    }
  }

  function salvarTopico(){
    var dados = estadoModalAtualDados();
    var nomeInput = document.getElementById("campo-nome-topico");
    var nome = nomeInput.value.trim();
    if(!nome){ nomeInput.focus(); nomeInput.style.borderColor = "var(--danger)"; return; }
    var cor = dados.cor || TONS_CINZA[0];

    if(dados.id){
      var topico = topicoPorId(dados.id);
      if(topico){ topico.nome = nome; topico.cor = cor; }
    } else {
      estado.topicos.push({id:gerarId(), nome:nome, cor:cor});
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
  ligarEventosGlobais();
  render();
  iniciarFirebase();
})();
