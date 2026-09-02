/* =====================================================
   GESTÃO DE ARMAZÉNS — FRONTEND
   SPA em JS puro (sem build). Fala com o backend Apps Script
   via fetch(). Sessão fica só em memória (sem localStorage).
   ===================================================== */

// >>> COLE AQUI A URL DO SEU APPS SCRIPT WEB APP <<<
const API_URL = 'https://script.google.com/macros/s/AKfycbyiJF13w6pN6irRpkyKNu_ACFB4it9lTjmcLsE_84MTsehYjJcFdCCHKhxL8v2Mefcu/exec';

// Registra o service worker — necessário para o Android/Chrome oferecer
// a opção de instalar o site como app (ícone na tela + sem barra de endereço).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* PWA é bônus, não trava o app se falhar */ });
  });
}

const OCORRENCIA_STATUS_LABEL = {
  ABERTA: { label: 'Aberta', cls: 'aberta' },
  EM_TRATAMENTO: { label: 'Em tratamento', cls: 'tratamento' },
  AGUARDANDO_VALIDACAO: { label: 'Aguardando validação', cls: 'validacao' },
  FINALIZADA: { label: 'Finalizada', cls: 'finalizada' }
};

// ------------------------- API -------------------------

async function api(action, payload) {
  if (API_URL.includes('COLE_A_URL')) {
    toast('Configure a API_URL em app.js (veja SETUP.md)', true);
    throw new Error('API_URL não configurada');
  }
  const isRead = action.startsWith('get');
  try {
    let res;
    if (isRead) {
      const qs = new URLSearchParams({ action, ...flattenParams(payload) }).toString();
      res = await fetch(API_URL + '?' + qs);
    } else {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
        body: JSON.stringify({ action, payload })
      });
    }
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
    return json.data;
  } catch (err) {
    toast(err.message || 'Erro de conexão com a planilha', true);
    throw err;
  }
}

function flattenParams(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(function (k) {
    if (obj[k] !== undefined && obj[k] !== null && typeof obj[k] !== 'object') out[k] = obj[k];
  });
  return out;
}

// ------------------------- STATE -------------------------

const S = {
  unidade: null,      // {ID_UNIDADE, UNIDADE}
  usuario: null,      // {ID_USUARIO, NOME, TIPO, UNIDADE}
  screen: 'loginUnidade',
  cache: {},
  wizard: null,
  pendBadgeCount: 0,
  seenPendIds: null,
  notifInterval: null
};

function resetSession() {
  S.unidade = null;
  S.usuario = null;
  S.screen = 'loginUnidade';
  S.wizard = null;
  stopNotificationPolling();
  document.getElementById('topbar').hidden = true;
  document.getElementById('tabbar').hidden = true;
}

// ------------------------- NOTIFICAÇÕES NA TELA -------------------------
// Não há como enviar WhatsApp/push de fora do app; isto avisa o conferente
// enquanto o app estiver aberto no tablet/celular: verifica periodicamente
// se surgiram pendências novas direcionadas a ele e mostra um aviso na tela
// + uma bolinha vermelha com a contagem na aba "Pendências".

function startNotificationPolling() {
  stopNotificationPolling();
  if (!S.usuario || S.usuario.TIPO !== 'CONFERENTE') return;
  S.seenPendIds = null; // primeira checagem não deve gerar aviso
  checkPendenciasNotificacao();
  S.notifInterval = setInterval(checkPendenciasNotificacao, 45000);
}

function stopNotificationPolling() {
  if (S.notifInterval) { clearInterval(S.notifInterval); S.notifInterval = null; }
  S.pendBadgeCount = 0;
  S.seenPendIds = null;
}

async function checkPendenciasNotificacao() {
  if (!S.usuario || S.usuario.TIPO !== 'CONFERENTE') return;
  try {
    const pend = await api('getPendencias', { unidade: S.unidade.UNIDADE, idResponsavel: S.usuario.ID_USUARIO });
    const ativas = pend.filter(function (p) { return p.STATUS === 'ABERTA' || p.STATUS === 'EM_TRATAMENTO'; });
    const idsAtuais = ativas.map(function (p) { return p.ID_PENDENCIA; });
    if (S.seenPendIds) {
      const novas = idsAtuais.filter(function (id) { return S.seenPendIds.indexOf(id) === -1; });
      if (novas.length) {
        const primeira = ativas.find(function (p) { return p.ID_PENDENCIA === novas[0]; });
        toast('📋 Nova pendência: ' + (primeira ? primeira.TIPO + ' — ' + primeira.ARMAZEM : novas.join(', ')), false, true);
      }
    }
    S.seenPendIds = idsAtuais;
    S.pendBadgeCount = ativas.length;
    refreshTabbarBadges();
  } catch (e) { /* silencioso — não interromper o uso do app */ }
}

function refreshTabbarBadges() {
  const tabbar = document.getElementById('tabbar');
  if (tabbar.hidden) return;
  const btn = tabbar.querySelector('[data-s="minhasPendencias"]');
  if (!btn) return;
  let badge = btn.querySelector('.tab-badge');
  if (S.pendBadgeCount > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-badge';
      btn.querySelector('.ic').appendChild(badge);
    }
    badge.textContent = S.pendBadgeCount > 9 ? '9+' : String(S.pendBadgeCount);
  } else if (badge) {
    badge.remove();
  }
}

// ------------------------- UI HELPERS -------------------------

const app = document.getElementById('app');

function go(screen, extra) {
  S.screen = screen;
  if (extra) Object.assign(S, extra);
  render();
  window.scrollTo(0, 0);
}

function toast(msg, isError, isSuccess) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast is-show' + (isError ? ' is-error' : isSuccess ? ' is-success' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.className = 'toast'; }, 3200);
}

// Renderiza uma lista longa em páginas de N itens, com botão "Carregar
// mais" no final — evita travar a tela quando acumula muitos registros.
// renderItem(item) deve devolver um elemento pronto pra ser anexado.
function renderPaginado(container, items, renderItem, pageSize) {
  pageSize = pageSize || 20;
  let shown = 0;
  const btnWrap = el('<div style="text-align:center;margin-top:8px"></div>');

  function loadMore() {
    const next = items.slice(shown, shown + pageSize);
    next.forEach(function (item) { container.insertBefore(renderItem(item), btnWrap); });
    shown += next.length;
    btnWrap.innerHTML = '';
    if (shown < items.length) {
      const btn = el('<button class="btn btn--outline btn--sm">Carregar mais (' + shown + ' de ' + items.length + ')</button>');
      btn.onclick = loadMore;
      btnWrap.appendChild(btn);
    }
  }
  container.appendChild(btnWrap);
  loadMore();
}

function el(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

// Insere um HTML que pode ter VÁRIOS elementos irmãos no topo (el() só
// retornaria o primeiro e descartaria o resto). Usar sempre que a string
// concatenar mais de uma tag no nível raiz.
function appendHtml(container, html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html.trim();
  while (tmp.firstChild) container.appendChild(tmp.firstChild);
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fileToDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Separador usado pelo backend pra guardar VÁRIAS fotos numa única célula
// FOTO da planilha (ver salvarFotos_ no Code.gs) — precisa ser o mesmo dos
// dois lados pra conseguir separar de volta na hora de exibir.
const FOTO_SEP = '|||';

// Quebra uma string FOTO (0, 1 ou várias URLs coladas com FOTO_SEP) num
// array de URLs — registros antigos (1 foto só, sem separador) continuam
// funcionando normalmente, viram array de 1.
function fotosArray(str) {
  return String(str || '').split(FOTO_SEP).map(function (s) { return s.trim(); }).filter(Boolean);
}

// Monta a galeria (1 ou várias fotos lado a lado) pra exibir um valor FOTO
// já salvo (telas de detalhe/validação). Retorna '' se não houver foto.
function fotosGaleria(str) {
  const urls = fotosArray(str);
  if (!urls.length) return '';
  return '<div class="photo-gallery">' +
    urls.map(function (u) { return '<img class="photo-preview" src="' + escapeHtml(u) + '">'; }).join('') +
  '</div>';
}

// Componente reutilizável de captura de foto — aceita UMA OU VÁRIAS fotos.
// Retorna node + getter (sempre um array de data URLs, mesmo vazio).
function photoField(container, opts) {
  opts = opts || {};
  const max = opts.max || 10;
  let fotos = (opts.initial || []).slice();

  const wrap = el('<div class="photo-input"></div>');
  container.appendChild(wrap);

  function abrirSeletor() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    input.onchange = async function (e) {
      const files = Array.prototype.slice.call(e.target.files || []);
      for (const file of files) {
        if (fotos.length >= max) { toast('Máximo de ' + max + ' fotos neste campo', true); break; }
        fotos.push(await fileToDataUrl(file));
      }
      document.body.removeChild(input);
      refresh();
    };
    document.body.appendChild(input);
    input.click();
  }

  function refresh() {
    wrap.innerHTML = '';
    wrap.appendChild(el('<label>' + escapeHtml(opts.label || 'Foto') + (opts.required ? ' *' : '') + '</label>'));

    if (fotos.length) {
      const grid = el('<div class="photo-grid"></div>');
      fotos.forEach(function (dataUrl, i) {
        const thumb = el(
          '<div class="photo-thumb">' +
            '<img src="' + dataUrl + '">' +
            '<button type="button" class="photo-thumb__rm" aria-label="Remover foto">✕</button>' +
          '</div>'
        );
        thumb.querySelector('.photo-thumb__rm').onclick = function () { fotos.splice(i, 1); refresh(); };
        grid.appendChild(thumb);
      });
      if (fotos.length < max) {
        const addTile = el('<button type="button" class="photo-add-tile" title="Adicionar mais uma foto">＋</button>');
        addTile.onclick = abrirSeletor;
        grid.appendChild(addTile);
      }
      wrap.appendChild(grid);
    } else {
      const btn = el(
        '<div class="photo-btn' + (opts.required ? ' required' : '') + '">📷 Toque para tirar foto ou escolher da galeria' +
        (opts.required ? ' (obrigatória)' : ' (pode escolher mais de uma)') + '</div>'
      );
      btn.onclick = abrirSeletor;
      wrap.appendChild(btn);
    }
  }

  refresh();
  return { node: wrap, getValue: function () { return fotos.slice(); } };
}

// Botões SIM/NÃO
// Escolha única entre N opções (ex: Conforme/Não conforme, ou uma lista de
// urgência) — genérico, usado no formulário especial da balança.
function choiceField(container, opts) {
  const cols = opts.columns || 2;
  const wrap = el(
    '<div class="field">' +
      '<label>' + escapeHtml(opts.label) + (opts.required ? ' *' : '') + '</label>' +
      '<div class="option-grid" style="grid-template-columns:repeat(' + cols + ',1fr)">' +
        opts.options.map(function (o, i) { return '<button type="button" class="option-btn" data-i="' + i + '" style="text-align:left">' + escapeHtml(o.label) + '</button>'; }).join('') +
      '</div>' +
    '</div>'
  );
  let value = null;
  const btns = wrap.querySelectorAll('.option-btn');
  btns.forEach(function (b, i) {
    b.onclick = function () {
      value = opts.options[i].value;
      btns.forEach(function (x) { x.classList.remove('is-selected'); });
      b.classList.add('is-selected');
    };
  });
  container.appendChild(wrap);
  return { node: wrap, getValue: function () { return value; } };
}

function yesNoField(container, label) {
  const wrap = el(
    '<div class="field">' +
      '<label>' + escapeHtml(label) + '</label>' +
      '<div class="option-grid" style="grid-template-columns:1fr 1fr">' +
        '<button type="button" class="option-btn" data-v="1">Sim</button>' +
        '<button type="button" class="option-btn" data-v="0">Não</button>' +
      '</div>' +
    '</div>'
  );
  let value = null;
  const btns = wrap.querySelectorAll('.option-btn');
  btns.forEach(function (b) {
    b.onclick = function () {
      value = b.dataset.v === '1';
      btns.forEach(function (x) { x.classList.remove('is-selected'); });
      b.classList.add('is-selected');
      wrap.dispatchEvent(new CustomEvent('change'));
    };
  });
  container.appendChild(wrap);
  return { node: wrap, getValue: function () { return value; } };
}

function textField(container, opts) {
  opts = opts || {};
  const id = 'f_' + Math.random().toString(36).slice(2);
  const tag = opts.multiline ? 'textarea' : 'input';
  const wrap = el(
    '<div class="field">' +
      '<label for="' + id + '">' + escapeHtml(opts.label) + (opts.required ? ' *' : '') + '</label>' +
      '<' + tag + ' id="' + id + '" ' + (opts.type ? 'type="' + opts.type + '"' : '') + ' placeholder="' + escapeHtml(opts.placeholder || '') + '"></' + tag + '>' +
    '</div>'
  );
  container.appendChild(wrap);
  const input = wrap.querySelector(tag);
  if (opts.value !== undefined && opts.value !== null && opts.value !== '') input.value = opts.value;
  return { getValue: function () { return input.value.trim(); }, node: wrap };
}

function selectField(container, opts) {
  const id = 's_' + Math.random().toString(36).slice(2);
  const optionsHtml = ['<option value="">Selecione…</option>'].concat(
    (opts.options || []).map(function (o) { return '<option value="' + escapeHtml(o.value) + '">' + escapeHtml(o.label) + '</option>'; })
  ).join('');
  const wrap = el(
    '<div class="field">' +
      '<label for="' + id + '">' + escapeHtml(opts.label) + '</label>' +
      '<select id="' + id + '">' + optionsHtml + '</select>' +
    '</div>'
  );
  container.appendChild(wrap);
  const select = wrap.querySelector('select');
  return { getValue: function () { return select.value; }, node: wrap, select: select };
}

function screenHeader(eyebrow, title, subtitle) {
  return '<div class="stack" style="gap:4px;margin-bottom:4px">' +
    '<span class="eyebrow">' + escapeHtml(eyebrow) + '</span>' +
    '<h1 class="title-xl">' + escapeHtml(title) + '</h1>' +
    (subtitle ? '<p class="subtle">' + escapeHtml(subtitle) + '</p>' : '') +
    '</div>';
}

// ------------------------- BOOT -------------------------

document.getElementById('btnLogout').onclick = function () { resetSession(); render(); };
document.getElementById('btnTrocarUnidadeGlobal').onclick = function () { go('trocarUnidadeGlobal'); };

render();

// ------------------------- ROUTER -------------------------

function render() {
  app.innerHTML = '';
  const screens = {
    loginUnidade: renderLoginUnidade,
    trocarUnidadeGlobal: renderTrocarUnidadeGlobal,
    loginUsuario: renderLoginUsuario,
    loginSenha: renderLoginSenha,
    conferenteHome: renderConferenteHome,
    inspecao: renderInspecao,
    checklist: renderChecklist,
    minhasPendencias: renderMinhasPendencias,
    pendenciaDetalhe: renderPendenciaDetalhe,
    historico: renderHistorico,
    adminHome: renderAdminHome,
    validacaoInspecoes: renderValidacaoInspecoes,
    inspecaoDetalheAdmin: renderInspecaoDetalheAdmin,
    registrarPendencia: renderRegistrarPendencia,
    dashCarunchos: renderDashCarunchos,
    dashInspecoes: renderDashInspecoes,
    dashOcorrencias: renderDashOcorrencias,
    manutencoes: renderManutencoes,
    manutencoesConferente: renderManutencoesConferente,
    mapaCapturas: renderMapaCapturas,
    mapaGoteiras: renderMapaGoteiras,
    resumoGeral: renderResumoGeral,
    manutencaoDetalhe: renderManutencaoDetalhe,
    relatorios: renderRelatorios,
    relatorioDetalhe: renderRelatorioDetalhe,
    dashChecklist: renderDashChecklist,
    dashPendencias: renderDashPendencias
  };
  (screens[S.screen] || renderLoginUnidade)();
  updateChrome();
}

function updateChrome() {
  const topbar = document.getElementById('topbar');
  const tabbar = document.getElementById('tabbar');
  if (!S.usuario) {
    topbar.hidden = true;
    tabbar.hidden = true;
    return;
  }
  topbar.hidden = false;
  document.getElementById('topbarUnidade').textContent = S.unidade.UNIDADE;
  document.getElementById('topbarUsuario').textContent = S.usuario.NOME + ' · ' + (S.usuario.TIPO === 'ADMIN' ? 'Admin' : 'Conferente');
  document.getElementById('btnTrocarUnidadeGlobal').hidden = String(S.usuario.UNIDADE).toUpperCase() !== 'TODAS';

  tabbar.hidden = false;
  const tabs = S.usuario.TIPO === 'ADMIN'
    ? [
        { s: 'adminHome', ic: '🏠', label: 'Início' },
        { s: 'validacaoInspecoes', ic: '✅', label: 'Inspeções' },
        { s: 'dashPendencias', ic: '📋', label: 'Pendências' },
        { s: 'dashCarunchos', ic: '🐞', label: 'Carunchos' }
      ]
    : [
        { s: 'conferenteHome', ic: '🏠', label: 'Início' },
        { s: 'inspecao', ic: '🔎', label: 'Inspeção' },
        { s: 'minhasPendencias', ic: '📋', label: 'Pendências' },
        { s: 'historico', ic: '🕘', label: 'Histórico' }
      ];
  tabbar.innerHTML = tabs.map(function (t) {
    const active = S.screen === t.s ? ' is-active' : '';
    return '<button class="' + active.trim() + '" data-s="' + t.s + '"><span class="ic" style="position:relative">' + t.ic + '</span>' + t.label + '</button>';
  }).join('');
  tabbar.querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { go(b.dataset.s); };
  });
  refreshTabbarBadges();
}

// ------------------------- LOGIN -------------------------

async function renderLoginUnidade() {
  app.appendChild(el(
    '<div class="screen" style="padding-top:10vh">' +
      '<div class="login-logo"><img src="logo.png" alt="ICC Brazil" class="mark"></div>' +
      '<h1 class="title-xl" style="text-align:center">Gestão de Armazéns</h1>' +
      '<p class="subtle" style="text-align:center;margin-bottom:8px">Selecione sua unidade para continuar</p>' +
      '<div class="card stack" id="unidadesList"><p class="subtle">Carregando unidades…</p></div>' +
    '</div>'
  ));
  try {
    const unidades = await api('getUnidades', {});
    const wrap = document.getElementById('unidadesList');
    wrap.innerHTML = '';
    if (!unidades.length) { wrap.innerHTML = '<p class="subtle">Nenhuma unidade ativa cadastrada.</p>'; return; }
    unidades.forEach(function (u) {
      const item = el('<button type="button" class="list-item" style="width:100%"><span class="list-item__title">' + escapeHtml(u.UNIDADE) + '</span><span>›</span></button>');
      item.onclick = function () { S.unidade = u; go('loginUsuario'); };
      wrap.appendChild(item);
    });
  } catch (e) { /* toast already shown */ }
}

// Para Gerente/Coordenador (UNIDADE = TODAS): troca a unidade de trabalho
// sem precisar sair e logar de novo.
async function renderTrocarUnidadeGlobal() {
  // Trava de segurança: mesmo que alguém force a navegação até aqui
  // (ex: pelo console do navegador), sem acesso TODAS não passa daqui.
  if (String(S.usuario.UNIDADE).toUpperCase() !== 'TODAS') {
    toast('Você não tem permissão para trocar de unidade.', true);
    go(S.usuario.TIPO === 'ADMIN' ? 'adminHome' : 'conferenteHome');
    return;
  }

  app.appendChild(el(
    screenHeader('Trocar unidade', 'Unidade atual: ' + S.unidade.UNIDADE, 'Você tem acesso a todas as unidades')
  ));
  const card = el('<div class="card stack" id="unidadesList"><p class="subtle">Carregando unidades…</p></div>');
  app.appendChild(card);
  try {
    const unidades = await api('getUnidades', {});
    card.innerHTML = '';
    unidades.forEach(function (u) {
      const isAtual = u.UNIDADE === S.unidade.UNIDADE;
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          '<span class="list-item__title">' + escapeHtml(u.UNIDADE) + (isAtual ? ' (atual)' : '') + '</span><span>›</span>' +
        '</button>'
      );
      item.onclick = function () { S.unidade = u; go('adminHome'); };
      card.appendChild(item);
    });
  } catch (e) { /* */ }
}

