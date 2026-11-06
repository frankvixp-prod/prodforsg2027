/**
 * PRODFOR — api.js
 * Camada de acesso a dados compartilhada por todos os módulos.
 * Substitui o uso direto de localStorage como fonte de verdade.
 *
 * USO NOS MÓDULOS:
 *   <script src="api.js"></script>
 *   api.configurar('https://script.google.com/macros/s/SEU_ID/exec');
 *   api.listar('empresas', { id_turma: 'T001' }).then(function (lista) { ... });
 */

var api = (function () {
  var ENDPOINT = '';
  var USUARIO = null;
  var CACHE_PREFIXO = 'prodf_cache_';
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var FILA = [];
  var PROCESSANDO = false;

  function configurar(url) {
    ENDPOINT = url || '';
    try { localStorage.setItem('prodfor_endpoint', ENDPOINT); } catch (e) { }
    return ENDPOINT;
  }

  function carregarEndpoint() {
    if (ENDPOINT) { return ENDPOINT; }
    try {
      ENDPOINT = localStorage.getItem('prodfor_endpoint') || '';
      if (!ENDPOINT) {
        var bruto = localStorage.getItem('prodfor_config_endpoint');
        if (bruto) {
          var cfg = JSON.parse(bruto);
          if (cfg && cfg.url) { ENDPOINT = cfg.url; }
        }
      }
    } catch (e) { ENDPOINT = ''; }
    return ENDPOINT;
  }

  function definirUsuario(usuario) {
    USUARIO = usuario || null;
    try {
      if (USUARIO) { localStorage.setItem('prodfor_sessao', JSON.stringify(USUARIO)); }
      else { localStorage.removeItem('prodfor_sessao'); }
    } catch (e) { }
  }

  function obterUsuario() {
    if (USUARIO) { return USUARIO; }
    try {
      var bruto = localStorage.getItem('prodfor_sessao');
      if (bruto) { USUARIO = JSON.parse(bruto); }
    } catch (e) { USUARIO = null; }
    return USUARIO;
  }

  function emailAtual() {
    var u = obterUsuario();
    return u && u.email ? u.email : '';
  }

  function montarUrl(acao, params) {
    var base = carregarEndpoint();
    if (!base) { throw new Error('Endpoint não configurado. Acesse Configurações.'); }
    var partes = ['acao=' + encodeURIComponent(acao)];
    if (params) {
      for (var chave in params) {
        if (params.hasOwnProperty(chave) && params[chave] !== undefined && params[chave] !== null) {
          var valor = params[chave];
          if (typeof valor === 'object') { valor = JSON.stringify(valor); }
          partes.push(chave + '=' + encodeURIComponent(valor));
        }
      }
    }
    var email = emailAtual();
    if (email) { partes.push('email=' + encodeURIComponent(email)); }
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + partes.join('&');
  }

  function requisitar(acao, params, corpo) {
    return new Promise(function (resolve, reject) {
      var url;
      try { url = montarUrl(acao, params); } catch (e) { reject(e); return; }

      var opcoes = { method: corpo ? 'POST' : 'GET', redirect: 'follow' };
      if (corpo) {
        opcoes.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
        var payload = {};
        for (var k in corpo) { if (corpo.hasOwnProperty(k)) { payload[k] = corpo[k]; } }
        payload.acao = acao;
        payload.email = emailAtual();
        opcoes.body = JSON.stringify(payload);
      }

      fetch(url, opcoes)
        .then(function (resp) { return resp.json(); })
        .then(function (json) {
          if (!json || json.ok === false) {
            reject(new Error(json && json.erro ? json.erro : 'Falha na requisição.'));
            return;
          }
          resolve(json);
        })
        .catch(function (erro) { reject(erro); });
    });
  }

  function chaveCache(entidade, filtro) {
    return CACHE_PREFIXO + entidade + '_' + JSON.stringify(filtro || {});
  }

  function lerCache(entidade, filtro) {
    try {
      var bruto = localStorage.getItem(chaveCache(entidade, filtro));
      if (!bruto) { return null; }
      var item = JSON.parse(bruto);
      if (!item || !item.expira || item.expira < Date.now()) {
        localStorage.removeItem(chaveCache(entidade, filtro));
        return null;
      }
      return item.dados;
    } catch (e) { return null; }
  }

  function gravarCache(entidade, filtro, dados) {
    try {
      localStorage.setItem(chaveCache(entidade, filtro), JSON.stringify({
        dados: dados,
        expira: Date.now() + CACHE_TTL_MS
      }));
    } catch (e) { }
  }

  function limparCache(entidade) {
    try {
      var prefixo = CACHE_PREFIXO + entidade + '_';
      var remover = [];
      for (var i = 0; i < localStorage.length; i++) {
        var chave = localStorage.key(i);
        if (chave && chave.indexOf(prefixo) === 0) { remover.push(chave); }
      }
      for (var j = 0; j < remover.length; j++) { localStorage.removeItem(remover[j]); }
    } catch (e) { }
  }

  function listar(entidade, filtro) {
    var emCache = lerCache(entidade, filtro);
    if (emCache) { return Promise.resolve(emCache); }
    return requisitar('listar', { entidade: entidade, filtro: filtro || {} })
      .then(function (json) {
        gravarCache(entidade, filtro, json.dados);
        return json.dados;
      });
  }

  function obter(entidade, id) {
    return requisitar('obter', { entidade: entidade, id: id }).then(function (json) { return json.dados; });
  }

  function criar(entidade, dados) {
    return requisitar('criar', { entidade: entidade }, { dados: dados })
      .then(function (json) { limparCache(entidade); return json.dados; });
  }

  function atualizar(entidade, id, dados) {
    return requisitar('atualizar', { entidade: entidade, id: id }, { dados: dados })
      .then(function (json) { limparCache(entidade); return json.dados; });
  }

  function excluir(entidade, id) {
    return requisitar('excluir', { entidade: entidade, id: id }, { dados: { id: id } })
      .then(function (json) { limparCache(entidade); return json.dados; });
  }

  function desempenho(idPrograma, estagio) {
    return requisitar('desempenho', { id_programa: idPrograma, estagio: estagio || '' })
      .then(function (json) { return { dados: json.dados, resumo: json.resumo }; });
  }

  function auditoria(entidade, de, ate) {
    return requisitar('auditoria', { entidade: entidade || '', de: de || '', ate: ate || '' })
      .then(function (json) { return json.dados; });
  }

  function login(email, senha) {
    return requisitar('login', {}, { email: email, senha: senha })
      .then(function (json) { definirUsuario(json.dados); return json.dados; });
  }

  function sair() {
    definirUsuario(null);
  }

  function migrar(dados) {
    return requisitar('migrar', {}, { dados: dados }).then(function (json) { return json.dados; });
  }

  function status() {
    return requisitar('status', {}).then(function (json) { return json.dados; });
  }

  function testarConexao() {
    return status().then(function (dados) { return { ok: true, dados: dados }; })
      .catch(function (erro) { return { ok: false, erro: erro.message }; });
  }

  function migrarLocalStorage() {
    var mapa = {
      programas: 'prodfor_programas',
      turmas: 'prodfor_turmas',
      empresas: 'prodfor_empresas',
      participantes: 'prodfor_participantes',
      faixas: 'prodfor_faixas',
      lancamentos: 'prodfor_lancamentos',
      usuarios: 'prodfor_usuarios'
    };
    var pacote = {};
    for (var entidade in mapa) {
      if (mapa.hasOwnProperty(entidade)) {
        try {
          var bruto = localStorage.getItem(mapa[entidade]);
          pacote[entidade] = bruto ? JSON.parse(bruto) : [];
        } catch (e) { pacote[entidade] = []; }
      }
    }
    return migrar(pacote);
  }

  function enfileirar(operacao) {
    FILA.push(operacao);
    if (!PROCESSANDO) { processarFila(); }
  }

  function processarFila() {
    if (FILA.length === 0) { PROCESSANDO = false; return; }
    PROCESSANDO = true;
    var op = FILA.shift();
    op().then(function () { processarFila(); })
        .catch(function () { processarFila(); });
  }

  return {
    configurar: configurar,
    carregarEndpoint: carregarEndpoint,
    definirUsuario: definirUsuario,
    obterUsuario: obterUsuario,
    listar: listar,
    obter: obter,
    criar: criar,
    atualizar: atualizar,
    excluir: excluir,
    desempenho: desempenho,
    auditoria: auditoria,
    login: login,
    sair: sair,
    migrar: migrar,
    migrarLocalStorage: migrarLocalStorage,
    status: status,
    testarConexao: testarConexao,
    limparCache: limparCache,
    enfileirar: enfileirar
  };
})();