async function renderLoginUsuario() {
  appendHtml(app,
    screenHeader('Login · ' + S.unidade.UNIDADE, 'Quem é você?', 'Selecione seu usuário') +
    '<button class="btn btn--outline btn--sm" id="btnVoltarUnidade" style="align-self:flex-start;margin-top:-6px">← Trocar unidade</button>' +
    '<div class="card stack" id="usuariosList"><p class="subtle">Carregando usuários…</p></div>'
  );
  document.getElementById('btnVoltarUnidade').onclick = function () { go('loginUnidade'); };
  try {
    const usuarios = await api('getUsuarios', { unidade: S.unidade.UNIDADE });
    const wrap = document.getElementById('usuariosList');
    wrap.innerHTML = '';
    if (!usuarios.length) { wrap.innerHTML = '<p class="subtle">Nenhum usuário ativo nesta unidade.</p>'; return; }
    usuarios.forEach(function (u) {
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          '<span><span class="list-item__title">' + escapeHtml(u.NOME) + '</span>' +
          '<div class="list-item__sub">' + (u.TIPO === 'ADMIN' ? 'Administrador' : 'Conferente') + '</div></span><span>›</span>' +
        '</button>'
      );
      item.onclick = function () {
        if (u.TIPO === 'ADMIN') { go('loginSenha', { pendingUser: u }); }
        else { S.usuario = u; startNotificationPolling(); go('conferenteHome'); }
      };
      wrap.appendChild(item);
    });
  } catch (e) { /* */ }
}

function renderLoginSenha() {
  const u = S.pendingUser;
  appendHtml(app,
    screenHeader('Login Admin · ' + S.unidade.UNIDADE, u.NOME, 'Digite sua senha para acessar a área administrativa') +
    '<div class="card stack">' +
      '<div class="field"><label>Senha</label><input type="password" id="inpSenha" autofocus></div>' +
      '<button class="btn btn--primary btn--block" id="btnEntrar">Entrar</button>' +
      '<button class="btn btn--outline btn--block" id="btnVoltar">← Voltar</button>' +
    '</div>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('loginUsuario'); };
  const btn = document.getElementById('btnEntrar');
  const input = document.getElementById('inpSenha');
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
  btn.onclick = async function () {
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      const data = await api('loginAdmin', { idUsuario: u.ID_USUARIO, senha: input.value });
      S.usuario = data;
      go('adminHome');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  };
}

// ------------------------- CONFERENTE: HOME -------------------------

function renderConferenteHome() {
  appendHtml(app,
    screenHeader('Área do conferente', 'Olá, ' + S.usuario.NOME) +
    '<div class="stack">' +
      menuCard('🔎', 'Inspeção dos galpões', 'Registrar uma nova inspeção', 'inspecao') +
      menuCard('🧹', 'Checklist de limpeza', 'Diário, semanal, mensal ou anual', 'checklist') +
      menuCard('📋', 'Minhas pendências', 'Ver e resolver pendências direcionadas a você', 'minhasPendencias') +
      menuCard('🔧', 'Manutenções', 'Acompanhar o andamento das manutenções da unidade', 'manutencoesConferente') +
      menuCard('☔', 'Mapa de goteiras', 'Ver e resolver goteiras marcadas no mapa', 'mapaGoteiras') +
      menuCard('🕘', 'Histórico', 'Suas inspeções e checklists anteriores', 'historico') +
    '</div>'
  );
  bindMenuCards();
}

function menuCard(icon, title, sub, screen) {
  return '<button type="button" class="list-item" style="width:100%;padding:16px" data-go="' + screen + '">' +
    '<span class="row" style="gap:12px"><span style="font-size:22px">' + icon + '</span>' +
    '<span><span class="list-item__title">' + escapeHtml(title) + '</span><div class="list-item__sub">' + escapeHtml(sub) + '</div></span></span>' +
    '<span>›</span></button>';
}
function bindMenuCards() {
  app.querySelectorAll('[data-go]').forEach(function (b) {
    b.onclick = function () { go(b.dataset.go); };
  });
}

// ------------------------- INSPEÇÃO (wizard condicional) -------------------------

function newWizard() {
  return {
    armazem: null,
    ocorrencias: [],
    capturas: [],
    step: 'armazem'
  };
}

function renderInspecao() {
  if (!S.wizard || S.wizard.type !== 'inspecao') S.wizard = Object.assign(newWizard(), { type: 'inspecao' });
  const w = S.wizard;

  if (w.step === 'armazem') return stepArmazem(w, function () { w.step = 'avaria'; render(); });

  if (w.step === 'avaria') return stepMultiplo(w, {
    titulo: 'Produto avariado?', itemLabel: 'Avaria', perguntaQuantidade: 'Quantas avarias foram encontradas?',
    tipoOcorrencia: 'Produto avariado', next: 'goteira',
    campos: [{ key: 'rua', label: 'Qual rua?' }, { key: 'baia', label: 'Qual baia?' }, { key: 'obs', label: 'Observação', multiline: true }],
    montarDescricao: function (v) { return 'Local: ' + v.rua + ' / Baia: ' + v.baia + (v.obs ? ' — ' + v.obs : ''); }
  });

  if (w.step === 'goteira') return stepGoteira(w);

  if (w.step === 'quedaTombamento') return stepMultiplo(w, {
    titulo: 'Existem cargas ou baias com risco de queda ou tombamento?', itemLabel: 'Risco', perguntaQuantidade: 'Quantos pontos de risco foram encontrados?',
    tipoOcorrencia: 'Risco de queda/tombamento', next: 'carunchos',
    campos: [{ key: 'local', label: 'Qual local/baia?' }, { key: 'acoes', label: 'Quais ações foram realizadas para eliminar o risco?', multiline: true }, { key: 'obs', label: 'Observação', multiline: true }],
    montarDescricao: function (v) { return 'Local/baia: ' + v.local + ' — Ações: ' + v.acoes + (v.obs ? ' — Obs: ' + v.obs : ''); }
  });

  if (w.step === 'carunchos') return stepCarunchos(w);
  if (w.step === 'manutencao') return stepManutencao(w);
  if (w.step === 'revisao') return stepRevisao(w);
}

function wizardHeader(title, sub) {
  return screenHeader('Inspeção · ' + S.wizard.armazem, title, sub);
}

function stepArmazem(w, onNext) {
  const container = el(wizardHeader('Selecione o armazém', 'A unidade (' + S.unidade.UNIDADE + ') já está definida pela sua sessão.'));
  app.appendChild(container);
  const cardWrap = el('<div class="card stack" id="armazensList"><p class="subtle">Carregando armazéns…</p></div>');
  app.appendChild(cardWrap);
  api('getArmazens', { unidade: S.unidade.UNIDADE }).then(function (armazens) {
    cardWrap.innerHTML = '';
    if (!armazens.length) { cardWrap.innerHTML = '<p class="subtle">Nenhum armazém ativo cadastrado para esta unidade.</p>'; return; }
    armazens.forEach(function (a) {
      const item = el('<button type="button" class="list-item" style="width:100%"><span class="list-item__title">' + escapeHtml(a.ARMAZEM) + '</span><span>›</span></button>');
      item.onclick = function () { w.armazem = a.ARMAZEM; onNext(); };
      cardWrap.appendChild(item);
    });
  }).catch(function () {});
}

// Padrão genérico de pergunta SIM/NÃO com campos condicionais quando SIM
function stepSimNao(w, opts) {
  const container = el(wizardHeader(opts.title));
  app.appendChild(container);
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  const yn = yesNoField(card, opts.title);
  const fieldsWrap = el('<div class="stack" style="display:none"></div>');
  card.appendChild(fieldsWrap);
  let fieldsApi = null;

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Continuar</button>');
  card.appendChild(btn);

  yn.node.addEventListener('change', function () {
    const val = yn.getValue();
    fieldsWrap.style.display = val ? 'flex' : 'none';
    fieldsWrap.innerHTML = '';
    fieldsApi = null;
    if (val) fieldsApi = opts.fields(fieldsWrap);
  });

  btn.onclick = function () {
    const val = yn.getValue();
    if (val === null) { toast('Selecione Sim ou Não', true); return; }
    if (val) {
      if (fieldsApi && fieldsApi.validate && !fieldsApi.validate()) { toast('Preencha os campos obrigatórios (foto)', true); return; }
      opts.onYes(fieldsApi ? fieldsApi.get() : {});
    }
    w.step = opts.next;
    render();
  };
}

// Passo especial de goteira: em vez de digitar rua/baia manualmente, o
// conferente toca na planta baixa do armazém (mesma imagem do mapa de
// capturas) para marcar a posição exata de cada goteira encontrada. Só
// libera "Continuar" quando a quantidade marcada bate com a informada, e
// permite desfazer a última marcação antes de confirmar. Cada ponto exige
// uma foto, igual ao padrão das outras ocorrências.
function stepGoteira(w) {
  const container = el(wizardHeader('Novas goteiras encontradas?'));
  app.appendChild(container);
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  const yn = yesNoField(card, 'Novas goteiras encontradas?');
  const sub = el('<div class="stack" style="display:none"></div>');
  card.appendChild(sub);

  let entries = null; // preenchido só depois de confirmar as posições no mapa
  let mapaConfirmado = null;

  yn.node.addEventListener('change', function () {
    const val = yn.getValue();
    sub.style.display = val ? 'flex' : 'none';
    sub.innerHTML = '';
    entries = null;
    mapaConfirmado = null;
    if (!val) return;

    const qtd = textField(sub, { label: 'Quantas novas goteiras foram encontradas?', type: 'number' });
    const btnMapa = el('<button type="button" class="btn btn--outline btn--sm" style="align-self:flex-start">Marcar no mapa</button>');
    sub.appendChild(btnMapa);
    const mapaArea = el('<div class="stack"></div>');
    sub.appendChild(mapaArea);

    btnMapa.onclick = async function () {
      const n = parseInt(qtd.getValue(), 10);
      if (!n || n < 1) { toast('Informe um número válido', true); return; }
      entries = null;
      mapaConfirmado = null;
      mapaArea.innerHTML = '<p class="subtle">Carregando mapa…</p>';
      const mapas = await api('getMapasDisponiveis', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
      if (!mapas.length) {
        mapaArea.innerHTML = '<p class="subtle">Nenhum mapa cadastrado para esta unidade — fale com o administrador antes de continuar.</p>';
        return;
      }
      mapaArea.innerHTML = '';

      let mapaAtual = mapas[0];
      if (mapas.length > 1) {
        const selWrap = el('<div class="filters"></div>');
        mapaArea.appendChild(selWrap);
        const selEl = el('<select>' + mapas.map(function (m) { return '<option value="' + escapeHtml(m) + '">' + escapeHtml(MAPA_LABEL[m] || m) + '</option>'; }).join('') + '</select>');
        selWrap.appendChild(selEl);
        selEl.onchange = function () { mapaAtual = selEl.value; renderMapaTap(); };
      }

      const statusLine = el('<p class="subtle" style="margin:0"></p>');
      mapaArea.appendChild(statusLine);
      const mapBox = el('<div class="card" style="padding:0;overflow:hidden;position:relative"></div>');
      mapaArea.appendChild(mapBox);
      const btnRow = el('<div class="row" style="gap:8px"></div>');
      const btnDesfazer = el('<button type="button" class="btn btn--outline btn--sm">Desfazer última</button>');
      const btnConfirmarPontos = el('<button type="button" class="btn btn--primary btn--sm" disabled>Confirmar posições</button>');
      btnRow.appendChild(btnDesfazer); btnRow.appendChild(btnConfirmarPontos);
      mapaArea.appendChild(btnRow);
      const formsWrap = el('<div class="stack"></div>');
      mapaArea.appendChild(formsWrap);

      let pontos = [];
      let mapContainer, img;

      function renderMapaTap() {
        pontos = [];
        mapBox.innerHTML = '';
        formsWrap.innerHTML = '';
        entries = null;
        mapContainer = el('<div style="position:relative;width:100%;line-height:0"></div>');
        img = el('<img src="assets/mapas/' + mapaAtual + '" style="width:100%;display:block" alt="Mapa">');
        mapContainer.appendChild(img);
        mapBox.appendChild(mapContainer);
        atualizarStatus();
        mapContainer.onclick = function (e) {
          if (e.target !== img) return; // ignora clique em cima de um marcador já colocado
          if (pontos.length >= n) { toast('Você já marcou ' + n + ' goteira(s). Use "Desfazer última" se precisar corrigir.', true); return; }
          const rect = img.getBoundingClientRect();
          const xPct = ((e.clientX - rect.left) / rect.width) * 100;
          const yPct = ((e.clientY - rect.top) / rect.height) * 100;
          pontos.push({ xPct: xPct.toFixed(2), yPct: yPct.toFixed(2) });
          desenharMarcadores();
          atualizarStatus();
        };
      }
      function desenharMarcadores() {
        mapContainer.querySelectorAll('[data-marcador]').forEach(function (m) { m.remove(); });
        pontos.forEach(function (p, i) {
          const marker = el(
            '<div data-marcador style="position:absolute;left:' + p.xPct + '%;top:' + p.yPct + '%;transform:translate(-50%,-50%);' +
            'width:24px;height:24px;border-radius:50%;background:var(--st-tratamento);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);' +
            'color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">' + (i + 1) + '</div>'
          );
          mapContainer.appendChild(marker);
        });
      }
      function atualizarStatus() {
        statusLine.textContent = pontos.length + ' de ' + n + ' marcadas — toque no mapa para marcar cada goteira';
        btnDesfazer.disabled = pontos.length === 0;
        btnConfirmarPontos.disabled = pontos.length !== n;
      }
      btnDesfazer.onclick = function () {
        pontos.pop();
        entries = null;
        formsWrap.innerHTML = '';
        desenharMarcadores();
        atualizarStatus();
        btnConfirmarPontos.disabled = pontos.length !== n;
      };

      btnConfirmarPontos.onclick = function () {
        mapaConfirmado = mapaAtual;
        formsWrap.innerHTML = '';
        entries = [];
        pontos.forEach(function (p, i) {
          const box = el('<div class="card" style="padding:14px;background:#fafbfa"><h3 class="title-lg" style="margin-bottom:8px">Goteira ' + (i + 1) + '</h3></div>');
          formsWrap.appendChild(box);
          const obs = textField(box, { label: 'Observação (opcional)', multiline: true });
          const foto = photoField(box, { label: 'Foto', required: true });
          entries.push({ ponto: p, obs: obs, foto: foto });
        });
      };
      renderMapaTap();
    };
  });

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Continuar</button>');
  card.appendChild(btn);
  btn.onclick = function () {
    const val = yn.getValue();
    if (val === null) { toast('Selecione Sim ou Não', true); return; }
    if (val) {
      if (!entries || !entries.length) { toast('Marque as goteiras no mapa e confirme as posições', true); return; }
      for (const e of entries) {
        if (!e.foto.getValue().length) { toast('A foto é obrigatória em todas as goteiras marcadas', true); return; }
      }
      entries.forEach(function (e) {
        const obsVal = e.obs.getValue();
        w.ocorrencias.push({
          tipo: 'Goteira',
          descricao: 'Marcada no mapa' + (obsVal ? ' — ' + obsVal : ''),
          fotos: e.foto.getValue(),
          pontoMapa: { mapa: mapaConfirmado, xPct: e.ponto.xPct, yPct: e.ponto.yPct }
        });
      });
    }
    w.step = 'quedaTombamento';
    render();
  };
}

// Helper genérico usado por avaria e risco de queda/tombamento (goteira usa
// stepGoteira, acima, por precisar de marcação no mapa em vez de rua/baia):
// pergunta Sim/Não, se Sim pergunta quantas foram encontradas e gera um
// mini-formulário para cada uma (foto obrigatória em todas).
function stepMultiplo(w, opts) {
  const container = el(wizardHeader(opts.titulo));
  app.appendChild(container);
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  const yn = yesNoField(card, opts.titulo);
  const sub = el('<div class="stack" style="display:none"></div>');
  card.appendChild(sub);

  let entries = [];

  yn.node.addEventListener('change', function () {
    const val = yn.getValue();
    sub.style.display = val ? 'flex' : 'none';
    sub.innerHTML = '';
    if (!val) return;
    const qtd = textField(sub, { label: opts.perguntaQuantidade, type: 'number' });
    const btnGerar = el('<button type="button" class="btn btn--outline btn--sm" style="align-self:flex-start">Gerar formulários</button>');
    sub.appendChild(btnGerar);
    const listWrap = el('<div class="stack"></div>');
    sub.appendChild(listWrap);

    btnGerar.onclick = function () {
      const n = parseInt(qtd.getValue(), 10);
      if (!n || n < 1) { toast('Informe um número válido', true); return; }
      listWrap.innerHTML = '';
      entries = [];
      for (let i = 0; i < n; i++) {
        const box = el('<div class="card" style="padding:14px;background:#fafbfa"><h3 class="title-lg" style="margin-bottom:8px">' + escapeHtml(opts.itemLabel) + ' ' + (i + 1) + '</h3></div>');
        listWrap.appendChild(box);
        const camposRefs = {};
        opts.campos.forEach(function (c) {
          camposRefs[c.key] = textField(box, { label: c.label, multiline: !!c.multiline });
        });
        const foto = photoField(box, { label: opts.fotoLabel || 'Foto', required: true });
        entries.push({ campos: camposRefs, foto: foto });
      }
    };
  });

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Continuar</button>');
  card.appendChild(btn);
  btn.onclick = function () {
    const val = yn.getValue();
    if (val === null) { toast('Selecione Sim ou Não', true); return; }
    if (val) {
      if (!entries.length) { toast('Gere e preencha os formulários', true); return; }
      for (const e of entries) {
        if (!e.foto.getValue().length) { toast('A foto é obrigatória em todos os registros', true); return; }
      }
      entries.forEach(function (e) {
        const valores = {};
        Object.keys(e.campos).forEach(function (k) { valores[k] = e.campos[k].getValue(); });
        w.ocorrencias.push({ tipo: opts.tipoOcorrencia, descricao: opts.montarDescricao(valores), fotos: e.foto.getValue() });
      });
    }
    w.step = opts.next;
    render();
  };
}

function stepCarunchos(w) {
  const container = el(wizardHeader('Houve captura de carunchos?'));
  app.appendChild(container);
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  const yn = yesNoField(card, 'Houve captura de carunchos?');
  const sub = el('<div class="stack" style="display:none"></div>');
  card.appendChild(sub);

  let entries = [];

  yn.node.addEventListener('change', function () {
    const val = yn.getValue();
    sub.style.display = val ? 'flex' : 'none';
    sub.innerHTML = '';
    if (!val) return;
    const qtd = textField(sub, { label: 'Quantas armadilhas tiveram captura?', type: 'number' });
    const btnGerar = el('<button type="button" class="btn btn--outline btn--sm" style="align-self:flex-start">Gerar formulários</button>');
    sub.appendChild(btnGerar);
    const listWrap = el('<div class="stack"></div>');
    sub.appendChild(listWrap);

    btnGerar.onclick = function () {
      const n = parseInt(qtd.getValue(), 10);
      if (!n || n < 1) { toast('Informe um número válido', true); return; }
      listWrap.innerHTML = '';
      entries = [];
      for (let i = 0; i < n; i++) {
        const box = el('<div class="card" style="padding:14px;background:#fafbfa"><h3 class="title-lg" style="margin-bottom:8px">Armadilha ' + (i + 1) + '</h3></div>');
        listWrap.appendChild(box);
        const armadilhaNum = textField(box, { label: 'Número/identificação da armadilha *', placeholder: 'Ex: 12' });
        const qtdCaruncho = textField(box, { label: 'Quantidade de carunchos *', type: 'number' });
        const produtoProximo = yesNoField(box, 'Existe produto próximo com possibilidade de infestação?');
        const detalhe = el('<div class="stack" style="display:none"></div>');
        box.appendChild(detalhe);
        let baiaF, produtoF, obsF;
        produtoProximo.node.addEventListener('change', function () {
          const v = produtoProximo.getValue();
          detalhe.style.display = v ? 'flex' : 'none';
          detalhe.innerHTML = '';
          if (!v) return;
          baiaF = textField(detalhe, { label: 'Baia' });
          produtoF = textField(detalhe, { label: 'Produto' });
          obsF = textField(detalhe, { label: 'Observação', multiline: true });
        });
        entries.push({
          armadilha: armadilhaNum, quantidade: qtdCaruncho, produtoProximo: produtoProximo,
          getExtra: function () { return { baia: baiaF ? baiaF.getValue() : '', produto: produtoF ? produtoF.getValue() : '', observacao: obsF ? obsF.getValue() : '' }; }
        });
      }
    };
  });

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Continuar</button>');
  card.appendChild(btn);
  btn.onclick = function () {
    const val = yn.getValue();
    if (val === null) { toast('Selecione Sim ou Não', true); return; }
    if (val) {
      if (!entries.length) { toast('Gere e preencha os formulários das armadilhas', true); return; }
      for (const e of entries) {
        if (!e.armadilha.getValue()) { toast('Informe o número da armadilha em todos os formulários', true); return; }
        if (e.quantidade.getValue() === '') { toast('Informe a quantidade de carunchos em todos os formulários (pode ser 0)', true); return; }
      }
      entries.forEach(function (e) {
        const extra = e.getExtra();
        w.capturas.push({
          armadilha: e.armadilha.getValue(),
          quantidade: e.quantidade.getValue() || 0,
          produtoProximo: !!e.produtoProximo.getValue(),
          baia: extra.baia, observacao: (extra.produto ? 'Produto: ' + extra.produto + '. ' : '') + extra.observacao
        });
      });
    }
    w.step = 'manutencao';
    render();
  };
}

// Área separada de Pendências: se marcado, gera um registro na aba de
// Manutenções (com seu próprio status Pendente/Concluída).
function stepManutencao(w) {
  const container = el(wizardHeader('Manutenção', 'Precisa de manutenção? (buraco no piso, estrutura batida, fresta na parede, tomada etc. Não repetir se já enviado antes)'));
  app.appendChild(container);
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  const yn = yesNoField(card, 'Precisa de manutenção?');
  const sub = el('<div class="stack" style="display:none"></div>');
  card.appendChild(sub);

  let refs = null;

  yn.node.addEventListener('change', function () {
    const val = yn.getValue();
    sub.style.display = val ? 'flex' : 'none';
    sub.innerHTML = '';
    refs = null;
    if (!val) return;

    const local = textField(sub, { label: 'Local' });
    const tipoSel = selectField(sub, {
      label: 'Tipo de manutenção',
      options: [
        { value: 'Equipamento', label: 'Equipamento' },
        { value: 'Estrutura', label: 'Estrutura' },
        { value: 'Chão', label: 'Chão' },
        { value: 'Parede', label: 'Parede' },
        { value: 'Outro', label: 'Outro' }
      ]
    });
    const outroWrap = el('<div style="display:none"></div>');
    sub.appendChild(outroWrap);
    let outroField = null;
    tipoSel.select.onchange = function () {
      outroWrap.style.display = tipoSel.getValue() === 'Outro' ? 'block' : 'none';
      outroWrap.innerHTML = '';
      outroField = null;
      if (tipoSel.getValue() === 'Outro') outroField = textField(outroWrap, { label: 'Especifique o tipo' });
    };
    const descricao = textField(sub, { label: 'Descrição da manutenção necessária', multiline: true });
    const foto = photoField(sub, { label: 'Foto', required: true });
    refs = { local: local, tipoSel: tipoSel, getOutro: function () { return outroField ? outroField.getValue() : ''; }, descricao: descricao, foto: foto };
  });

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Continuar</button>');
  card.appendChild(btn);
  btn.onclick = function () {
    const val = yn.getValue();
    if (val === null) { toast('Selecione Sim ou Não', true); return; }
    if (val) {
      if (!refs) { toast('Preencha os dados da manutenção', true); return; }
      if (!refs.tipoSel.getValue()) { toast('Selecione o tipo de manutenção', true); return; }
      if (refs.tipoSel.getValue() === 'Outro' && !refs.getOutro()) { toast('Especifique o tipo de manutenção', true); return; }
      if (!refs.foto.getValue().length) { toast('A foto é obrigatória', true); return; }
      w.manutencao = {
        local: refs.local.getValue(),
        tipo: refs.tipoSel.getValue() === 'Outro' ? refs.getOutro() : refs.tipoSel.getValue(),
        descricao: refs.descricao.getValue(),
        fotos: refs.foto.getValue()
      };
    } else {
      w.manutencao = null;
    }
    w.step = 'revisao';
    render();
  };
}

function stepRevisao(w) {
  const container = el(wizardHeader('Revisão da inspeção', 'Confira antes de enviar'));
  app.appendChild(container);
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  card.appendChild(el('<div class="row between"><span class="subtle">Armazém</span><strong>' + escapeHtml(w.armazem) + '</strong></div>'));
  card.appendChild(el('<div class="divider"></div>'));

  if (!w.ocorrencias.length && !w.capturas.length && !w.manutencao) {
    card.appendChild(el('<p class="subtle">Nenhuma ocorrência registrada. Tudo certo nesta inspeção. ✅</p>'));
  } else {
    w.ocorrencias.forEach(function (o) {
      const qtdFotos = (o.fotos || []).length;
      card.appendChild(el('<div class="list-item" style="cursor:default"><span><span class="list-item__title">' + escapeHtml(o.tipo) + '</span><div class="list-item__sub">' + escapeHtml(o.descricao) + '</div></span>' + (qtdFotos ? '<span>📷 ' + qtdFotos + '</span>' : '') + '</div>'));
    });
    w.capturas.forEach(function (c) {
      card.appendChild(el('<div class="list-item" style="cursor:default"><span><span class="list-item__title">Captura — ' + escapeHtml(c.armadilha) + '</span><div class="list-item__sub">Qtd: ' + escapeHtml(c.quantidade) + '</div></span></div>'));
    });
    if (w.manutencao) {
      const qtdFotosManut = (w.manutencao.fotos || []).length;
      card.appendChild(el('<div class="list-item" style="cursor:default"><span><span class="list-item__title">🔧 Manutenção — ' + escapeHtml(w.manutencao.tipo) + '</span><div class="list-item__sub">' + escapeHtml(w.manutencao.local) + (w.manutencao.descricao ? ' — ' + escapeHtml(w.manutencao.descricao) : '') + '</div></span>' + (qtdFotosManut ? '<span>📷 ' + qtdFotosManut + '</span>' : '') + '</div>'));
    }
  }

  const obsWrap = el('<div></div>');
  card.appendChild(obsWrap);
  const obsField = textField(obsWrap, { label: 'Observação geral (opcional)', multiline: true });

  const btnEnviar = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Enviar inspeção</button>');
  const btnCancelar = el('<button class="btn btn--outline btn--block">Cancelar</button>');
  card.appendChild(btnEnviar);
  card.appendChild(btnCancelar);

  btnCancelar.onclick = function () { S.wizard = null; go('conferenteHome'); };
  btnEnviar.onclick = async function () {
    btnEnviar.disabled = true; btnEnviar.textContent = 'Enviando…';
    try {
      await api('createInspecao', {
        unidade: S.unidade.UNIDADE, idUsuario: S.usuario.ID_USUARIO, usuario: S.usuario.NOME,
        armazem: w.armazem, ocorrencias: w.ocorrencias, capturas: w.capturas, manutencao: w.manutencao || null, observacao: obsField.getValue()
      });
      toast('Inspeção enviada com sucesso!', false, true);
      S.wizard = null;
      go('conferenteHome');
    } catch (e) {
      btnEnviar.disabled = false; btnEnviar.textContent = 'Enviar inspeção';
    }
  };
}

// ------------------------- CHECKLIST DE LIMPEZA -------------------------

// Formulário especial da Balança (só aparece no armazém configurado como
// tal na planilha — ver CONFIG_CHECKLIST_ITENS, coluna TIPO = BALANCA).
// Segue a estrutura do formulário que já era usado: 3 subitens
// (Conforme/Não conforme), observações, urgência e foto obrigatória.
function renderBalancaForm(container) {
  const subitens = ['Calibração de peso', 'Limpeza', 'Manutenção'];
  const conformeOpcoes = [{ value: 'CONFORME', label: 'Conforme' }, { value: 'NAO_CONFORME', label: 'Não conforme' }];
  const campos = subitens.map(function (nome) {
    return { nome: nome, campo: choiceField(container, { label: nome, columns: 2, options: conformeOpcoes }) };
  });
  const obs = textField(container, { label: 'Ações corretivas necessárias / Observações adicionais', multiline: true });
  const manutencao = choiceField(container, {
    label: 'Necessidade de manutenção imediata?', columns: 1, required: true,
    options: [
      { value: 'INOPERANTE', label: 'Sim, a balança está inoperante ou com erro crítico' },
      { value: 'OBSERVACAO_LEVE', label: 'Não, apenas observações leves ou necessidade de limpeza' },
      { value: 'CORRETA', label: 'Não, a balança está correta' }
    ]
  });
  const foto = photoField(container, { label: 'Foto da balança', required: true });

  const manutLabel = { INOPERANTE: 'Sim, inoperante/erro crítico', OBSERVACAO_LEVE: 'Não, observações leves', CORRETA: 'Não, balança correta' };
  const conformeLabel = { CONFORME: 'Conforme', NAO_CONFORME: 'Não conforme' };

  return {
    validate: function () {
      return campos.every(function (c) { return !!c.campo.getValue(); }) && !!manutencao.getValue() && foto.getValue().length > 0;
    },
    getResultado: function () { return manutencao.getValue(); },
    getObservacao: function () {
      const partes = campos.map(function (c) { return c.nome + ': ' + conformeLabel[c.campo.getValue()]; });
      partes.push('Manutenção imediata: ' + manutLabel[manutencao.getValue()]);
      if (obs.getValue()) partes.push('Obs: ' + obs.getValue());
      return partes.join(' | ');
    },
    getFotos: function () { return foto.getValue(); }
  };
}

function renderChecklist() {
  if (!S.wizard || S.wizard.type !== 'checklist') S.wizard = { type: 'checklist', step: 'periodicidade', armazem: null, periodicidade: null };
  const w = S.wizard;

  if (w.step === 'periodicidade') {
    app.appendChild(el(screenHeader('Checklist de limpeza', 'Qual periodicidade?')));
    const card = el('<div class="card stack"></div>');
    app.appendChild(card);
    [['DIARIO', 'Diário'], ['SEMANAL', 'Semanal'], ['MENSAL', 'Mensal'], ['ANUAL', 'Anual']].forEach(function (p) {
      const b = el('<button type="button" class="list-item" style="width:100%"><span class="list-item__title">' + p[1] + '</span><span>›</span></button>');
      b.onclick = function () { w.periodicidade = p[0]; w.step = 'armazem'; render(); };
      card.appendChild(b);
    });
    return;
  }

  if (w.step === 'armazem') {
    app.appendChild(el(screenHeader('Checklist · ' + w.periodicidade, 'Selecione o armazém')));
    const card = el('<div class="card stack" id="list"><p class="subtle">Carregando…</p></div>');
    app.appendChild(card);

    const buscaArmazens = api('getArmazens', { unidade: S.unidade.UNIDADE });
    const buscaProximos = w.periodicidade !== 'DIARIO'
      ? api('getProximosChecklists', { unidade: S.unidade.UNIDADE, periodicidade: w.periodicidade }).catch(function () { return []; })
      : Promise.resolve([]);

    Promise.all([buscaArmazens, buscaProximos]).then(function (results) {
      const armazens = results[0], proximos = results[1];
      const proximosPorArmazem = {};
      proximos.forEach(function (p) { proximosPorArmazem[p.armazem] = p; });

      card.innerHTML = '';
      armazens.forEach(function (a) {
        const prox = proximosPorArmazem[a.ARMAZEM];
        let sub = '';
        if (prox) {
          if (prox.proximaData) {
            sub = '<div class="list-item__sub" style="' + (prox.atrasado ? 'color:var(--st-risco);font-weight:600' : '') + '">Próximo checklist: ' + escapeHtml(prox.proximaData) + (prox.atrasado ? ' (atrasado)' : '') + '</div>';
          } else {
            sub = '<div class="list-item__sub">Ainda não tem checklist ' + w.periodicidade.toLowerCase() + ' registrado</div>';
          }
        }
        const b = el('<button type="button" class="list-item" style="width:100%"><span><span class="list-item__title">' + escapeHtml(a.ARMAZEM) + '</span>' + sub + '</span><span>›</span></button>');
        b.onclick = function () { w.armazem = a.ARMAZEM; w.step = 'itens'; render(); };
        card.appendChild(b);
      });
    }).catch(function () {});
    return;
  }

  if (w.step === 'itens') {
    app.appendChild(el(screenHeader('Checklist ' + w.periodicidade, w.armazem)));
    const card = el('<div class="card stack" id="itensCard"><p class="subtle">Carregando itens…</p></div>');
    app.appendChild(card);

    api('getChecklistItens', { unidade: S.unidade.UNIDADE, armazem: w.armazem, periodicidade: w.periodicidade }).then(function (itens) {
      card.innerHTML = '';
      if (!itens.length) {
        card.appendChild(el('<p class="subtle">Nenhum item de checklist configurado para este armazém/periodicidade.</p>'));
        return;
      }

      const refs = itens.map(function (it) {
        const box = el('<div class="stack" style="padding-bottom:10px;border-bottom:1px solid var(--line)"></div>');
        card.appendChild(box);
        box.appendChild(el('<strong>' + escapeHtml(it.item) + '</strong>'));

        if (it.tipo === 'BALANCA') {
          const balanca = renderBalancaForm(box);
          return {
            item: it.item, especial: true,
            validate: balanca.validate,
            build: function () { return { item: it.item, resultado: balanca.getResultado(), observacao: balanca.getObservacao(), fotos: balanca.getFotos() }; }
          };
        }

        if (it.tipo === 'SUJIDADE') {
          const yn = yesNoField(box, 'Foi identificada sujidade?');
          const sub = el('<div class="stack" style="display:none"></div>');
          box.appendChild(sub);
          let obsField = null, fotoField = null;
          yn.node.addEventListener('change', function () {
            const val = yn.getValue();
            sub.style.display = val ? 'flex' : 'none';
            sub.innerHTML = '';
            obsField = null; fotoField = null;
            if (val) {
              obsField = textField(sub, { label: 'Observação (opcional)', multiline: true });
              fotoField = photoField(sub, { label: 'Foto da sujidade', required: true });
            }
          });
          return {
            item: it.item, especial: true,
            validate: function () { return yn.getValue() !== null && (!yn.getValue() || (fotoField && fotoField.getValue().length > 0)); },
            build: function () {
              const houve = yn.getValue();
              return { item: it.item, resultado: houve ? 'SUJIDADE' : 'OK', observacao: houve && obsField ? obsField.getValue() : '', fotos: houve && fotoField ? fotoField.getValue() : [] };
            }
          };
        }

        const sel = selectField(box, { label: 'Situação', options: [{ value: 'OK', label: 'OK' }, { value: 'NECESSITA_MANUTENCAO', label: 'Necessita manutenção' }, { value: 'NAO_REALIZADO', label: 'Não realizado' }] });
        const manutWrap = el('<div style="display:none"></div>');
        box.appendChild(manutWrap);
        let manutField = null;
        sel.select.addEventListener('change', function () {
          manutWrap.style.display = sel.getValue() === 'NECESSITA_MANUTENCAO' ? 'block' : 'none';
          manutWrap.innerHTML = '';
          manutField = null;
          if (sel.getValue() === 'NECESSITA_MANUTENCAO') {
            manutField = textField(manutWrap, { label: 'Descrever a manutenção necessária *', multiline: true });
          }
        });
        const foto = photoField(box, { label: 'Foto (opcional)' });
        return {
          item: it.item, especial: false,
          validate: function () { return !!sel.getValue() && (sel.getValue() !== 'NECESSITA_MANUTENCAO' || !!(manutField && manutField.getValue())); },
          build: function () { return { item: it.item, resultado: sel.getValue(), observacao: manutField ? manutField.getValue() : '', fotos: foto.getValue() }; }
        };
      });

      // Pergunta extra do checklist DIÁRIO (fica embaixo da lista de itens):
      // "deseja descrever alguma não conformidade encontrada no armazém?" —
      // separada dos itens fixos de cima (Piso, Sujidade etc.), pra registrar
      // qualquer outra coisa fora do roteiro. Texto livre + foto opcional.
      if (w.periodicidade === 'DIARIO') {
        const ncBox = el('<div class="stack" style="padding-bottom:10px;border-bottom:1px solid var(--line)"></div>');
        card.appendChild(ncBox);
        const ncYn = yesNoField(ncBox, 'Deseja descrever alguma não conformidade encontrada no armazém?');
        const ncSub = el('<div class="stack" style="display:none"></div>');
        ncBox.appendChild(ncSub);
        let ncObs = null, ncFoto = null;
        ncYn.node.addEventListener('change', function () {
          const val = ncYn.getValue();
          ncSub.style.display = val ? 'flex' : 'none';
          ncSub.innerHTML = '';
          ncObs = null; ncFoto = null;
          if (val) {
            ncObs = textField(ncSub, { label: 'Descreva a não conformidade *', multiline: true });
            ncFoto = photoField(ncSub, { label: 'Foto (opcional)' });
          }
        });
        refs.push({
          item: 'Não conformidade', especial: true,
          validate: function () { return ncYn.getValue() !== null && (!ncYn.getValue() || (ncObs && !!ncObs.getValue())); },
          build: function () {
            const houve = ncYn.getValue();
            return { item: 'Não conformidade', resultado: houve ? 'NAO_CONFORME' : 'OK', observacao: houve && ncObs ? ncObs.getValue() : '', fotos: houve && ncFoto ? ncFoto.getValue() : [] };
          }
        });
      }

      const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Enviar checklist</button>');
      card.appendChild(btn);
      btn.onclick = async function () {
        const payloadItens = [];
        for (const r of refs) {
          if (!r.validate()) { toast('Preencha corretamente o item "' + r.item + '"', true); return; }
          payloadItens.push(r.build());
        }
        btn.disabled = true; btn.textContent = 'Enviando…';
        try {
          await api('createChecklist', { unidade: S.unidade.UNIDADE, usuario: S.usuario.NOME, idUsuario: S.usuario.ID_USUARIO, armazem: w.armazem, periodicidade: w.periodicidade, itens: payloadItens });
          toast('Checklist enviado com sucesso!', false, true);
          S.wizard = null;
          go('conferenteHome');
        } catch (e) { btn.disabled = false; btn.textContent = 'Enviar checklist'; }
      };
    }).catch(function () {});
  }
}

// ------------------------- MINHAS PENDÊNCIAS (conferente) -------------------------

async function renderMinhasPendencias() {
  app.appendChild(el(screenHeader('Minhas pendências', 'Direcionadas a ' + S.usuario.NOME)));
  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fStatus">' +
        '<option value="">Todos os status</option>' +
        '<option value="ABERTA">Aberta</option>' +
        '<option value="EM_TRATAMENTO">Em tratamento</option>' +
        '<option value="AGUARDANDO_VALIDACAO">Aguardando validação</option>' +
        '<option value="FINALIZADA">Finalizada</option>' +
      '</select>' +
      '<select id="fPeriodo">' +
        '<option value="tudo">Todo o período</option>' +
        '<option value="semana">Esta semana</option>' +
        '<option value="mes">Este mês</option>' +
        '<option value="custom">Período personalizado</option>' +
      '</select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const customWrap = el(
    '<div class="filters" id="customDates" style="display:none">' +
      '<input type="date" id="fDataInicial">' +
      '<input type="date" id="fDataFinal">' +
      '<button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button>' +
    '</div>'
  );
  app.appendChild(customWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const selPeriodo = document.getElementById('fPeriodo');
  const customDates = document.getElementById('customDates');
  selPeriodo.onchange = function () {
    customDates.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  document.getElementById('fStatus').onchange = load;

  async function load() {
    listWrap.innerHTML = '<p class="subtle">Carregando…</p>';
    let range = { dataInicial: '', dataFinal: '' };
    if (selPeriodo.value === 'custom') {
      const ini = document.getElementById('fDataInicial').value;
      const fim = document.getElementById('fDataFinal').value;
      if (ini) range.dataInicial = dateToBR(new Date(ini + 'T00:00:00'));
      if (fim) range.dataFinal = dateToBR(new Date(fim + 'T00:00:00'));
    } else {
      range = periodoRange(selPeriodo.value);
    }
    try {
      const pend = await api('getPendencias', {
        unidade: S.unidade.UNIDADE, idResponsavel: S.usuario.ID_USUARIO, status: document.getElementById('fStatus').value,
        dataInicial: range.dataInicial, dataFinal: range.dataFinal
      });
      renderPendenciasList(listWrap, pend, function (p) { go('pendenciaDetalhe', { pendenciaAtual: p }); });
    } catch (e) {}
  }
  load();
}

function renderPendenciasList(wrap, pend, onOpen) {
  wrap.innerHTML = '';
  if (!pend.length) { wrap.appendChild(el('<div class="empty"><span class="ic">📭</span>Nenhuma pendência encontrada.</div>')); return; }
  renderPaginado(wrap, pend, function (p) {
    const st = OCORRENCIA_STATUS_LABEL[p.STATUS] || { label: p.STATUS, cls: 'aberta' };
    const item = el(
      '<button type="button" class="list-item" style="width:100%">' +
        '<span><span class="shiplabel">' + escapeHtml(p.ID_PENDENCIA) + '</span>' +
        '<div class="list-item__title" style="margin-top:6px">' + escapeHtml(p.TIPO) + ' — ' + escapeHtml(p.ARMAZEM) + '</div>' +
        '<div class="list-item__sub">' + escapeHtml(p.DATA_ABERTURA) + '</div></span>' +
        '<span class="tag tag--' + st.cls + '">' + st.label + '</span>' +
      '</button>'
    );
    item.onclick = function () { onOpen(p); };
    return item;
  });
}

function renderPendenciaDetalhe() {
  const p = S.pendenciaAtual;
  const st = OCORRENCIA_STATUS_LABEL[p.STATUS] || { label: p.STATUS, cls: 'aberta' };
  appendHtml(app,
    screenHeader('Pendência ' + p.ID_PENDENCIA, p.TIPO) +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go(S.usuario.TIPO === 'ADMIN' ? 'dashPendencias' : 'minhasPendencias'); };

  const card = el('<div class="card stack"></div>');
  app.appendChild(card);
  card.appendChild(el('<div class="row between"><span class="subtle">Status</span><span class="tag tag--' + st.cls + '">' + st.label + '</span></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Armazém</span><strong>' + escapeHtml(p.ARMAZEM) + '</strong></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Data de abertura</span><strong>' + escapeHtml(p.DATA_ABERTURA) + '</strong></div>'));
  card.appendChild(el('<div class="divider"></div>'));
  card.appendChild(el('<p><strong>Descrição</strong><br>' + escapeHtml(p.DESCRICAO || '—') + '</p>'));
  if (p.FOTO_ORIGEM) appendHtml(card, fotosGaleria(p.FOTO_ORIGEM));

  if (p.STATUS === 'ABERTA' || p.STATUS === 'EM_TRATAMENTO') {
    if (S.usuario.TIPO !== 'ADMIN') {
      const resolveWrap = el('<div class="card stack"><h3 class="title-lg">Resolver pendência</h3></div>');
      app.appendChild(resolveWrap);
      const desc = textField(resolveWrap, { label: 'O que foi feito? *', multiline: true });
      const foto = photoField(resolveWrap, { label: 'Foto de comprovação', required: true });
      const btn = el('<button class="btn btn--primary btn--block">Enviar solução</button>');
      resolveWrap.appendChild(btn);
      btn.onclick = async function () {
        if (!desc.getValue()) { toast('Descreva o que foi feito', true); return; }
        if (!foto.getValue().length) { toast('A foto de comprovação é obrigatória', true); return; }
        btn.disabled = true; btn.textContent = 'Enviando…';
        try {
          await api('resolverPendencia', { idPendencia: p.ID_PENDENCIA, descricaoSolucao: desc.getValue(), fotosSolucao: foto.getValue() });
          toast('Solução enviada! Aguardando validação do admin.', false, true);
          go('minhasPendencias');
        } catch (e) { btn.disabled = false; btn.textContent = 'Enviar solução'; }
      };
    }
  }

  if (p.STATUS === 'AGUARDANDO_VALIDACAO') {
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<p><strong>Solução informada</strong><br>' + escapeHtml(p.DESCRICAO_SOLUCAO || '—') + '</p>'));
    if (p.FOTO_SOLUCAO) appendHtml(card, fotosGaleria(p.FOTO_SOLUCAO));

    if (S.usuario.TIPO === 'ADMIN') {
      const valWrap = el('<div class="card stack"><h3 class="title-lg">Validar solução</h3></div>');
      app.appendChild(valWrap);
      const row = el('<div class="row" style="gap:10px"></div>');
      valWrap.appendChild(row);
      const btnAprovar = el('<button class="btn btn--primary" style="flex:1">Aprovar e finalizar</button>');
      const btnReprovar = el('<button class="btn btn--danger" style="flex:1">Reprovar</button>');
      row.appendChild(btnAprovar); row.appendChild(btnReprovar);
      btnAprovar.onclick = async function () {
        await api('validarPendencia', { idPendencia: p.ID_PENDENCIA, aprovado: true, adminValidador: S.usuario.NOME });
        toast('Pendência finalizada!', false, true);
        go('dashPendencias');
      };
      btnReprovar.onclick = async function () {
        await api('validarPendencia', { idPendencia: p.ID_PENDENCIA, aprovado: false, adminValidador: S.usuario.NOME });
        toast('Pendência devolvida para tratamento.', true);
        go('dashPendencias');
      };
    }
  }

  if (p.STATUS === 'FINALIZADA') {
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<p><strong>Solução informada</strong><br>' + escapeHtml(p.DESCRICAO_SOLUCAO || '—') + '</p>'));
    if (p.FOTO_SOLUCAO) appendHtml(card, fotosGaleria(p.FOTO_SOLUCAO));
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<div class="row between"><span class="subtle">Validado por</span><strong>' + escapeHtml(p.ADMIN_VALIDADOR || '—') + '</strong></div>'));
    card.appendChild(el('<div class="row between"><span class="subtle">Data da validação</span><strong>' + escapeHtml(p.DATA_VALIDACAO || '—') + '</strong></div>'));
  }
}

// ------------------------- HISTÓRICO (conferente) -------------------------

// Converte "dd/MM/yyyy" (ou "dd/MM/yyyy HH:mm") em Date, para filtrar
// listas já carregadas no navegador (sem precisar ir de novo ao backend).
function parseBR(str) {
  if (!str) return null;
  const datePart = String(str).split(' ')[0];
  const parts = datePart.split('/');
  if (parts.length !== 3) return null;
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

async function renderHistorico() {
  app.appendChild(el(screenHeader('Histórico', S.usuario.NOME)));
  const tabs = el(
    '<div class="row" style="gap:8px">' +
      '<button class="btn btn--outline btn--sm" data-t="inspecoes" style="flex:1">Inspeções</button>' +
      '<button class="btn btn--outline btn--sm" data-t="checklists" style="flex:1">Checklists</button>' +
    '</div>'
  );
  app.appendChild(tabs);

  const filterWrap = el(
    '<div class="filters" style="margin-top:10px">' +
      '<select id="fPeriodo">' +
        '<option value="tudo">Todo o período</option>' +
        '<option value="semana">Esta semana</option>' +
        '<option value="mes">Este mês</option>' +
        '<option value="custom">Período personalizado</option>' +
      '</select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const customWrap = el(
    '<div class="filters" id="customDates" style="display:none">' +
      '<input type="date" id="fDataInicial">' +
      '<input type="date" id="fDataFinal">' +
      '<button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button>' +
    '</div>'
  );
  app.appendChild(customWrap);

  const listWrap = el('<div class="stack" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const data = await api('getHistoricoConferente', { idUsuario: S.usuario.ID_USUARIO }).catch(function () { return { inspecoes: [], checklists: [] }; });
  let abaAtiva = 'inspecoes';

  function dentroDoPeriodo(dataStr) {
    const selPeriodo = document.getElementById('fPeriodo').value;
    if (selPeriodo === 'tudo') return true;
    const d = parseBR(dataStr);
    if (!d) return true;
    let inicio, fim;
    if (selPeriodo === 'custom') {
      const iniInput = document.getElementById('fDataInicial').value;
      const fimInput = document.getElementById('fDataFinal').value;
      inicio = iniInput ? new Date(iniInput + 'T00:00:00') : null;
      fim = fimInput ? new Date(fimInput + 'T23:59:59') : null;
    } else {
      const range = periodoRange(selPeriodo);
      inicio = parseBR(range.dataInicial);
      fim = parseBR(range.dataFinal);
    }
    if (inicio && d < inicio) return false;
    if (fim && d > fim) return false;
    return true;
  }

  function showInspecoes() {
    listWrap.innerHTML = '';
    const filtradas = data.inspecoes.filter(function (i) { return dentroDoPeriodo(i.DATA); });
    if (!filtradas.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🔎</span>Nenhuma inspeção encontrada nesse período.</div>')); return; }
    renderPaginado(listWrap, filtradas.slice().reverse(), function (i) {
      return el(
        '<div class="list-item" style="cursor:default"><span><span class="shiplabel">' + escapeHtml(i.ID_INSPECAO) + '</span>' +
        '<div class="list-item__title" style="margin-top:6px">' + escapeHtml(i.ARMAZEM) + '</div>' +
        '<div class="list-item__sub">' + escapeHtml(i.DATA) + ' ' + escapeHtml(i.HORA) + '</div></span></div>'
      );
    });
  }
  function showChecklists() {
    listWrap.innerHTML = '';
    const filtrados = data.checklists.filter(function (c) { return dentroDoPeriodo(c.DATA); });
    if (!filtrados.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🧹</span>Nenhum checklist encontrado nesse período.</div>')); return; }
    renderPaginado(listWrap, filtrados.slice().reverse(), function (c) {
      return el(
        '<div class="list-item" style="cursor:default"><span><span class="list-item__title">' + escapeHtml(c.ARMAZEM) + ' — ' + escapeHtml(c.ITEM) + '</span>' +
        '<div class="list-item__sub">' + escapeHtml(c.PERIODICIDADE) + ' · ' + escapeHtml(c.DATA) + ' · ' + escapeHtml(c.RESULTADO) + '</div></span></div>'
      );
    });
  }
  function refresh() { abaAtiva === 'inspecoes' ? showInspecoes() : showChecklists(); }

  tabs.querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { abaAtiva = b.dataset.t; refresh(); };
  });
  document.getElementById('fPeriodo').onchange = function () {
    document.getElementById('customDates').style.display = this.value === 'custom' ? 'flex' : 'none';
    if (this.value !== 'custom') refresh();
  };
  document.getElementById('btnAplicar').onclick = refresh;
  refresh();
}

// ------------------------- ADMIN: HOME -------------------------

function renderAdminHome() {
  appendHtml(app,
    screenHeader('Área administrativa', 'Olá, ' + S.usuario.NOME) +
    '<div class="stack">' +
      menuCard('📅', 'Painel do dia', 'Quais armazéns ainda não fizeram inspeção/limpeza hoje', 'dashInspecoes') +
      menuCard('📊', 'Resumo geral', 'Rondas, checklists, capturas e ocorrências — igual ao relatório semanal', 'resumoGeral') +
      menuCard('📄', 'Relatórios', 'Baixar relatórios em CSV (Excel/Sheets)', 'relatorios') +
      menuCard('✅', 'Validação de inspeções', 'Revisar inspeções dos conferentes', 'validacaoInspecoes') +
      menuCard('➕', 'Registrar pendência', 'Abrir uma pendência manualmente', 'registrarPendencia') +
      menuCard('📋', 'Dashboard de pendências', 'Status e distribuição', 'dashPendencias') +
      menuCard('🐞', 'Dashboard de carunchos', 'Capturas por armazém e armadilha', 'dashCarunchos') +
      menuCard('⚠️', 'Ocorrências da inspeção', 'Avaria, goteira e risco de queda/tombamento por armazém', 'dashOcorrencias') +
      menuCard('🔧', 'Manutenções', 'Itens pendentes e concluídos, por armazém', 'manutencoes') +
      menuCard('🗺️', 'Mapa de capturas', 'Visualização espacial das armadilhas', 'mapaCapturas') +
      menuCard('☔', 'Mapa de goteiras', 'Pontos marcados pelos conferentes na inspeção', 'mapaGoteiras') +
      menuCard('🧹', 'Dashboard de limpeza', 'Checklists realizados e pendentes', 'dashChecklist') +
    '</div>'
  );
  bindMenuCards();
}

// ------------------------- ADMIN: VALIDAÇÃO DE INSPEÇÕES -------------------------

async function renderValidacaoInspecoes() {
  app.appendChild(el(screenHeader('Validação de inspeções', S.unidade.UNIDADE, 'Mostrando só as pendentes — escolha "Todos os status" para ver aprovadas/reprovadas')));
  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fArmazem"><option value="">Todos os armazéns</option></select>' +
      '<select id="fResultado">' +
        '<option value="PENDENTE_VALIDACAO">Pendente de validação</option>' +
        '<option value="">Todos os status</option>' +
        '<option value="APROVADA">Aprovada</option>' +
        '<option value="REPROVADA">Reprovada</option>' +
      '</select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const armazens = await api('getArmazens', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  const selArm = document.getElementById('fArmazem');
  armazens.forEach(function (a) { selArm.appendChild(el('<option value="' + escapeHtml(a.ARMAZEM) + '">' + escapeHtml(a.ARMAZEM) + '</option>')); });

  async function load() {
    listWrap.innerHTML = '<p class="subtle">Carregando…</p>';
    const rows = await api('getInspecoes', { unidade: S.unidade.UNIDADE, armazem: selArm.value, status: document.getElementById('fResultado').value, apenasComOcorrencias: true }).catch(function () { return []; });
    listWrap.innerHTML = '';
    if (!rows.length) {
      const msg = document.getElementById('fResultado').value === 'PENDENTE_VALIDACAO' ? 'Nenhuma inspeção pendente de validação. ✅' : 'Nenhuma inspeção encontrada com esse filtro.';
      listWrap.appendChild(el('<div class="empty"><span class="ic">🔎</span>' + msg + '</div>'));
      return;
    }
    renderPaginado(listWrap, rows, function (i) {
      const resumo = '<div class="list-item__sub" style="color:var(--st-risco);font-weight:600;margin-top:2px">⚠ ' + escapeHtml(i.RESUMO_OCORRENCIAS) + '</div>';
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          '<span><span class="shiplabel">' + escapeHtml(i.ID_INSPECAO) + '</span>' +
          '<div class="list-item__title" style="margin-top:6px">' + escapeHtml(i.ARMAZEM) + ' — ' + escapeHtml(i.USUARIO) + '</div>' +
          '<div class="list-item__sub">' + escapeHtml(i.DATA) + ' ' + escapeHtml(i.HORA) + '</div>' +
          resumo + '</span>' +
          '<span class="tag ' + statusInspecaoTag(i.RESULTADO) + '">' + statusInspecaoLabel(i.RESULTADO) + '</span>' +
        '</button>'
      );
      item.onclick = function () { go('inspecaoDetalheAdmin', { inspecaoAtual: i }); };
      return item;
    });
  }
  selArm.onchange = load;
  document.getElementById('fResultado').onchange = load;
  load();
}

function statusInspecaoLabel(r) {
  return { PENDENTE_VALIDACAO: 'Pendente', APROVADA: 'Aprovada', REPROVADA: 'Reprovada' }[r] || r;
}
function statusInspecaoTag(r) {
  return { PENDENTE_VALIDACAO: 'tag--aberta', APROVADA: 'tag--finalizada', REPROVADA: 'tag--risco' }[r] || 'tag--aberta';
}

async function renderInspecaoDetalheAdmin() {
  const i = S.inspecaoAtual;
  appendHtml(app,
    screenHeader('Inspeção ' + i.ID_INSPECAO, i.ARMAZEM) +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go('validacaoInspecoes'); };

  const card = el('<div class="card stack" id="detalhe"><p class="subtle">Carregando…</p></div>');
  app.appendChild(card);

  const det = await api('getInspecaoDetalhe', { idInspecao: i.ID_INSPECAO }).catch(function () { return null; });
  card.innerHTML = '';
  card.appendChild(el('<div class="row between"><span class="subtle">Conferente</span><strong>' + escapeHtml(i.USUARIO) + '</strong></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Data / hora</span><strong>' + escapeHtml(i.DATA) + ' ' + escapeHtml(i.HORA) + '</strong></div>'));
  if (i.OBSERVACAO) card.appendChild(el('<p class="subtle">Obs: ' + escapeHtml(i.OBSERVACAO) + '</p>'));
  card.appendChild(el('<div class="divider"></div>'));

  if (det && (det.ocorrencias.length || det.capturas.length)) {
    det.ocorrencias.forEach(function (o) {
      const box = el(
        '<div class="stack" style="padding:10px 0;border-bottom:1px solid var(--line)">' +
          '<div class="row between"><strong>' + escapeHtml(o.TIPO) + '</strong>' +
          '<button type="button" class="btn btn--outline btn--sm" data-role="btnEditar">✏️ Editar</button></div>' +
          '<p class="subtle" data-role="descricaoTexto">' + escapeHtml(o.DESCRICAO) + '</p>' +
          (o.DESCRICAO_ORIGINAL ? '<p class="subtle" style="font-size:11.5px;color:var(--st-risco)">Original: ' + escapeHtml(o.DESCRICAO_ORIGINAL) + '</p>' : '') +
          (o.FOTO ? fotosGaleria(o.FOTO) : '') +
          '<div data-role="editWrap" style="display:none"></div>' +
        '</div>'
      );
      const btnEditar = box.querySelector('[data-role="btnEditar"]');
      const textoAtual = box.querySelector('[data-role="descricaoTexto"]');
      const editWrap = box.querySelector('[data-role="editWrap"]');
      btnEditar.onclick = function () {
        const aberto = editWrap.style.display !== 'none';
        editWrap.style.display = aberto ? 'none' : 'flex';
        editWrap.className = 'stack';
        editWrap.innerHTML = '';
        if (aberto) return;
        const campo = textField(editWrap, { label: 'Corrigir descrição', multiline: true, value: o.DESCRICAO });
        const btnSalvar = el('<button class="btn btn--primary btn--sm" style="align-self:flex-start">Salvar correção</button>');
        editWrap.appendChild(btnSalvar);
        btnSalvar.onclick = async function () {
          const novaDescricao = campo.getValue();
          if (!novaDescricao) { toast('A descrição não pode ficar vazia', true); return; }
          btnSalvar.disabled = true; btnSalvar.textContent = 'Salvando…';
          try {
            await api('corrigirOcorrencia', { idOcorrenciaRegistro: o.ID_OCORRENCIA_REGISTRO, novaDescricao: novaDescricao, adminCorrigiu: S.usuario.NOME });
            o.DESCRICAO_ORIGINAL = o.DESCRICAO_ORIGINAL || o.DESCRICAO;
            o.DESCRICAO = novaDescricao;
            textoAtual.textContent = novaDescricao;
            editWrap.style.display = 'none';
            toast('Descrição corrigida.', false, true);
          } catch (e) { btnSalvar.disabled = false; btnSalvar.textContent = 'Salvar correção'; }
        };
      };
      card.appendChild(box);
    });
    det.capturas.forEach(function (c) {
      const box = el(
        '<div class="stack" style="padding:10px 0;border-bottom:1px solid var(--line)">' +
          '<div class="row between"><strong>Captura — ' + escapeHtml(c.ARMADILHA) + '</strong>' +
          '<button type="button" class="btn btn--outline btn--sm" data-role="btnEditar">✏️ Editar</button></div>' +
          '<p class="subtle" data-role="qtdTexto">Quantidade: ' + escapeHtml(c.QUANTIDADE) + (c.BAIA ? ' · Baia: ' + escapeHtml(c.BAIA) : '') + '</p>' +
          (c.QUANTIDADE_ORIGINAL !== undefined && c.QUANTIDADE_ORIGINAL !== '' ? '<p class="subtle" style="font-size:11.5px;color:var(--st-risco)">Quantidade original: ' + escapeHtml(c.QUANTIDADE_ORIGINAL) + '</p>' : '') +
          '<div data-role="editWrap" style="display:none"></div>' +
        '</div>'
      );
      const btnEditar = box.querySelector('[data-role="btnEditar"]');
      const textoAtual = box.querySelector('[data-role="qtdTexto"]');
      const editWrap = box.querySelector('[data-role="editWrap"]');
      btnEditar.onclick = function () {
        const aberto = editWrap.style.display !== 'none';
        editWrap.style.display = aberto ? 'none' : 'flex';
        editWrap.className = 'stack';
        editWrap.innerHTML = '';
        if (aberto) return;
        const campo = textField(editWrap, { label: 'Corrigir quantidade', type: 'number', value: c.QUANTIDADE });
        const btnSalvar = el('<button class="btn btn--primary btn--sm" style="align-self:flex-start">Salvar correção</button>');
        editWrap.appendChild(btnSalvar);
        btnSalvar.onclick = async function () {
          const novaQuantidade = campo.getValue();
          if (novaQuantidade === '') { toast('Informe a quantidade', true); return; }
          btnSalvar.disabled = true; btnSalvar.textContent = 'Salvando…';
          try {
            await api('corrigirCaptura', { idCaptura: c.ID_CAPTURA, novaQuantidade: Number(novaQuantidade), adminCorrigiu: S.usuario.NOME });
            c.QUANTIDADE_ORIGINAL = (c.QUANTIDADE_ORIGINAL !== undefined && c.QUANTIDADE_ORIGINAL !== '') ? c.QUANTIDADE_ORIGINAL : c.QUANTIDADE;
            c.QUANTIDADE = novaQuantidade;
            textoAtual.textContent = 'Quantidade: ' + novaQuantidade + (c.BAIA ? ' · Baia: ' + c.BAIA : '');
            editWrap.style.display = 'none';
            toast('Quantidade corrigida.', false, true);
          } catch (e) { btnSalvar.disabled = false; btnSalvar.textContent = 'Salvar correção'; }
        };
      };
      card.appendChild(box);
    });
  } else {
    card.appendChild(el('<p class="subtle">Nenhuma ocorrência ou captura registrada nesta inspeção.</p>'));
  }

  const actWrap = el('<div class="card stack"><h3 class="title-lg">Avaliar inspeção</h3><p class="subtle" style="margin-top:-6px">Reprovar exclui esses registros dos dashboards (avaria/goteira/risco/captura tratados como não confirmados)</p></div>');
  app.appendChild(actWrap);
  const row = el('<div class="row" style="gap:10px"></div>');
  actWrap.appendChild(row);
  const btnAprovar = el('<button class="btn btn--primary" style="flex:1">Aprovada</button>');
  const btnReprovar = el('<button class="btn btn--danger" style="flex:1">Reprovada</button>');
  row.appendChild(btnAprovar); row.appendChild(btnReprovar);

  btnAprovar.onclick = async function () {
    await api('validarInspecao', { idInspecao: i.ID_INSPECAO, resultado: 'APROVADA' });
    toast('Inspeção aprovada.', false, true);
    go('validacaoInspecoes');
  };
  btnReprovar.onclick = async function () {
    await api('validarInspecao', { idInspecao: i.ID_INSPECAO, resultado: 'REPROVADA' });
    toast('Inspeção reprovada — os registros não vão contar nos dashboards.', true);
    go('validacaoInspecoes');
  };
}

// ------------------------- ADMIN: REGISTRAR PENDÊNCIA -------------------------

async function renderRegistrarPendencia() {
  const origem = S.pendenciaOrigemInspecao;
  app.appendChild(el(screenHeader('Registrar pendência', origem ? 'A partir da inspeção ' + origem.ID_INSPECAO : 'Registro manual')));
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  const armazens = await api('getArmazens', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  const ocorrTipos = await api('getOcorrenciasTipos', {}).catch(function () { return []; });

  const armazemSel = selectField(card, { label: 'Armazém', options: armazens.map(function (a) { return { value: a.ARMAZEM, label: a.ARMAZEM }; }) });
  if (origem) armazemSel.select.value = origem.ARMAZEM;

  const tipoSel = selectField(card, { label: 'Ocorrência encontrada', options: ocorrTipos.map(function (o) { return { value: o.TIPO, label: o.TIPO }; }) });
  const outroWrap = el('<div style="display:none"></div>');
  card.appendChild(outroWrap);
  let outroField = null;
  tipoSel.select.onchange = function () {
    outroWrap.style.display = tipoSel.getValue() === 'Outro' ? 'block' : 'none';
    outroWrap.innerHTML = '';
    if (tipoSel.getValue() === 'Outro') outroField = textField(outroWrap, { label: 'Descreva a ocorrência' });
  };

  const descWrap = el('<div></div>');
  card.appendChild(descWrap);
  const descField = textField(descWrap, { label: 'Descrição adicional (opcional)', multiline: true });
  const foto = photoField(card, { label: 'Foto/evidência' });

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Registrar pendência</button>');
  card.appendChild(btn);
  btn.onclick = async function () {
    if (!armazemSel.getValue()) { toast('Selecione o armazém', true); return; }
    if (!tipoSel.getValue()) { toast('Selecione a ocorrência', true); return; }
    btn.disabled = true; btn.textContent = 'Registrando…';
    try {
      const data = await api('createPendencia', {
        unidade: S.unidade.UNIDADE, armazem: armazemSel.getValue(),
        idInspecao: origem ? origem.ID_INSPECAO : '', conferente: origem ? origem.USUARIO : '',
        admin: S.usuario.NOME, origem: origem ? 'INSPECAO' : 'MANUAL',
        tipo: tipoSel.getValue() === 'Outro' && outroField ? outroField.getValue() : tipoSel.getValue(),
        descricao: descField.getValue(), fotos: foto.getValue()
      });
      if (tipoSel.getValue() === 'Outro' && outroField && outroField.getValue()) {
        api('adicionarOcorrenciaTipo', { tipo: outroField.getValue() }).catch(function () {});
      }
      toast('Pendência ' + data.idPendencia + ' registrada para ' + (data.responsavel || 'responsável não definido') + '.', false, true);
      S.pendenciaOrigemInspecao = null;
      go('dashPendencias');
    } catch (e) { btn.disabled = false; btn.textContent = 'Registrar pendência'; }
  };
}

// ------------------------- DASHBOARDS -------------------------

function dateToBR(d) {
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

function periodoRange(tipo) {
  const hoje = new Date();
  if (tipo === 'semana') {
    const inicio = new Date(hoje);
    const diaSemana = (inicio.getDay() + 6) % 7; // segunda = 0
    inicio.setDate(inicio.getDate() - diaSemana);
    return { dataInicial: dateToBR(inicio), dataFinal: dateToBR(hoje) };
  }
  if (tipo === 'mes') {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return { dataInicial: dateToBR(inicio), dataFinal: dateToBR(hoje) };
  }
  return { dataInicial: '', dataFinal: '' };
}

const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Descrição do período pra mostrar no relatório: em vez de só "Esta semana"
// ou "Este mês", mostra a semana do mês e o intervalo de dias de fato —
// ex: "3ª semana de agosto (dia 18 a dia 24)" ou "Mês de agosto (dia 1 a dia 24)".
function descricaoPeriodoDetalhada(tipo, range) {
  if (tipo === 'tudo') return 'Todo o período';
  if (tipo === 'custom') return (range.dataInicial || '…') + ' até ' + (range.dataFinal || '…');
  if (!range.dataInicial) return tipo === 'semana' ? 'Esta semana' : 'Este mês';

  const partesIni = range.dataInicial.split('/'); // [DD, MM, AAAA]
  const diaIni = Number(partesIni[0]);
  const mesIni = Number(partesIni[1]);
  const nomeMes = MESES_PT[mesIni - 1];
  const diaFim = range.dataFinal ? range.dataFinal.split('/')[0] : partesIni[0];

  if (tipo === 'mes') {
    return 'Mês de ' + nomeMes + ' (dia ' + partesIni[0] + ' a dia ' + diaFim + ')';
  }
  // semana: número da semana dentro do mês, calculado a partir do dia inicial
  const semanaDoMes = Math.ceil(diaIni / 7);
  const ordinais = ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª'];
  const ordinal = ordinais[semanaDoMes - 1] || (semanaDoMes + 'ª');
  return ordinal + ' semana de ' + nomeMes + ' (dia ' + partesIni[0] + ' a dia ' + diaFim + ')';
}

async function renderDashInspecoes() {
  app.appendChild(el(screenHeader('Painel do dia', S.unidade.UNIDADE)));
  const body = el('<div class="stack" id="body"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const d = await api('getDashboardInspecoes', { unidade: S.unidade.UNIDADE }).catch(function () { return null; });
  body.innerHTML = '';
  if (!d) return;

  body.appendChild(el('<p class="subtle">Referente a hoje, ' + escapeHtml(d.data) + '</p>'));
  body.appendChild(el(
    '<div class="kpi-grid">' +
      kpi(d.inspecoesFeitas + '/' + d.totalArmazens, 'Inspeções feitas hoje') +
      kpi(d.checklistsFeitos + '/' + d.totalArmazens, 'Checklists diários feitos') +
    '</div>'
  ));

  const listCard = el('<div class="card stack"><h3 class="title-lg">Por armazém</h3></div>');
  body.appendChild(listCard);

  if (!d.armazens.length) {
    listCard.appendChild(el('<p class="subtle">Nenhum armazém ativo cadastrado.</p>'));
  } else {
    d.armazens.forEach(function (a) {
      const inspTag = a.inspecaoFeita
        ? '<span class="tag tag--finalizada">Inspeção ✓ ' + escapeHtml(a.inspecaoHora) + '</span>'
        : '<span class="tag tag--aberta">Inspeção pendente</span>';
      const chkTag = a.checklistFeito
        ? '<span class="tag tag--finalizada">Limpeza ✓</span>'
        : '<span class="tag tag--aberta">Limpeza pendente</span>';
      listCard.appendChild(el(
        '<div class="list-item" style="cursor:default;flex-wrap:wrap;gap:8px">' +
          '<span><span class="list-item__title">' + escapeHtml(a.armazem) + '</span>' +
          (a.inspecaoFeita ? '<div class="list-item__sub">Feita por ' + escapeHtml(a.inspecaoUsuario) + '</div>' : '') +
          '</span>' +
          '<span class="row" style="gap:6px">' + inspTag + chkTag + '</span>' +
        '</div>'
      ));
    });
  }
}

// ------------------------- RELATÓRIOS (download em CSV) -------------------------
// Reaproveita as mesmas actions dos dashboards (já respeitam a unidade da
// sessão e aceitam os mesmos filtros de período/armazém).

const REPORTS = {
  carunchos: {
    titulo: 'Carunchos', icone: '🐞',
    descricao: 'Todas as capturas registradas nas inspeções',
    action: 'getDashboardCarunchos',
    getRows: function (d) { return d.registros; },
    colunas: [['ID_CAPTURA', 'ID'], ['DATA', 'Data'], ['ARMAZEM', 'Armazém'], ['ARMADILHA', 'Armadilha'], ['QUANTIDADE', 'Quantidade'], ['PRODUTO_PROXIMO', 'Produto próximo'], ['BAIA', 'Baia'], ['OBSERVACAO', 'Observação'], ['USUARIO', 'Conferente']]
  },
  checklist: {
    titulo: 'Checklist de limpeza', icone: '🧹',
    descricao: 'Itens de checklist preenchidos pelos conferentes',
    action: 'getDashboardChecklist',
    getRows: function (d) { return d.registros; },
    colunas: [['ID_CHECKLIST', 'ID'], ['DATA', 'Data'], ['HORA', 'Hora'], ['ARMAZEM', 'Armazém'], ['PERIODICIDADE', 'Periodicidade'], ['ITEM', 'Item'], ['RESULTADO', 'Resultado'], ['OBSERVACAO', 'Observação'], ['USUARIO', 'Conferente']]
  },
  inspecoes: {
    titulo: 'Inspeções', icone: '🔎',
    descricao: 'Inspeções dos galpões e seu status de validação',
    action: 'getInspecoes',
    getRows: function (d) { return d; },
    colunas: [['ID_INSPECAO', 'ID'], ['DATA', 'Data'], ['HORA', 'Hora'], ['ARMAZEM', 'Armazém'], ['USUARIO', 'Conferente'], ['RESULTADO', 'Resultado'], ['OBSERVACAO', 'Observação']]
  },
  pendencias: {
    titulo: 'Pendências', icone: '📋',
    descricao: 'Pendências abertas, em tratamento e finalizadas',
    action: 'getDashboardPendencias',
    getRows: function (d) { return d.registros; },
    colunas: [['ID_PENDENCIA', 'ID'], ['DATA_ABERTURA', 'Data abertura'], ['ARMAZEM', 'Armazém'], ['TIPO', 'Tipo'], ['DESCRICAO', 'Descrição'], ['RESPONSAVEL', 'Responsável'], ['CONFERENTE', 'Conferente'], ['STATUS', 'Status'], ['DATA_RESOLUCAO', 'Data resolução'], ['ADMIN_VALIDADOR', 'Validado por'], ['DATA_VALIDACAO', 'Data validação']]
  }
};

function renderRelatorios() {
  appendHtml(app, screenHeader('Relatórios', S.unidade.UNIDADE, 'Baixe em CSV (abre no Excel/Google Sheets)') + '<div class="stack"></div>');
  const wrap = app.querySelector('.stack:last-child');
  Object.keys(REPORTS).forEach(function (key) {
    const r = REPORTS[key];
    const card = el(menuCard(r.icone, r.titulo, r.descricao, 'x'));
    card.onclick = function () { go('relatorioDetalhe', { tipoRelatorio: key }); };
    wrap.appendChild(card);
  });
}

async function renderRelatorioDetalhe() {
  const cfg = REPORTS[S.tipoRelatorio];
  app.appendChild(el(screenHeader('Relatório · ' + cfg.titulo, S.unidade.UNIDADE)));

  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fPeriodo">' +
        '<option value="tudo">Todo o período</option>' +
        '<option value="semana">Esta semana</option>' +
        '<option value="mes">Este mês</option>' +
        '<option value="custom">Período personalizado</option>' +
      '</select>' +
      '<select id="fArmazem"><option value="">Todos os armazéns</option></select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const customWrap = el(
    '<div class="filters" id="customDates" style="display:none">' +
      '<input type="date" id="fDataInicial">' +
      '<input type="date" id="fDataFinal">' +
      '<button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button>' +
    '</div>'
  );
  app.appendChild(customWrap);

  const body = el('<div class="card stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const armazens = await api('getArmazens', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  const selArmazem = document.getElementById('fArmazem');
  armazens.forEach(function (a) { selArmazem.appendChild(el('<option value="' + escapeHtml(a.ARMAZEM) + '">' + escapeHtml(a.ARMAZEM) + '</option>')); });

  const selPeriodo = document.getElementById('fPeriodo');
  const customDates = document.getElementById('customDates');
  let ultimasLinhas = [];

  selPeriodo.onchange = function () {
    customDates.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selArmazem.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    let range = { dataInicial: '', dataFinal: '' };
    if (selPeriodo.value === 'custom') {
      const ini = document.getElementById('fDataInicial').value;
      const fim = document.getElementById('fDataFinal').value;
      if (ini) range.dataInicial = dateToBR(new Date(ini + 'T00:00:00'));
      if (fim) range.dataFinal = dateToBR(new Date(fim + 'T00:00:00'));
    } else {
      range = periodoRange(selPeriodo.value);
    }
    const d = await api(cfg.action, {
      unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
      dataInicial: range.dataInicial, dataFinal: range.dataFinal
    }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;
    ultimasLinhas = cfg.getRows(d) || [];

    body.appendChild(el('<div class="row between"><span class="subtle">Registros encontrados</span><span class="badge-count">' + ultimasLinhas.length + '</span></div>'));

    const btnRow = el('<div class="row" style="gap:8px;margin-top:10px"></div>');
    body.appendChild(btnRow);
    const btnBaixar = el('<button class="btn btn--primary" style="flex:1">⬇ CSV</button>');
    const btnPDF = el('<button class="btn btn--accent" style="flex:1">📄 PDF</button>');
    btnRow.appendChild(btnBaixar);
    btnRow.appendChild(btnPDF);

    const descricaoPeriodo = descricaoPeriodoDetalhada(selPeriodo.value, range);

    btnBaixar.onclick = function () {
      if (!ultimasLinhas.length) { toast('Nenhum registro para baixar com esses filtros', true); return; }
      const nomeArquivo = 'relatorio_' + S.tipoRelatorio + '_' + S.unidade.UNIDADE.replace(/\s+/g, '_') + '_' + dateToBR(new Date()).replace(/\//g, '-') + '.csv';
      downloadCSV(nomeArquivo, cfg.colunas, ultimasLinhas);
    };
    btnPDF.onclick = async function () {
      if (!ultimasLinhas.length) { toast('Nenhum registro para baixar com esses filtros', true); return; }
      btnPDF.disabled = true; btnPDF.textContent = 'Gerando…';
      try {
        const resultado = await api('gerarRelatorioPDF', {
          titulo: cfg.titulo, unidade: S.unidade.UNIDADE, periodo: descricaoPeriodo,
          colunas: cfg.colunas.map(function (c) { return c[1]; }),
          chaves: cfg.colunas.map(function (c) { return c[0]; }),
          linhas: ultimasLinhas
        });
        downloadBase64File(resultado.filename, resultado.base64, 'application/pdf');
        toast('PDF gerado!', false, true);
      } catch (e) { /* toast já mostrado pelo api() */ }
      btnPDF.disabled = false; btnPDF.textContent = '📄 PDF';
    };

    if (ultimasLinhas.length) {
      body.appendChild(el('<div class="divider" style="margin-top:6px"></div>'));
      body.appendChild(el('<p class="subtle">Pré-visualização (10 primeiros registros):</p>'));
      const tableWrap = el('<div style="overflow-x:auto"></div>');
      body.appendChild(tableWrap);
      tableWrap.appendChild(buildPreviewTable(cfg.colunas, ultimasLinhas.slice(0, 10)));
    }
  }
  load();
}

function buildPreviewTable(colunas, linhas) {
  const table = document.createElement('table');
  table.className = 'report-table';
  const thead = document.createElement('tr');
  colunas.forEach(function (c) { thead.appendChild(el('<th>' + escapeHtml(c[1]) + '</th>')); });
  table.appendChild(thead);
  linhas.forEach(function (linha) {
    const tr = document.createElement('tr');
    colunas.forEach(function (c) { tr.appendChild(el('<td>' + escapeHtml(linha[c[0]]) + '</td>')); });
    table.appendChild(tr);
  });
  return table;
}

// Gera um CSV no navegador e dispara o download — sem precisar de backend.
function downloadCSV(filename, colunas, linhas) {
  const esc = function (v) {
    v = v === undefined || v === null ? '' : String(v);
    if (v.indexOf(',') > -1 || v.indexOf('"') > -1 || v.indexOf('\n') > -1) {
      v = '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  };
  const lines = [colunas.map(function (c) { return esc(c[1]); }).join(',')];
  linhas.forEach(function (linha) {
    lines.push(colunas.map(function (c) { return esc(linha[c[0]]); }).join(','));
  });
  const csv = '\uFEFF' + lines.join('\r\n'); // BOM: acentos abrem certo no Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Relatório baixado!', false, true);
}

// Converte o PDF (vindo em base64 do Apps Script) num arquivo real e
// dispara o download no navegador.
function downloadBase64File(filename, base64, mime) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function renderResumoGeral() {
  appendHtml(app, screenHeader('Resumo geral', S.unidade.UNIDADE, 'Os mesmos números do relatório semanal, num lugar só'));

  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fPeriodo">' +
        '<option value="semana">Esta semana</option>' +
        '<option value="mes">Este mês</option>' +
        '<option value="tudo">Todo o período</option>' +
        '<option value="custom">Período personalizado</option>' +
      '</select>' +
      '<select id="fArmazem"><option value="">Todos os armazéns</option></select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const customWrap = el(
    '<div class="filters" id="customDates" style="display:none">' +
      '<input type="date" id="fDataInicial">' +
      '<input type="date" id="fDataFinal">' +
      '<button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button>' +
    '</div>'
  );
  app.appendChild(customWrap);

  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const armazens = await api('getArmazens', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  const selArmazem = document.getElementById('fArmazem');
  armazens.forEach(function (a) { selArmazem.appendChild(el('<option value="' + escapeHtml(a.ARMAZEM) + '">' + escapeHtml(a.ARMAZEM) + '</option>')); });

  const selPeriodo = document.getElementById('fPeriodo');
  const customDates = document.getElementById('customDates');
  selPeriodo.onchange = function () {
    customDates.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selArmazem.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    let range = { dataInicial: '', dataFinal: '' };
    if (selPeriodo.value === 'custom') {
      const ini = document.getElementById('fDataInicial').value;
      const fim = document.getElementById('fDataFinal').value;
      if (ini) range.dataInicial = dateToBR(new Date(ini + 'T00:00:00'));
      if (fim) range.dataFinal = dateToBR(new Date(fim + 'T00:00:00'));
    } else {
      range = periodoRange(selPeriodo.value);
    }
    const d = await api('getResumoGeral', {
      unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
      dataInicial: range.dataInicial, dataFinal: range.dataFinal
    }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;

    const totalApontamentos = d.avarias + d.goteiras + d.riscoQuedaTombamento;
    body.appendChild(el(
      '<div class="card stack">' +
        '<p class="subtle" style="margin:0">' + escapeHtml(d.armazensComRonda) + ' armazém(ns) com ronda · <strong style="color:var(--ink)">' + escapeHtml(d.totalInspecoes) + ' rondas</strong> · <strong style="color:var(--st-risco)">' + totalApontamentos + ' apontamentos</strong></p>' +
      '</div>'
    ));

    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(d.totalInspecoes, 'Inspeções (rondas)') +
        kpi(d.totalChecklists, 'Checklists realizados') +
        kpi(d.avarias, 'Avarias') +
        kpi(d.goteiras, 'Goteiras') +
        kpi(d.riscoQuedaTombamento, 'Risco queda/tombamento') +
        kpi(d.sujidades, 'Sujidades (checklist)') +
        kpi(d.capturasTotal, 'Carunchos capturados') +
        kpi(d.diasSemCaptura, 'Dias c/ ronda sem captura') +
      '</div>'
    ));

    if (d.diasSemCaptura > 0 && d.diasSemCapturaMaior) {
      const fmtSeq = function (seq) {
        return seq.dataInicio === seq.dataFim
          ? seq.dias + ' dia(s) (dia ' + seq.dataInicio + ')'
          : seq.dias + ' dia(s) (de ' + seq.dataInicio + ' a ' + seq.dataFim + ')';
      };
      const mesmaSequencia = d.diasSemCapturaMaior.dataInicio === d.diasSemCapturaMenor.dataInicio && d.diasSemCapturaMaior.dataFim === d.diasSemCapturaMenor.dataFim;
      let linhasSeq = '';
      if (mesmaSequencia && !d.diasSemCapturaAtual) {
        linhasSeq += '<p class="subtle" style="margin:2px 0"><strong>Única sequência sem captura:</strong> ' + fmtSeq(d.diasSemCapturaMaior) + '</p>';
      } else {
        linhasSeq += '<p class="subtle" style="margin:2px 0"><strong>Maior sequência sem captura:</strong> ' + fmtSeq(d.diasSemCapturaMaior) + '</p>';
        if (!mesmaSequencia) linhasSeq += '<p class="subtle" style="margin:2px 0"><strong>Menor sequência sem captura:</strong> ' + fmtSeq(d.diasSemCapturaMenor) + '</p>';
      }
      if (d.diasSemCapturaAtual) {
        linhasSeq += '<p style="margin:2px 0;color:#8B5CF6;font-weight:600">Sequência atual em aberto: ' + d.diasSemCapturaAtual.dias + ' dia(s) (desde ' + d.diasSemCapturaAtual.dataInicio + ' até o fim do período analisado)</p>';
      }
      body.appendChild(el('<div class="card stack" style="text-align:center">' + linhasSeq + '</div>'));
    }

    body.appendChild(barCard('Rondas por conferente', d.porConferente));
    body.appendChild(barCard('Dias sem captura por armazém', d.diasSemCapturaPorArmazem));

    const descricaoPeriodo = descricaoPeriodoDetalhada(selPeriodo.value, range);

    const btnPDF = el('<button class="btn btn--accent btn--block">📄 Baixar PDF (com gráficos, mapa e comparativo)</button>');
    body.appendChild(btnPDF);
    btnPDF.onclick = async function () {
      btnPDF.disabled = true; btnPDF.textContent = 'Montando mapas…';
      try {
        const mapasImagens = await capturarImagensDosMapas(range);

        let anterior = null;
        let descricaoAnterior = '';
        if (selPeriodo.value !== 'tudo') {
          const rangeAnterior = periodoAnteriorRange(range);
          if (rangeAnterior) {
            btnPDF.textContent = 'Calculando período anterior…';
            anterior = await api('getResumoGeral', {
              unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
              dataInicial: rangeAnterior.dataInicial, dataFinal: rangeAnterior.dataFinal
            }).catch(function () { return null; });
            descricaoAnterior = rangeAnterior.dataInicial + ' até ' + rangeAnterior.dataFinal;
          }
        }

        btnPDF.textContent = 'Gerando PDF…';
        const resultado = await api('gerarResumoPDF', {
          unidade: S.unidade.UNIDADE, periodo: descricaoPeriodo, resumo: d, mapasImagens: mapasImagens,
          resumoAnterior: anterior, periodoAnterior: descricaoAnterior
        });
        downloadBase64File(resultado.filename, resultado.base64, 'application/pdf');
        toast('PDF gerado!', false, true);
      } catch (e) { /* toast já mostrado */ }
      btnPDF.disabled = false; btnPDF.textContent = '📄 Baixar PDF (com gráficos, mapa e comparativo)';
    };

    body.appendChild(el(
      '<p class="subtle" style="text-align:center">Quer o detalhe de cada tipo? Veja "Ocorrências da inspeção", "Dashboard de carunchos" ou "Dashboard de limpeza" no menu.</p>'
    ));
  }
  load();
}

// Desenha cada mapa (imagem base + marcadores coloridos, igual à tela de
// Mapa de Capturas — ou os pontos de goteira, igual à tela de Mapa de
// Goteiras) num <canvas> escondido e exporta como PNG base64, para embutir
// no PDF do jeito que aparece no app.
async function capturarImagensDosMapas(range) {
  range = range || {};
  const mapas = await api('getMapasDisponiveis', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  const resultado = [];
  for (const mapa of mapas) {
    try {
      const pontos = await api('getMapaCapturas', { unidade: S.unidade.UNIDADE, mapa: mapa, dataInicial: range.dataInicial || '', dataFinal: range.dataFinal || '' });
      const base64 = await desenharMapaEmCanvas('assets/mapas/' + mapa, pontos, 'carunchos');
      if (base64) resultado.push({ label: MAPA_LABEL[mapa] || mapa, base64: base64, tipo: 'CARUNCHO' });
    } catch (e) { /* pula esse mapa se der erro */ }
  }
  for (const mapa of mapas) {
    try {
      const pontosGoteira = await api('getMapaGoteiras', { unidade: S.unidade.UNIDADE, mapa: mapa });
      if (!pontosGoteira.length) continue; // não vale a pena gerar slide/página de um mapa sem nenhuma goteira ativa
      const base64 = await desenharMapaEmCanvas('assets/mapas/' + mapa, pontosGoteira, 'goteiras');
      if (base64) resultado.push({ label: MAPA_LABEL[mapa] || mapa, base64: base64, tipo: 'GOTEIRA' });
    } catch (e) { /* pula esse mapa se der erro */ }
  }
  return resultado;
}

function desenharMapaEmCanvas(srcImagem, pontos, modo) {
  modo = modo || 'carunchos';
  return new Promise(function (resolve) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        pontos.forEach(function (p, i) {
          if (p.xPct === '' || p.xPct === null || p.xPct === undefined) return;
          const x = (p.xPct / 100) * canvas.width;
          const y = (p.yPct / 100) * canvas.height;
          const raio = Math.max(10, canvas.width * 0.014);
          ctx.beginPath();
          ctx.arc(x, y, raio, 0, Math.PI * 2);
          ctx.fillStyle = modo === 'goteiras' ? '#3b82c4' : corMarcador(p.quantidade);
          ctx.fill();
          ctx.lineWidth = Math.max(1.5, raio * 0.15);
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold ' + Math.round(raio * 0.9) + 'px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // Goteira não tem posição numerada fixa como a armadilha — numera
          // pela ordem de marcação em vez de mostrar um número de item.
          ctx.fillText(modo === 'goteiras' ? '✕' : String(p.armadilha), x, y);
        });
        resolve(canvas.toDataURL('image/png'));
      } catch (e) { resolve(null); }
    };
    img.onerror = function () { resolve(null); };
    img.src = srcImagem;
  });
}

async function renderDashOcorrencias() {
  app.appendChild(el(screenHeader('Ocorrências da inspeção', S.unidade.UNIDADE)));

  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fPeriodo">' +
        '<option value="tudo">Todo o período</option>' +
        '<option value="semana">Esta semana</option>' +
        '<option value="mes">Este mês</option>' +
        '<option value="custom">Período personalizado</option>' +
      '</select>' +
      '<select id="fArmazem"><option value="">Todos os armazéns</option></select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const customWrap = el(
    '<div class="filters" id="customDates" style="display:none">' +
      '<input type="date" id="fDataInicial">' +
      '<input type="date" id="fDataFinal">' +
      '<button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button>' +
    '</div>'
  );
  app.appendChild(customWrap);

  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const armazens = await api('getArmazens', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  const selArmazem = document.getElementById('fArmazem');
  armazens.forEach(function (a) { selArmazem.appendChild(el('<option value="' + escapeHtml(a.ARMAZEM) + '">' + escapeHtml(a.ARMAZEM) + '</option>')); });

  const selPeriodo = document.getElementById('fPeriodo');
  const customDates = document.getElementById('customDates');
  selPeriodo.onchange = function () {
    customDates.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selArmazem.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    let range = { dataInicial: '', dataFinal: '' };
    if (selPeriodo.value === 'custom') {
      const ini = document.getElementById('fDataInicial').value;
      const fim = document.getElementById('fDataFinal').value;
      if (ini) range.dataInicial = dateToBR(new Date(ini + 'T00:00:00'));
      if (fim) range.dataFinal = dateToBR(new Date(fim + 'T00:00:00'));
    } else {
      range = periodoRange(selPeriodo.value);
    }
    const d = await api('getDashboardOcorrencias', {
      unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
      dataInicial: range.dataInicial, dataFinal: range.dataFinal
    }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;

    let comparativoHtml = '';
    if (selPeriodo.value !== 'tudo') {
      const rangeAnterior = periodoAnteriorRange(range);
      if (rangeAnterior) {
        const dAnterior = await api('getDashboardOcorrencias', {
          unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
          dataInicial: rangeAnterior.dataInicial, dataFinal: rangeAnterior.dataFinal
        }).catch(function () { return null; });
        if (dAnterior) comparativoHtml = comparativoBadge(d.total, dAnterior.total, true);
      }
    }

    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(d.total, 'Total de ocorrências') +
        kpi(d.produtoAvariado.total, 'Produto avariado') +
        kpi(d.goteira.total, 'Goteiras') +
        kpi(d.riscoQuedaTombamento.total, 'Risco queda/tombamento') +
      '</div>'
    ));
    if (comparativoHtml) body.appendChild(el('<div style="margin-top:-4px">' + comparativoHtml + '</div>'));

    body.appendChild(barCard('Ocorrências por armazém (todos os tipos)', d.porArmazem));
    body.appendChild(barCard('Produto avariado por armazém', d.produtoAvariado.porArmazem));
    body.appendChild(barCard('Goteiras por armazém', d.goteira.porArmazem));
    body.appendChild(barCard('Risco de queda/tombamento por armazém', d.riscoQuedaTombamento.porArmazem));
    body.appendChild(evolucaoCard('Evolução das ocorrências por data', d.registros));

    if (d.registros.length) {
      const listCard = el('<div class="card stack"><h3 class="title-lg">Ocorrências recentes</h3></div>');
      body.appendChild(listCard);
      const tableWrap = el('<div style="overflow-x:auto"></div>');
      listCard.appendChild(tableWrap);
      const recentes = d.registros.slice().sort(function (a, b) {
        const da = parseBR(a.DATA), db = parseBR(b.DATA);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
      }).slice(0, 15);
      tableWrap.appendChild(buildPreviewTable(
        [['DATA', 'Data'], ['ARMAZEM', 'Armazém'], ['TIPO', 'Tipo'], ['DESCRICAO', 'Descrição'], ['USUARIO', 'Conferente']],
        recentes
      ));
    }
  }
  load();
}

// ------------------------- MANUTENÇÕES (área separada de Pendências) -------------------------

async function renderManutencoes() {
  app.appendChild(el(screenHeader('Manutenções', S.unidade.UNIDADE)));

  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fStatus">' +
        '<option value="">Todos os status</option>' +
        '<option value="NAO_INICIADO">Não iniciado</option>' +
        '<option value="EM_ANDAMENTO">Em andamento</option>' +
        '<option value="AGUARDANDO_APROVACAO">Aguardando aprovação</option>' +
        '<option value="FINALIZADA">Finalizada</option>' +
      '</select>' +
      '<select id="fArmazem"><option value="">Todos os armazéns</option></select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const armazens = await api('getArmazens', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  const selArmazem = document.getElementById('fArmazem');
  armazens.forEach(function (a) { selArmazem.appendChild(el('<option value="' + escapeHtml(a.ARMAZEM) + '">' + escapeHtml(a.ARMAZEM) + '</option>')); });
  const selStatus = document.getElementById('fStatus');
  selArmazem.onchange = load;
  selStatus.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    const d = await api('getDashboardManutencoes', { unidade: S.unidade.UNIDADE, armazem: selArmazem.value }).catch(function () { return null; });
    const lista = await api('getManutencoes', { unidade: S.unidade.UNIDADE, armazem: selArmazem.value, status: selStatus.value }).catch(function () { return []; });
    body.innerHTML = '';
    if (!d) return;

    body.appendChild(el(
      '<div class="kpi-grid">' + kpi(d.naoIniciadas, 'Não iniciadas') + kpi(d.emAndamento, 'Em andamento') + kpi(d.aguardandoAprovacao, 'Aguard. aprovação') + kpi(d.concluidas, 'Finalizadas') + '</div>'
    ));
    body.appendChild(barCard('Por armazém', d.porArmazem));
    body.appendChild(barCard('Por tipo', d.porTipo));
    body.appendChild(evolucaoCard('Evolução das manutenções por data', d.registros, function (r) { return String(r.DATA_ABERTURA || '').split(' ')[0]; }));

    // Lista detalhada some por padrão pra não poluir a tela — só abre quando
    // o admin realmente precisa consultar item por item.
    const btnVerLista = el('<button class="btn btn--outline btn--block">📋 Ver lista de manutenções (' + lista.length + ')</button>');
    body.appendChild(btnVerLista);
    const listCard = el('<div class="card stack" style="display:none;margin-top:12px"><h3 class="title-lg">Lista de manutenções</h3></div>');
    body.appendChild(listCard);
    btnVerLista.onclick = function () {
      const abrindo = listCard.style.display === 'none';
      listCard.style.display = abrindo ? 'flex' : 'none';
      btnVerLista.textContent = (abrindo ? '📋 Esconder lista de manutenções (' : '📋 Ver lista de manutenções (') + lista.length + ')';
      if (abrindo) listCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (!lista.length) { listCard.appendChild(el('<p class="subtle">Nenhuma manutenção encontrada.</p>')); return; }
    renderPaginado(listCard, lista, function (m) {
      const info = MANUTENCAO_STATUS[m.STATUS] || { label: m.STATUS, cls: 'aberta' };
      const tag = '<span class="tag tag--' + info.cls + '">' + info.label + '</span>';
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          '<span><span class="shiplabel">' + escapeHtml(m.ID_MANUTENCAO) + '</span>' +
          '<div class="list-item__title" style="margin-top:6px">' + escapeHtml(m.TIPO) + ' — ' + escapeHtml(m.ARMAZEM) + '</div>' +
          '<div class="list-item__sub">' + escapeHtml(m.LOCAL) + ' · ' + escapeHtml(m.DATA_ABERTURA) + '</div></span>' +
          tag +
        '</button>'
      );
      item.onclick = function () { go('manutencaoDetalhe', { manutencaoAtual: m }); };
      return item;
    });
  }
  load();
}

// Tela do conferente: acompanhamento (leitura) de todas as manutenções da
// unidade, de qualquer armazém — mantendo o isolamento por unidade. Some
// da lista assim que vira Finalizada.
async function renderManutencoesConferente() {
  app.appendChild(el(screenHeader('Manutenções', 'Andamento na unidade ' + S.unidade.UNIDADE)));

  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fStatus">' +
        '<option value="">Todas ativas</option>' +
        '<option value="NAO_INICIADO">Não iniciado</option>' +
        '<option value="EM_ANDAMENTO">Em andamento</option>' +
        '<option value="AGUARDANDO_APROVACAO">Aguardando aprovação</option>' +
      '</select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const selStatus = document.getElementById('fStatus');
  selStatus.onchange = load;

  async function load() {
    listWrap.innerHTML = '<p class="subtle">Carregando…</p>';
    const lista = await api('getManutencoes', { unidade: S.unidade.UNIDADE, status: selStatus.value, apenasAtivas: true }).catch(function () { return []; });
    listWrap.innerHTML = '';
    if (!lista.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🔧</span>Nenhuma manutenção em andamento.</div>')); return; }
    renderPaginado(listWrap, lista, function (m) {
      const info = MANUTENCAO_STATUS[m.STATUS] || { label: m.STATUS, cls: 'aberta' };
      const item = el(
        '<button type="button" class="list-item" style="width:100%"><span><span class="shiplabel">' + escapeHtml(m.ID_MANUTENCAO) + '</span>' +
          '<div class="list-item__title" style="margin-top:6px">' + escapeHtml(m.TIPO) + ' — ' + escapeHtml(m.ARMAZEM) + '</div>' +
          '<div class="list-item__sub">' + escapeHtml(m.LOCAL) + ' · registrado por ' + escapeHtml(m.CONFERENTE) + '</div></span>' +
          '<span class="tag tag--' + info.cls + '">' + info.label + '</span>' +
        '</button>'
      );
      item.onclick = function () { go('manutencaoDetalhe', { manutencaoAtual: m }); };
      return item;
    });
  }
  load();
}

const MANUTENCAO_STATUS = {
  NAO_INICIADO: { label: 'Não iniciado', cls: 'aberta' },
  EM_ANDAMENTO: { label: 'Em andamento', cls: 'tratamento' },
  AGUARDANDO_APROVACAO: { label: 'Aguardando aprovação', cls: 'validacao' },
  FINALIZADA: { label: 'Finalizada', cls: 'finalizada' }
};

async function renderManutencaoDetalhe() {
  const m = S.manutencaoAtual;
  appendHtml(app,
    screenHeader('Manutenção ' + m.ID_MANUTENCAO, m.TIPO) +
    '<button class="btn btn--outline btn--sm" id="btnVoltar" style="align-self:flex-start;margin-top:-8px">← Voltar</button>'
  );
  document.getElementById('btnVoltar').onclick = function () { go(S.usuario.TIPO === 'ADMIN' ? 'manutencoes' : 'manutencoesConferente'); };

  const card = el('<div class="card stack"></div>');
  app.appendChild(card);
  const statusInfo = MANUTENCAO_STATUS[m.STATUS] || { label: m.STATUS, cls: 'aberta' };
  const tag = '<span class="tag tag--' + statusInfo.cls + '">' + statusInfo.label + '</span>';
  card.appendChild(el('<div class="row between"><span class="subtle">Status</span>' + tag + '</div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Armazém</span><strong>' + escapeHtml(m.ARMAZEM) + '</strong></div>'));
  card.appendChild(el('<div class="row between"><span class="subtle">Local</span><strong>' + escapeHtml(m.LOCAL) + '</strong></div>'));

  // ---- Linha do tempo: abertura, cada retorno do admin, e finalização ----
  const timelineWrap = el('<div class="card stack"><h3 class="title-lg">Linha do tempo</h3><p class="subtle" id="tlLoading">Carregando…</p></div>');
  app.appendChild(timelineWrap);
  const TIPO_INFO = {
    ABERTURA: { label: 'Abertura', quem: 'Conferente', dot: '#5e9030' },
    RETORNO: { label: 'Retorno', quem: 'Admin', dot: '#df8630' },
    FINALIZACAO: { label: 'Finalização', quem: 'Admin', dot: '#9aa0a6' }
  };
  api('getHistoricoManutencao', { idManutencao: m.ID_MANUTENCAO }).then(function (historico) {
    document.getElementById('tlLoading').remove();
    // Registros antigos (antes dessa funcionalidade existir) não têm a
    // entrada de ABERTURA na aba de histórico — reconstrói a partir dos
    // dados que já existiam na manutenção, pra linha do tempo não ficar vazia.
    if (!historico.some(function (h) { return h.TIPO === 'ABERTURA'; })) {
      historico.unshift({ TIPO: 'ABERTURA', AUTOR: m.CONFERENTE, DATA: m.DATA_ABERTURA, STATUS_NOVO: 'NAO_INICIADO', COMENTARIO: m.DESCRICAO, FOTO: m.FOTO });
    }
    historico.forEach(function (h, i) {
      const info = TIPO_INFO[h.TIPO] || { label: h.TIPO, quem: '', dot: '#9aa0a6' };
      const statusLabel = MANUTENCAO_STATUS[h.STATUS_NOVO] ? MANUTENCAO_STATUS[h.STATUS_NOVO].label : h.STATUS_NOVO;
      const isLast = i === historico.length - 1;
      const item = el(
        '<div class="row" style="gap:10px;align-items:flex-start">' +
          '<div class="stack" style="align-items:center;gap:0;flex:0 0 auto">' +
            '<span style="width:10px;height:10px;border-radius:50%;background:' + info.dot + ';flex:0 0 auto"></span>' +
            (isLast ? '' : '<span style="width:1px;flex:1;background:var(--line);min-height:24px"></span>') +
          '</div>' +
          '<div class="stack" style="gap:2px;padding-bottom:16px;flex:1">' +
            '<span style="font-size:13px;font-weight:600">' + escapeHtml(info.label) + ' · ' + escapeHtml(info.quem) +
              (h.TIPO !== 'ABERTURA' ? ' <span class="subtle" style="font-weight:400">→ ' + escapeHtml(statusLabel) + '</span>' : '') + '</span>' +
            '<span class="subtle" style="font-size:12px">' + escapeHtml(h.AUTOR || '—') + ' · ' + escapeHtml(h.DATA || '') + '</span>' +
            (h.COMENTARIO ? '<span style="font-size:13px">' + escapeHtml(h.COMENTARIO) + '</span>' : '') +
            (h.FOTO ? fotosGaleria(h.FOTO) : '') +
          '</div>' +
        '</div>'
      );
      timelineWrap.appendChild(item);
    });
  }).catch(function () { document.getElementById('tlLoading').textContent = 'Não foi possível carregar a linha do tempo.'; });

  if (m.STATUS === 'FINALIZADA') return;

  // Só o admin muda o status — o conferente só acompanha (tela somente leitura).
  if (S.usuario.TIPO !== 'ADMIN') return;

  const statusWrap = el('<div class="card stack"><h3 class="title-lg">Atualizar status</h3></div>');
  app.appendChild(statusWrap);
  const row = el('<div class="option-grid" style="grid-template-columns:1fr 1fr"></div>');
  statusWrap.appendChild(row);
  const comentarioArea = el('<div class="stack" style="display:none"></div>');
  statusWrap.appendChild(comentarioArea);

  ['NAO_INICIADO', 'EM_ANDAMENTO', 'AGUARDANDO_APROVACAO'].forEach(function (st) {
    if (st === m.STATUS) return; // não mostra o status atual como opção
    const info = MANUTENCAO_STATUS[st];
    const btn = el('<button type="button" class="option-btn">' + info.label + '</button>');
    btn.onclick = function () {
      row.querySelectorAll('.option-btn').forEach(function (b) { b.classList.remove('is-selected'); });
      btn.classList.add('is-selected');
      comentarioArea.style.display = 'flex';
      comentarioArea.innerHTML = '';
      const campo = textField(comentarioArea, { label: 'Comentário para o conferente (opcional)', multiline: true, placeholder: 'Ex: equipe agendada para quinta-feira' });
      const btnConfirmar = el('<button class="btn btn--primary btn--sm" style="align-self:flex-start">Confirmar → ' + info.label + '</button>');
      comentarioArea.appendChild(btnConfirmar);
      btnConfirmar.onclick = async function () {
        btnConfirmar.disabled = true; btnConfirmar.textContent = 'Salvando…';
        try {
          await api('atualizarStatusManutencao', { idManutencao: m.ID_MANUTENCAO, status: st, comentario: campo.getValue(), autor: S.usuario.NOME });
          toast('Status atualizado para "' + info.label + '".', false, true);
          go('manutencoes');
        } catch (e) { btnConfirmar.disabled = false; btnConfirmar.textContent = 'Confirmar → ' + info.label; }
      };
    };
    row.appendChild(btn);
  });

  // Finalizar exige descrição + foto de comprovação
  const finalizarWrap = el('<div class="card stack"><h3 class="title-lg">Finalizar manutenção</h3></div>');
  app.appendChild(finalizarWrap);
  const desc = textField(finalizarWrap, { label: 'O que foi feito? *', multiline: true });
  const foto = photoField(finalizarWrap, { label: 'Foto de comprovação', required: true });
  const btnFinalizar = el('<button class="btn btn--primary btn--block">✓ Marcar como finalizada</button>');
  finalizarWrap.appendChild(btnFinalizar);
  btnFinalizar.onclick = async function () {
    if (!desc.getValue()) { toast('Descreva o que foi feito', true); return; }
    if (!foto.getValue().length) { toast('A foto de comprovação é obrigatória', true); return; }
    btnFinalizar.disabled = true; btnFinalizar.textContent = 'Enviando…';
    try {
      await api('atualizarStatusManutencao', { idManutencao: m.ID_MANUTENCAO, status: 'FINALIZADA', descricaoConclusao: desc.getValue(), fotosConclusao: foto.getValue(), autor: S.usuario.NOME });
      toast('Manutenção finalizada!', false, true);
      go('manutencoes');
    } catch (e) { btnFinalizar.disabled = false; btnFinalizar.textContent = '✓ Marcar como finalizada'; }
  };
}

// ------------------------- MAPA DE CAPTURAS -------------------------

const MAPA_LABEL = {
  'mapa_macatuba.png': 'Macatuba',
  'mapa_jundiai1_principal.png': 'Área principal (G1-G5)',
  'mapa_jundiai1_mezanino.png': 'Mezanino',
  'mapa_jundiai1_g7.png': 'G7',
  'mapa_jundiai2.png': 'Jundiaí II'
};

function corMarcador(quantidade) {
  if (quantidade === null || quantidade === undefined) return '#9aa0a6'; // cinza: sem leitura ainda
  if (quantidade === 0) return '#2f9e64'; // verde
  if (quantidade <= 2) return '#df8630'; // laranja
  return '#d64545'; // vermelho: 3+
}

async function renderMapaCapturas() {
  appendHtml(app, screenHeader('Mapa de capturas', S.unidade.UNIDADE, 'Posição real das armadilhas — cor conforme o total capturado no período'));

  const mapas = await api('getMapasDisponiveis', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  if (!mapas.length) {
    app.appendChild(el('<div class="empty"><span class="ic">🗺️</span>Nenhum mapa cadastrado para esta unidade ainda.</div>'));
    return;
  }

  let mapaAtual = mapas[0];
  const filterWrap = el(
    '<div class="filters">' +
      (mapas.length > 1 ? '<select id="fMapa">' + mapas.map(function (m) { return '<option value="' + escapeHtml(m) + '">' + escapeHtml(MAPA_LABEL[m] || m) + '</option>'; }).join('') + '</select>' : '') +
      '<select id="fPeriodo">' +
        '<option value="tudo">Todo o período</option>' +
        '<option value="semana">Esta semana</option>' +
        '<option value="mes">Este mês</option>' +
        '<option value="custom">Período personalizado</option>' +
      '</select>' +
    '</div>'
  );
  app.appendChild(filterWrap);

  const customWrap = el(
    '<div class="filters" id="customDates" style="display:none">' +
      '<input type="date" id="fDataInicial">' +
      '<input type="date" id="fDataFinal">' +
      '<button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button>' +
    '</div>'
  );
  app.appendChild(customWrap);

  if (mapas.length > 1) {
    document.getElementById('fMapa').onchange = function () { mapaAtual = document.getElementById('fMapa').value; load(); };
  }
  const selPeriodo = document.getElementById('fPeriodo');
  const customDates = document.getElementById('customDates');
  selPeriodo.onchange = function () {
    customDates.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;

  const legenda = el(
    '<div class="row" style="gap:14px;flex-wrap:wrap;font-size:12.5px">' +
      '<span class="row" style="gap:5px"><span style="width:12px;height:12px;border-radius:50%;background:#2f9e64;display:inline-block"></span>0 capturas</span>' +
      '<span class="row" style="gap:5px"><span style="width:12px;height:12px;border-radius:50%;background:#df8630;display:inline-block"></span>1-2 capturas</span>' +
      '<span class="row" style="gap:5px"><span style="width:12px;height:12px;border-radius:50%;background:#d64545;display:inline-block"></span>3+ capturas</span>' +
      '<span class="row" style="gap:5px"><span style="width:12px;height:12px;border-radius:50%;background:#9aa0a6;display:inline-block"></span>Sem leitura no período</span>' +
    '</div>'
  );
  app.appendChild(legenda);

  const layoutWrap = el('<div class="map-side-layout" style="margin-top:10px"></div>');
  app.appendChild(layoutWrap);

  const mapCol = el('<div class="map-col"></div>');
  const mapWrap = el('<div class="card" style="padding:0;overflow:hidden;position:relative"><p class="subtle" style="padding:16px">Carregando…</p></div>');
  mapCol.appendChild(mapWrap);
  const detailWrap = el('<div class="card stack" id="detalheArmadilha" style="display:none;margin-top:10px"></div>');
  mapCol.appendChild(detailWrap);
  layoutWrap.appendChild(mapCol);

  const listCol = el('<div class="list-col"><div class="card stack"><h3 class="title-lg">Capturas por armadilha</h3><div id="listaArmadilhas" class="stack" style="gap:8px"><p class="subtle">Carregando…</p></div></div></div>');
  layoutWrap.appendChild(listCol);
  const listaArmadilhas = listCol.querySelector('#listaArmadilhas');

  async function load() {
    mapWrap.innerHTML = '<p class="subtle" style="padding:16px">Carregando…</p>';
    listaArmadilhas.innerHTML = '<p class="subtle">Carregando…</p>';
    detailWrap.style.display = 'none';

    let range = { dataInicial: '', dataFinal: '' };
    if (selPeriodo.value === 'custom') {
      const ini = document.getElementById('fDataInicial').value; // yyyy-mm-dd
      const fim = document.getElementById('fDataFinal').value;
      if (ini) range.dataInicial = dateToBR(new Date(ini + 'T00:00:00'));
      if (fim) range.dataFinal = dateToBR(new Date(fim + 'T00:00:00'));
    } else {
      range = periodoRange(selPeriodo.value);
    }

    const pontos = await api('getMapaCapturas', { unidade: S.unidade.UNIDADE, mapa: mapaAtual, dataInicial: range.dataInicial, dataFinal: range.dataFinal }).catch(function () { return []; });
    mapWrap.innerHTML = '';

    const container = el('<div style="position:relative;width:100%;line-height:0"></div>');
    const img = el('<img src="assets/mapas/' + mapaAtual + '" style="width:100%;display:block" alt="Mapa">');
    container.appendChild(img);
    mapWrap.appendChild(container);

    function mostrarDetalhe(p, cor) {
      detailWrap.style.display = 'flex';
      detailWrap.innerHTML =
        '<div class="row between"><span class="list-item__title">Armadilha ' + escapeHtml(p.armadilha) + (p.tipo === 'ECOZONE' ? ' · ECOZONE' : '') + '</span>' +
        '<span class="tag" style="background:' + cor + '22;color:' + cor + '">' + (p.quantidade === null ? 'Sem leitura' : p.quantidade + ' capturado(s)') + '</span></div>' +
        (p.armazem ? '<div class="subtle">Armazém: ' + escapeHtml(p.armazem) + '</div>' : '') +
        (p.dataUltimaCaptura ? '<div class="subtle">Última leitura no período: ' + escapeHtml(p.dataUltimaCaptura) + '</div>' : '<div class="subtle">Nenhuma captura registrada no período selecionado.</div>');
      detailWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    pontos.forEach(function (p) {
      if (p.xPct === '' || p.xPct === null || p.xPct === undefined) return;
      const cor = corMarcador(p.quantidade);
      const marker = el(
        '<button type="button" style="position:absolute;left:' + p.xPct + '%;top:' + p.yPct + '%;transform:translate(-50%,-50%);' +
        'width:22px;height:22px;border-radius:50%;background:' + cor + ';border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);' +
        'color:#fff;font-family:var(--mono);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">' +
        escapeHtml(p.armadilha) + '</button>'
      );
      marker.onclick = function () { mostrarDetalhe(p, cor); };
      container.appendChild(marker);
    });

    // Lista lateral acompanha o mesmo filtro de período do mapa, ordenada
    // das armadilhas com mais captura para as com menos.
    listaArmadilhas.innerHTML = '';
    const ordenadas = pontos.slice().sort(function (a, b) { return (b.quantidade || 0) - (a.quantidade || 0); });
    if (!ordenadas.length) {
      listaArmadilhas.appendChild(el('<p class="subtle">Nenhuma armadilha cadastrada neste mapa.</p>'));
    } else {
      ordenadas.forEach(function (p) {
        const cor = corMarcador(p.quantidade);
        const item = el(
          '<button type="button" class="list-item" style="width:100%;padding:10px 12px">' +
            '<span><span class="list-item__title">Armadilha ' + escapeHtml(p.armadilha) + '</span>' +
            (p.armazem ? '<div class="list-item__sub">' + escapeHtml(p.armazem) + '</div>' : '') + '</span>' +
            '<span class="tag" style="background:' + cor + '22;color:' + cor + '">' + (p.quantidade === null ? 'Sem leitura' : p.quantidade) + '</span>' +
          '</button>'
        );
        item.onclick = function () { mostrarDetalhe(p, cor); };
        listaArmadilhas.appendChild(item);
      });
    }
  }
  load();
}

// ------------------------- MAPA DE GOTEIRAS -------------------------
// Mesma planta baixa do mapa de capturas, mas aqui os pontos não têm posição
// numerada fixa: o conferente toca livremente no mapa durante a inspeção
// (ver stepGoteira) e o ponto fica salvo até alguém marcar como resolvida.
// Administradores e conferentes têm o mesmo acesso — só a unidade separa.

async function renderMapaGoteiras() {
  appendHtml(app, screenHeader('Mapa de goteiras', S.unidade.UNIDADE, 'Pontos marcados pelos conferentes durante a inspeção'));

  const mapas = await api('getMapasDisponiveis', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  if (!mapas.length) {
    app.appendChild(el('<div class="empty"><span class="ic">🗺️</span>Nenhum mapa cadastrado para esta unidade ainda.</div>'));
    return;
  }

  let mapaAtual = mapas[0];
  if (mapas.length > 1) {
    const selWrap = el('<div class="filters"></div>');
    app.appendChild(selWrap);
    const sel = el('<select>' + mapas.map(function (m) { return '<option value="' + escapeHtml(m) + '">' + escapeHtml(MAPA_LABEL[m] || m) + '</option>'; }).join('') + '</select>');
    selWrap.appendChild(sel);
    sel.onchange = function () { mapaAtual = sel.value; load(); };
  }

  const mapWrap = el('<div class="card" style="padding:0;overflow:hidden;position:relative;margin-top:10px"><p class="subtle" style="padding:16px">Carregando…</p></div>');
  app.appendChild(mapWrap);

  const detailWrap = el('<div class="card stack" id="detalheGoteira" style="display:none;margin-top:10px"></div>');
  app.appendChild(detailWrap);

  async function load() {
    mapWrap.innerHTML = '<p class="subtle" style="padding:16px">Carregando…</p>';
    detailWrap.style.display = 'none';
    const pontos = await api('getMapaGoteiras', { unidade: S.unidade.UNIDADE, mapa: mapaAtual }).catch(function () { return []; });
    mapWrap.innerHTML = '';

    const container = el('<div style="position:relative;width:100%;line-height:0"></div>');
    const img = el('<img src="assets/mapas/' + mapaAtual + '" style="width:100%;display:block" alt="Mapa">');
    container.appendChild(img);
    mapWrap.appendChild(container);

    if (!pontos.length) {
      const vazio = el('<div class="empty" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:var(--radius);padding:10px 16px"><span class="ic">☔</span>Nenhuma goteira ativa neste mapa</div>');
      container.appendChild(vazio);
    }

    pontos.forEach(function (p) {
      if (p.xPct === '' || p.xPct === null || p.xPct === undefined) return;
      const marker = el(
        '<button type="button" style="position:absolute;left:' + p.xPct + '%;top:' + p.yPct + '%;transform:translate(-50%,-50%);' +
        'width:20px;height:20px;border-radius:50%;background:var(--st-tratamento);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);' +
        'color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">✕</button>'
      );
      marker.onclick = function () {
        detailWrap.style.display = 'flex';
        detailWrap.innerHTML =
          '<div class="row between"><span class="list-item__title">Goteira · ' + escapeHtml(p.armazem || S.unidade.UNIDADE) + '</span></div>' +
          '<div class="subtle">Registrada em ' + escapeHtml(p.data) + ' por ' + escapeHtml(p.usuario) + '</div>' +
          (p.foto ? fotosGaleria(p.foto) : '') +
          '<button type="button" class="btn btn--outline btn--block" data-role="resolver">Marcar como resolvida (remover do mapa)</button>';
        detailWrap.querySelector('[data-role="resolver"]').onclick = async function () {
          await api('resolverGoteiraMapa', { idGoteira: p.idGoteira, usuario: S.usuario.NOME }).catch(function () {});
          toast('Goteira marcada como resolvida', false, true);
          load();
        };
        detailWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
      container.appendChild(marker);
    });
  }
  load();
}

async function renderDashCarunchos() {
  app.appendChild(el(screenHeader('Dashboard de carunchos', S.unidade.UNIDADE)));

  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fPeriodo">' +
        '<option value="tudo">Todo o período</option>' +
        '<option value="semana">Esta semana</option>' +
        '<option value="mes">Este mês</option>' +
        '<option value="custom">Período personalizado</option>' +
      '</select>' +
      '<select id="fArmazem"><option value="">Todos os armazéns</option></select>' +
    '</div>'
  );
  app.appendChild(filterWrap);

  const customWrap = el(
    '<div class="filters" id="customDates" style="display:none">' +
      '<input type="date" id="fDataInicial">' +
      '<input type="date" id="fDataFinal">' +
      '<button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button>' +
    '</div>'
  );
  app.appendChild(customWrap);

  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const armazens = await api('getArmazens', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  const selArmazem = document.getElementById('fArmazem');
  armazens.forEach(function (a) { selArmazem.appendChild(el('<option value="' + escapeHtml(a.ARMAZEM) + '">' + escapeHtml(a.ARMAZEM) + '</option>')); });

  const selPeriodo = document.getElementById('fPeriodo');
  const customDates = document.getElementById('customDates');
  selPeriodo.onchange = function () {
    customDates.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selArmazem.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    let range = { dataInicial: '', dataFinal: '' };
    if (selPeriodo.value === 'custom') {
      const ini = document.getElementById('fDataInicial').value; // yyyy-mm-dd
      const fim = document.getElementById('fDataFinal').value;
      if (ini) range.dataInicial = dateToBR(new Date(ini + 'T00:00:00'));
      if (fim) range.dataFinal = dateToBR(new Date(fim + 'T00:00:00'));
    } else {
      range = periodoRange(selPeriodo.value);
    }
    const d = await api('getDashboardCarunchos', {
      unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
      dataInicial: range.dataInicial, dataFinal: range.dataFinal
    }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;

    let comparativoHtml = '';
    if (selPeriodo.value !== 'tudo') {
      const rangeAnterior = periodoAnteriorRange(range);
      if (rangeAnterior) {
        const dAnterior = await api('getDashboardCarunchos', {
          unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
          dataInicial: rangeAnterior.dataInicial, dataFinal: rangeAnterior.dataFinal
        }).catch(function () { return null; });
        if (dAnterior) comparativoHtml = comparativoBadge(d.totalCapturas, dAnterior.totalCapturas, true);
      }
    }

    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(d.totalCapturas, 'Total capturado') +
        kpi(d.armadilhasComCaptura, 'Armadilhas c/ captura') +
        kpi(d.mediaCaptura, 'Média por registro') +
        kpi(d.registros.length, 'Registros') +
      '</div>'
    ));
    if (comparativoHtml) body.appendChild(el('<div style="margin-top:-4px">' + comparativoHtml + '</div>'));

    const alertas = calcularAlertasArmadilha(d.porArmadilha);
    if (alertas.length) {
      const mediaG = Object.values(d.porArmadilha).reduce(function (a, b) { return a + b; }, 0) / Object.values(d.porArmadilha).length;
      body.appendChild(el(
        '<div class="card stack" style="border-color:var(--st-risco);background:#fdeceb">' +
          '<strong style="color:var(--st-risco)">⚠️ Possível foco de infestação</strong>' +
          alertas.map(function (a) { return '<p class="subtle" style="color:var(--st-risco);margin:0">Armadilha ' + escapeHtml(a) + ': ' + d.porArmadilha[a] + ' capturas (média geral: ' + mediaG.toFixed(1) + ')</p>'; }).join('') +
        '</div>'
      ));
    }

    body.appendChild(barCard('Capturas por armazém', d.porArmazem));
    body.appendChild(barCard('Capturas por armadilha', d.porArmadilha));
    body.appendChild(evolucaoCard('Evolução das capturas por data', d.registros, function (r) { return r.DATA; }, function (r) { return r.QUANTIDADE; }));

    if (d.registros.length) {
      const listCard = el('<div class="card stack"><h3 class="title-lg">Capturas recentes</h3></div>');
      body.appendChild(listCard);
      const tableWrap = el('<div style="overflow-x:auto"></div>');
      listCard.appendChild(tableWrap);
      const recentes = d.registros.slice().sort(function (a, b) {
        const da = parseBR(a.DATA), db = parseBR(b.DATA);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
      }).slice(0, 15);
      tableWrap.appendChild(buildPreviewTable(
        [['DATA', 'Data'], ['ARMAZEM', 'Armazém'], ['ARMADILHA', 'Armadilha'], ['QUANTIDADE', 'Qtd'], ['USUARIO', 'Conferente']],
        recentes
      ));
    }
  }
  load();
}

// Agrupa registros de captura por data (soma a quantidade) e mostra em
// ordem cronológica (não por tamanho, como o barCard normal faz).
function evolucaoCard(titulo, registros, getDataStr, getValor) {
  getDataStr = getDataStr || function (r) { return r.DATA; };
  getValor = getValor || function () { return 1; };
  const acc = {};
  registros.forEach(function (r) {
    const k = getDataStr(r) || 'N/A';
    acc[k] = (acc[k] || 0) + Number(getValor(r) || 0);
  });
  const chaves = Object.keys(acc).sort(function (a, b) {
    const da = parseBR(a), db = parseBR(b);
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  });
  const max = chaves.length ? Math.max.apply(null, chaves.map(function (k) { return acc[k]; })) : 1;
  const card = el('<div class="card stack"><h3 class="title-lg">' + escapeHtml(titulo) + '</h3></div>');
  if (!chaves.length) { card.appendChild(el('<p class="subtle">Sem dados no período.</p>')); return card; }
  chaves.forEach(function (k) {
    card.appendChild(el(
      '<div class="bar-row"><span class="label">' + escapeHtml(k) + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(4, (acc[k] / max) * 100) + '%"></div></div>' +
      '<span class="bar-val">' + escapeHtml(acc[k]) + '</span></div>'
    ));
  });
  return card;
}

// Calcula o período imediatamente anterior, com a mesma duração do período
// selecionado — usado para comparar "esta semana" com "a semana passada" etc.
function periodoAnteriorRange(range) {
  const inicio = parseBR(range.dataInicial);
  const fim = parseBR(range.dataFinal);
  if (!inicio || !fim) return null;
  const duracaoMs = fim.getTime() - inicio.getTime();
  const novoFim = new Date(inicio.getTime() - 24 * 60 * 60 * 1000);
  const novoInicio = new Date(novoFim.getTime() - duracaoMs);
  return { dataInicial: dateToBR(novoInicio), dataFinal: dateToBR(novoFim) };
}

// Monta o texto "▲ 20% vs período anterior", com verde/vermelho de acordo
// com o que é "bom" para aquela métrica (ex: menos pendências = bom).
function comparativoBadge(atual, anterior, menorEhMelhor) {
  if (anterior === null || anterior === undefined) return '';
  const diff = atual - anterior;
  if (diff === 0) return '<span class="subtle" style="font-size:12.5px">Igual ao período anterior (' + anterior + ')</span>';
  const subiu = diff > 0;
  const bom = menorEhMelhor ? !subiu : subiu;
  const cor = bom ? 'var(--st-finalizada)' : 'var(--st-risco)';
  const seta = subiu ? '▲' : '▼';
  const pct = anterior > 0 ? Math.round(Math.abs(diff) / anterior * 100) + '%' : String(Math.abs(diff));
  return '<span style="font-weight:700;color:' + cor + '">' + seta + ' ' + pct + '</span> <span class="subtle" style="font-size:12.5px">vs período anterior (' + anterior + ')</span>';
}

// Aponta armadilhas que capturaram bem mais que a média das demais —
// possível indício de foco de infestação concentrado num ponto.
function calcularAlertasArmadilha(porArmadilha) {
  const valores = Object.values(porArmadilha);
  if (valores.length < 2) return [];
  const media = valores.reduce(function (a, b) { return a + b; }, 0) / valores.length;
  if (media <= 0) return [];
  return Object.keys(porArmadilha).filter(function (k) { return porArmadilha[k] >= Math.max(media * 2, media + 3); });
}

async function renderDashChecklist() {
  app.appendChild(el(screenHeader('Dashboard de limpeza', S.unidade.UNIDADE)));

  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fPeriodo">' +
        '<option value="tudo">Todo o período</option>' +
        '<option value="semana">Esta semana</option>' +
        '<option value="mes">Este mês</option>' +
        '<option value="custom">Período personalizado</option>' +
      '</select>' +
      '<select id="fArmazem"><option value="">Todos os armazéns</option></select>' +
    '</div>'
  );
  app.appendChild(filterWrap);
  const customWrap = el(
    '<div class="filters" id="customDates" style="display:none">' +
      '<input type="date" id="fDataInicial">' +
      '<input type="date" id="fDataFinal">' +
      '<button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button>' +
    '</div>'
  );
  app.appendChild(customWrap);

  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const armazens = await api('getArmazens', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  const selArmazem = document.getElementById('fArmazem');
  armazens.forEach(function (a) { selArmazem.appendChild(el('<option value="' + escapeHtml(a.ARMAZEM) + '">' + escapeHtml(a.ARMAZEM) + '</option>')); });

  const selPeriodo = document.getElementById('fPeriodo');
  const customDates = document.getElementById('customDates');
  selPeriodo.onchange = function () {
    customDates.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selArmazem.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    let range = { dataInicial: '', dataFinal: '' };
    if (selPeriodo.value === 'custom') {
      const ini = document.getElementById('fDataInicial').value;
      const fim = document.getElementById('fDataFinal').value;
      if (ini) range.dataInicial = dateToBR(new Date(ini + 'T00:00:00'));
      if (fim) range.dataFinal = dateToBR(new Date(fim + 'T00:00:00'));
    } else {
      range = periodoRange(selPeriodo.value);
    }
    const d = await api('getDashboardChecklist', {
      unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
      dataInicial: range.dataInicial, dataFinal: range.dataFinal
    }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;

    let comparativoHtml = '';
    if (selPeriodo.value !== 'tudo') {
      const rangeAnterior = periodoAnteriorRange(range);
      if (rangeAnterior) {
        const dAnterior = await api('getDashboardChecklist', {
          unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
          dataInicial: rangeAnterior.dataInicial, dataFinal: rangeAnterior.dataFinal
        }).catch(function () { return null; });
        if (dAnterior) comparativoHtml = comparativoBadge(d.naoConformidades, dAnterior.naoConformidades, true);
      }
    }

    body.appendChild(el(
      '<div class="kpi-grid">' + kpi(d.total, 'Itens registrados') + kpi(d.naoConformidades, 'Não conformidades') + '</div>'
    ));
    if (comparativoHtml) body.appendChild(el('<div style="margin-top:-4px">' + comparativoHtml + ' <span class="subtle" style="font-size:12.5px">em não conformidades</span></div>'));

    body.appendChild(barCard('Por conferente', d.porConferente));
    body.appendChild(barCard('Por armazém', d.porArmazem));
    body.appendChild(barCard('Por periodicidade', d.porPeriodicidade));
    body.appendChild(evolucaoCard('Evolução dos checklists por data', d.registros));

    if (d.registros.length) {
      const listCard = el('<div class="card stack"><h3 class="title-lg">Checklists recentes</h3></div>');
      body.appendChild(listCard);
      const tableWrap = el('<div style="overflow-x:auto"></div>');
      listCard.appendChild(tableWrap);
      const recentes = d.registros.slice().sort(function (a, b) {
        const da = parseBR(a.DATA), db = parseBR(b.DATA);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
      }).slice(0, 15);
      tableWrap.appendChild(buildPreviewTable(
        [['DATA', 'Data'], ['ARMAZEM', 'Armazém'], ['PERIODICIDADE', 'Periodicidade'], ['ITEM', 'Item'], ['RESULTADO', 'Resultado'], ['USUARIO', 'Conferente']],
        recentes
      ));
    }
  }
  load();
}

async function renderDashPendencias() {
  app.appendChild(el(screenHeader('Dashboard de pendências', S.unidade.UNIDADE)));

  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fPeriodo">' +
        '<option value="tudo">Todo o período</option>' +
        '<option value="semana">Esta semana</option>' +
        '<option value="mes">Este mês</option>' +
        '<option value="custom">Período personalizado</option>' +
      '</select>' +
      '<select id="fArmazem"><option value="">Todos os armazéns</option></select>' +
    '</div>'
  );
  app.appendChild(filterWrap);

  const customWrap = el(
    '<div class="filters" id="customDates" style="display:none">' +
      '<input type="date" id="fDataInicial">' +
      '<input type="date" id="fDataFinal">' +
      '<button class="btn btn--outline btn--sm" id="btnAplicar">Aplicar</button>' +
    '</div>'
  );
  app.appendChild(customWrap);

  const body = el('<div class="stack" id="body" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);

  const armazens = await api('getArmazens', { unidade: S.unidade.UNIDADE }).catch(function () { return []; });
  const selArmazem = document.getElementById('fArmazem');
  armazens.forEach(function (a) { selArmazem.appendChild(el('<option value="' + escapeHtml(a.ARMAZEM) + '">' + escapeHtml(a.ARMAZEM) + '</option>')); });

  const selPeriodo = document.getElementById('fPeriodo');
  const customDates = document.getElementById('customDates');
  selPeriodo.onchange = function () {
    customDates.style.display = selPeriodo.value === 'custom' ? 'flex' : 'none';
    if (selPeriodo.value !== 'custom') load();
  };
  document.getElementById('btnAplicar').onclick = load;
  selArmazem.onchange = load;

  async function load() {
    body.innerHTML = '<p class="subtle">Carregando…</p>';
    let range = { dataInicial: '', dataFinal: '' };
    if (selPeriodo.value === 'custom') {
      const ini = document.getElementById('fDataInicial').value;
      const fim = document.getElementById('fDataFinal').value;
      if (ini) range.dataInicial = dateToBR(new Date(ini + 'T00:00:00'));
      if (fim) range.dataFinal = dateToBR(new Date(fim + 'T00:00:00'));
    } else {
      range = periodoRange(selPeriodo.value);
    }
    const d = await api('getDashboardPendencias', {
      unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
      dataInicial: range.dataInicial, dataFinal: range.dataFinal
    }).catch(function () { return null; });
    body.innerHTML = '';
    if (!d) return;

    let comparativoHtml = '';
    if (selPeriodo.value !== 'tudo') {
      const rangeAnterior = periodoAnteriorRange(range);
      if (rangeAnterior) {
        const dAnterior = await api('getDashboardPendencias', {
          unidade: S.unidade.UNIDADE, armazem: selArmazem.value,
          dataInicial: rangeAnterior.dataInicial, dataFinal: rangeAnterior.dataFinal
        }).catch(function () { return null; });
        if (dAnterior) comparativoHtml = comparativoBadge(d.total, dAnterior.total, true);
      }
    }

    body.appendChild(el(
      '<div class="kpi-grid">' +
        kpi(d.abertas, 'Abertas') + kpi(d.emTratamento, 'Em tratamento') +
        kpi(d.aguardandoValidacao, 'Aguard. validação') + kpi(d.finalizadas, 'Finalizadas') +
      '</div>'
    ));
    if (comparativoHtml) body.appendChild(el('<div style="margin-top:-4px">' + comparativoHtml + ' <span class="subtle" style="font-size:12.5px">em pendências abertas no período</span></div>'));

    body.appendChild(barCard('Por armazém', d.porArmazem));
    body.appendChild(barCard('Por ocorrência', d.porOcorrencia));
    body.appendChild(evolucaoCard('Evolução das pendências por data', d.registros, function (r) { return String(r.DATA_ABERTURA || '').split(' ')[0]; }));

    const listCard = el('<div class="card stack"><h3 class="title-lg">Pendências recentes</h3></div>');
    body.appendChild(listCard);
    const listInner = el('<div class="stack"></div>');
    listCard.appendChild(listInner);
    renderPendenciasList(listInner, d.registros.slice(0, 12), function (p) { go('pendenciaDetalhe', { pendenciaAtual: p }); });
  }
  load();
}

function kpi(value, label) {
  return '<div class="kpi"><span class="badge-count">' + escapeHtml(value) + '</span><span class="subtle">' + escapeHtml(label) + '</span></div>';
}

function barCard(title, dataObj) {
  const entries = Object.entries(dataObj || {}).sort(function (a, b) { return b[1] - a[1]; });
  const max = entries.length ? entries[0][1] : 1;
  const card = el('<div class="card stack"><h3 class="title-lg">' + escapeHtml(title) + '</h3></div>');
  if (!entries.length) { card.appendChild(el('<p class="subtle">Sem dados no período.</p>')); return card; }
  entries.forEach(function (e) {
    card.appendChild(el(
      '<div class="bar-row"><span class="label">' + escapeHtml(e[0]) + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(4, (e[1] / max) * 100) + '%"></div></div>' +
      '<span class="bar-val">' + escapeHtml(e[1]) + '</span></div>'
    ));
  });
  return card;
}