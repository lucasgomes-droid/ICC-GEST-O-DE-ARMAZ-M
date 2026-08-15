/* =====================================================
   GESTÃO DE ARMAZÉNS — FRONTEND
   SPA em JS puro (sem build). Fala com o backend Apps Script
   via fetch(). Sessão fica só em memória (sem localStorage).
   ===================================================== */

// >>> COLE AQUI A URL DO SEU APPS SCRIPT WEB APP <<<
const API_URL = 'https://script.google.com/macros/s/AKfycbyiJF13w6pN6irRpkyKNu_ACFB4it9lTjmcLsE_84MTsehYjJcFdCCHKhxL8v2Mefcu/exec';

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
  wizard: null
};

function resetSession() {
  S.unidade = null;
  S.usuario = null;
  S.screen = 'loginUnidade';
  S.wizard = null;
  document.getElementById('topbar').hidden = true;
  document.getElementById('tabbar').hidden = true;
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

// Componente reutilizável de captura de foto. Retorna node + getter.
function photoField(container, opts) {
  opts = opts || {};
  const wrap = el(
    '<div class="photo-input">' +
      '<label>' + escapeHtml(opts.label || 'Foto') + (opts.required ? ' *' : '') + '</label>' +
      '<div class="photo-btn' + (opts.required ? ' required' : '') + '" data-role="btn">📷 Toque para adicionar foto' + (opts.required ? ' (obrigatória)' : '') + '</div>' +
      '<input type="file" accept="image/*" capture="environment" style="display:none" data-role="input">' +
    '</div>'
  );
  let dataUrl = opts.initial || null;
  const btn = wrap.querySelector('[data-role="btn"]');
  const input = wrap.querySelector('[data-role="input"]');
  function refresh() {
    if (dataUrl) {
      wrap.innerHTML =
        '<label>' + escapeHtml(opts.label || 'Foto') + (opts.required ? ' *' : '') + '</label>' +
        '<img class="photo-preview" src="' + dataUrl + '">' +
        '<button type="button" class="btn btn--outline btn--sm" data-role="remove">Remover foto</button>';
      wrap.querySelector('[data-role="remove"]').onclick = function () { dataUrl = null; refresh(); };
    } else {
      wrap.innerHTML =
        '<label>' + escapeHtml(opts.label || 'Foto') + (opts.required ? ' *' : '') + '</label>' +
        '<div class="photo-btn' + (opts.required ? ' required' : '') + '" data-role="btn">📷 Toque para adicionar foto' + (opts.required ? ' (obrigatória)' : '') + '</div>' +
        '<input type="file" accept="image/*" capture="environment" style="display:none" data-role="input">';
      wrap.querySelector('[data-role="btn"]').onclick = function () { wrap.querySelector('[data-role="input"]').click(); };
      wrap.querySelector('[data-role="input"]').onchange = async function (e) {
        const file = e.target.files[0];
        if (!file) return;
        dataUrl = await fileToDataUrl(file);
        refresh();
      };
    }
  }
  btn.onclick = function () { input.click(); };
  input.onchange = async function (e) {
    const file = e.target.files[0];
    if (!file) return;
    dataUrl = await fileToDataUrl(file);
    refresh();
  };
  container.appendChild(wrap);
  return { getValue: function () { return dataUrl; } };
}

// Botões SIM/NÃO
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
  if (opts.value) input.value = opts.value;
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

render();

// ------------------------- ROUTER -------------------------

function render() {
  app.innerHTML = '';
  const screens = {
    loginUnidade: renderLoginUnidade,
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
    return '<button class="' + active.trim() + '" data-s="' + t.s + '"><span class="ic">' + t.ic + '</span>' + t.label + '</button>';
  }).join('');
  tabbar.querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { go(b.dataset.s); };
  });
}

// ------------------------- LOGIN -------------------------

async function renderLoginUnidade() {
  app.appendChild(el(
    '<div class="screen" style="padding-top:10vh">' +
      '<div class="login-logo"><div class="mark">GA</div></div>' +
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
        else { S.usuario = u; go('conferenteHome'); }
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
  if (w.step === 'avaria') return stepSimNao(w, {
    key: 'avaria', title: 'Produto avariado?', next: 'goteira',
    onYes: function (data) {
      w.ocorrencias.push({ tipo: 'Produto avariado', descricao: 'Local: ' + data.rua + ' / Baia: ' + data.baia + (data.obs ? ' — ' + data.obs : ''), foto: data.foto });
    },
    fields: function (c) {
      const rua = textField(c, { label: 'Qual rua?' });
      const baia = textField(c, { label: 'Qual baia?' });
      const obs = textField(c, { label: 'Observação', multiline: true });
      const foto = photoField(c, { label: 'Foto do produto avariado', required: true });
      return { get: function () { return { rua: rua.getValue(), baia: baia.getValue(), obs: obs.getValue(), foto: foto.getValue() }; }, validate: function () { return !!foto.getValue(); } };
    }
  });

  if (w.step === 'goteira') return stepGoteira(w);
  if (w.step === 'queda') return stepSimNao(w, {
    key: 'queda', title: 'Existem cargas ou baias com risco de queda?', next: 'tombamento',
    onYes: function (data) { w.ocorrencias.push({ tipo: 'Risco de queda', descricao: 'Local: ' + data.local + ' — Ações: ' + data.acoes, foto: data.foto }); },
    fields: function (c) {
      const local = textField(c, { label: 'Qual local?' });
      const acoes = textField(c, { label: 'Quais ações foram realizadas para eliminar o risco?', multiline: true });
      const foto = photoField(c, { label: 'Foto da carga/baia', required: true });
      return { get: function () { return { local: local.getValue(), acoes: acoes.getValue(), foto: foto.getValue() }; }, validate: function () { return !!foto.getValue(); } };
    }
  });

  if (w.step === 'tombamento') return stepSimNao(w, {
    key: 'tombamento', title: 'Existe carga com risco de tombamento?', next: 'carunchos',
    onYes: function (data) { w.ocorrencias.push({ tipo: 'Risco de tombamento', descricao: 'Baia: ' + data.baia + (data.obs ? ' — ' + data.obs : ''), foto: data.foto }); },
    fields: function (c) {
      const baia = textField(c, { label: 'Qual baia?' });
      const obs = textField(c, { label: 'Observação', multiline: true });
      const foto = photoField(c, { label: 'Foto' });
      return { get: function () { return { baia: baia.getValue(), obs: obs.getValue(), foto: foto.getValue() }; }, validate: function () { return true; } };
    }
  });

  if (w.step === 'carunchos') return stepCarunchos(w);
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

function stepGoteira(w) {
  const container = el(wizardHeader('Novas goteiras encontradas?'));
  app.appendChild(container);
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  const yn = yesNoField(card, 'Novas goteiras encontradas?');
  const sub = el('<div class="stack" style="display:none"></div>');
  card.appendChild(sub);

  let apiRefs = {};

  yn.node.addEventListener('change', function () {
    const val = yn.getValue();
    sub.style.display = val ? 'flex' : 'none';
    sub.innerHTML = '';
    apiRefs = {};
    if (!val) return;

    apiRefs.rua = textField(sub, { label: 'Qual rua?' });
    apiRefs.baia = textField(sub, { label: 'Qual baia?' });
    const produtoEmbaixo = yesNoField(sub, 'Existem produtos embaixo da goteira?');
    apiRefs.produtoEmbaixo = produtoEmbaixo;

    const detalhes = el('<div class="stack" style="display:none;padding-top:4px;border-top:1px dashed var(--line);margin-top:6px"></div>');
    sub.appendChild(detalhes);

    produtoEmbaixo.node.addEventListener('change', function () {
      const v = produtoEmbaixo.getValue();
      detalhes.style.display = v ? 'flex' : 'none';
      detalhes.innerHTML = '';
      apiRefs.detalhes = {};
      if (!v) return;
      apiRefs.detalhes.bins = textField(detalhes, { label: 'Quais BINs foram atingidos?' });
      apiRefs.detalhes.demarcada = yesNoField(detalhes, 'A área estava demarcada com X?');
      apiRefs.detalhes.fotoX = photoField(detalhes, { label: 'Foto da área com X' });
      apiRefs.detalhes.produto = textField(detalhes, { label: 'Qual produto?' });
      const removido = yesNoField(detalhes, 'O material foi removido?');
      apiRefs.detalhes.removido = removido;

      const naoRemovido = el('<div class="stack" style="display:none;padding-top:4px;border-top:1px dashed var(--line);margin-top:6px"></div>');
      detalhes.appendChild(naoRemovido);
      removido.node.addEventListener('change', function () {
        const rv = removido.getValue();
        naoRemovido.style.display = rv === false ? 'flex' : 'none';
        naoRemovido.innerHTML = '';
        apiRefs.naoRemovido = null;
        if (rv !== false) return;
        const emCimaX = yesNoField(naoRemovido, 'Existe produto em cima de pontos com goteira marcados com X?');
        const retirado = yesNoField(naoRemovido, 'O material foi retirado do local inadequado?');
        const localWrap = el('<div class="stack" style="display:none"></div>');
        naoRemovido.appendChild(localWrap);
        let localFields = {};
        retirado.node.addEventListener('change', function () {
          const rt = retirado.getValue();
          localWrap.style.display = rt === false ? 'flex' : 'none';
          localWrap.innerHTML = '';
          localFields = {};
          if (rt !== false) return;
          localFields.baia = textField(localWrap, { label: 'Qual baia?' });
          localFields.local = textField(localWrap, { label: 'Qual local?' });
          localFields.obs = textField(localWrap, { label: 'Observação', multiline: true });
        });
        apiRefs.naoRemovido = { emCimaX: emCimaX, retirado: retirado, getLocal: function () { return localFields; } };
      });
    });
  });

  const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Continuar</button>');
  card.appendChild(btn);

  btn.onclick = function () {
    const val = yn.getValue();
    if (val === null) { toast('Selecione Sim ou Não', true); return; }
    if (val) {
      const parts = ['Rua: ' + (apiRefs.rua ? apiRefs.rua.getValue() : ''), 'Baia: ' + (apiRefs.baia ? apiRefs.baia.getValue() : '')];
      let foto = null;
      const produtoEmbaixoVal = apiRefs.produtoEmbaixo ? apiRefs.produtoEmbaixo.getValue() : null;
      parts.push('Produto embaixo da goteira: ' + (produtoEmbaixoVal ? 'Sim' : 'Não'));
      if (produtoEmbaixoVal && apiRefs.detalhes) {
        const d = apiRefs.detalhes;
        parts.push('BINs atingidos: ' + d.bins.getValue());
        parts.push('Área demarcada com X: ' + (d.demarcada.getValue() ? 'Sim' : 'Não'));
        parts.push('Produto: ' + d.produto.getValue());
        const removidoVal = d.removido.getValue();
        parts.push('Material removido: ' + (removidoVal ? 'Sim' : 'Não'));
        foto = d.fotoX.getValue();
        if (removidoVal === false && apiRefs.naoRemovido) {
          const nr = apiRefs.naoRemovido;
          parts.push('Produto em cima de ponto marcado com X: ' + (nr.emCimaX.getValue() ? 'Sim' : 'Não'));
          const retiradoVal = nr.retirado.getValue();
          parts.push('Material retirado do local inadequado: ' + (retiradoVal ? 'Sim' : 'Não'));
          if (retiradoVal === false) {
            const loc = nr.getLocal();
            parts.push('Baia: ' + (loc.baia ? loc.baia.getValue() : ''));
            parts.push('Local: ' + (loc.local ? loc.local.getValue() : ''));
            parts.push('Observação: ' + (loc.obs ? loc.obs.getValue() : ''));
          }
        }
      }
      w.ocorrencias.push({ tipo: 'Goteira', descricao: parts.join(' | '), foto: foto });
    }
    w.step = 'queda';
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

  api('getArmadilhas', { unidade: S.unidade.UNIDADE, armazem: w.armazem }).then(function (armadilhas) {
    let qtdArmadilhas = null;
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
          const armadilhaSel = selectField(box, { label: 'Armadilha', options: armadilhas.map(function (a) { return { value: a.ARMADILHA, label: a.ARMADILHA + (a.LOCAL ? ' — ' + a.LOCAL : '') }; }) });
          const qtdCaruncho = textField(box, { label: 'Quantidade de carunchos', type: 'number' });
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
            armadilha: armadilhaSel, quantidade: qtdCaruncho, produtoProximo: produtoProximo,
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
        entries.forEach(function (e) {
          if (!e.armadilha.getValue()) { toast('Selecione a armadilha em todos os formulários', true); throw new Error('validation'); }
          const extra = e.getExtra();
          w.capturas.push({
            armadilha: e.armadilha.getValue(),
            quantidade: e.quantidade.getValue() || 0,
            produtoProximo: !!e.produtoProximo.getValue(),
            baia: extra.baia, observacao: (extra.produto ? 'Produto: ' + extra.produto + '. ' : '') + extra.observacao
          });
        });
      }
      w.step = 'revisao';
      render();
    };
  }).catch(function () {});
}

function stepRevisao(w) {
  const container = el(wizardHeader('Revisão da inspeção', 'Confira antes de enviar'));
  app.appendChild(container);
  const card = el('<div class="card stack"></div>');
  app.appendChild(card);

  card.appendChild(el('<div class="row between"><span class="subtle">Armazém</span><strong>' + escapeHtml(w.armazem) + '</strong></div>'));
  card.appendChild(el('<div class="divider"></div>'));

  if (!w.ocorrencias.length && !w.capturas.length) {
    card.appendChild(el('<p class="subtle">Nenhuma ocorrência registrada. Tudo certo nesta inspeção. ✅</p>'));
  } else {
    w.ocorrencias.forEach(function (o) {
      card.appendChild(el('<div class="list-item" style="cursor:default"><span><span class="list-item__title">' + escapeHtml(o.tipo) + '</span><div class="list-item__sub">' + escapeHtml(o.descricao) + '</div></span>' + (o.foto ? '<span>📷</span>' : '') + '</div>'));
    });
    w.capturas.forEach(function (c) {
      card.appendChild(el('<div class="list-item" style="cursor:default"><span><span class="list-item__title">Captura — ' + escapeHtml(c.armadilha) + '</span><div class="list-item__sub">Qtd: ' + escapeHtml(c.quantidade) + '</div></span></div>'));
    });
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
        armazem: w.armazem, ocorrencias: w.ocorrencias, capturas: w.capturas, observacao: obsField.getValue()
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

const CHECKLIST_ITENS = {
  DIARIO: ['Piso', 'Mesa', 'Aspirador de pó'],
  SEMANAL: ['Envolvedora', 'Extintores', 'Painel elétrico', 'Portas e paredes', 'Caminhos seguros', 'Carregadores', 'Armários', 'Estrutura de ferro', 'Limpeza dos cantos das paredes'],
  MENSAL: ['Armadilhas luminosas'],
  ANUAL: ['Estrutura das áreas', 'Lâmpadas']
};

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
    api('getArmazens', { unidade: S.unidade.UNIDADE }).then(function (armazens) {
      card.innerHTML = '';
      armazens.forEach(function (a) {
        const b = el('<button type="button" class="list-item" style="width:100%"><span class="list-item__title">' + escapeHtml(a.ARMAZEM) + '</span><span>›</span></button>');
        b.onclick = function () { w.armazem = a.ARMAZEM; w.step = 'itens'; render(); };
        card.appendChild(b);
      });
    }).catch(function () {});
    return;
  }

  if (w.step === 'itens') {
    app.appendChild(el(screenHeader('Checklist ' + w.periodicidade, w.armazem)));
    const card = el('<div class="card stack"></div>');
    app.appendChild(card);
    const itens = CHECKLIST_ITENS[w.periodicidade];
    const refs = itens.map(function (item) {
      const box = el('<div class="stack" style="padding-bottom:10px;border-bottom:1px solid var(--line)"></div>');
      card.appendChild(box);
      box.appendChild(el('<strong>' + escapeHtml(item) + '</strong>'));
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
      return { item: item, sel: sel, getManut: function () { return manutField ? manutField.getValue() : ''; }, foto: foto };
    });

    const btn = el('<button class="btn btn--primary btn--block" style="margin-top:6px">Enviar checklist</button>');
    card.appendChild(btn);
    btn.onclick = async function () {
      const payloadItens = [];
      for (const r of refs) {
        if (!r.sel.getValue()) { toast('Preencha a situação de "' + r.item + '"', true); return; }
        if (r.sel.getValue() === 'NECESSITA_MANUTENCAO' && !r.getManut()) { toast('Descreva a manutenção necessária para "' + r.item + '"', true); return; }
        payloadItens.push({ item: r.item, resultado: r.sel.getValue(), observacao: r.getManut(), foto: r.foto.getValue() });
      }
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        await api('createChecklist', { unidade: S.unidade.UNIDADE, usuario: S.usuario.NOME, armazem: w.armazem, periodicidade: w.periodicidade, itens: payloadItens });
        toast('Checklist enviado com sucesso!', false, true);
        S.wizard = null;
        go('conferenteHome');
      } catch (e) { btn.disabled = false; btn.textContent = 'Enviar checklist'; }
    };
  }
}

// ------------------------- MINHAS PENDÊNCIAS (conferente) -------------------------

async function renderMinhasPendencias() {
  app.appendChild(el(screenHeader('Minhas pendências', 'Direcionadas a ' + S.usuario.NOME)));
  const filterWrap = el(
    '<div class="filters"><select id="fStatus">' +
      '<option value="">Todos os status</option>' +
      '<option value="ABERTA">Aberta</option>' +
      '<option value="EM_TRATAMENTO">Em tratamento</option>' +
      '<option value="AGUARDANDO_VALIDACAO">Aguardando validação</option>' +
      '<option value="FINALIZADA">Finalizada</option>' +
    '</select></div>'
  );
  app.appendChild(filterWrap);
  const listWrap = el('<div class="stack" id="list" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  async function load() {
    listWrap.innerHTML = '<p class="subtle">Carregando…</p>';
    try {
      const pend = await api('getPendencias', { unidade: S.unidade.UNIDADE, idResponsavel: S.usuario.ID_USUARIO, status: document.getElementById('fStatus').value });
      renderPendenciasList(listWrap, pend, function (p) { go('pendenciaDetalhe', { pendenciaAtual: p }); });
    } catch (e) {}
  }
  document.getElementById('fStatus').onchange = load;
  load();
}

function renderPendenciasList(wrap, pend, onOpen) {
  wrap.innerHTML = '';
  if (!pend.length) { wrap.appendChild(el('<div class="empty"><span class="ic">📭</span>Nenhuma pendência encontrada.</div>')); return; }
  pend.forEach(function (p) {
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
    wrap.appendChild(item);
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
  if (p.FOTO_ORIGEM) card.appendChild(el('<img class="photo-preview" src="' + p.FOTO_ORIGEM + '">'));

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
        if (!foto.getValue()) { toast('A foto de comprovação é obrigatória', true); return; }
        btn.disabled = true; btn.textContent = 'Enviando…';
        try {
          await api('resolverPendencia', { idPendencia: p.ID_PENDENCIA, descricaoSolucao: desc.getValue(), fotoSolucao: foto.getValue() });
          toast('Solução enviada! Aguardando validação do admin.', false, true);
          go('minhasPendencias');
        } catch (e) { btn.disabled = false; btn.textContent = 'Enviar solução'; }
      };
    }
  }

  if (p.STATUS === 'AGUARDANDO_VALIDACAO') {
    card.appendChild(el('<div class="divider"></div>'));
    card.appendChild(el('<p><strong>Solução informada</strong><br>' + escapeHtml(p.DESCRICAO_SOLUCAO || '—') + '</p>'));
    if (p.FOTO_SOLUCAO) card.appendChild(el('<img class="photo-preview" src="' + p.FOTO_SOLUCAO + '">'));

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
}

// ------------------------- HISTÓRICO (conferente) -------------------------

async function renderHistorico() {
  app.appendChild(el(screenHeader('Histórico', S.usuario.NOME)));
  const tabs = el(
    '<div class="row" style="gap:8px">' +
      '<button class="btn btn--outline btn--sm" data-t="inspecoes" style="flex:1">Inspeções</button>' +
      '<button class="btn btn--outline btn--sm" data-t="checklists" style="flex:1">Checklists</button>' +
    '</div>'
  );
  app.appendChild(tabs);
  const listWrap = el('<div class="stack" style="margin-top:12px"><p class="subtle">Carregando…</p></div>');
  app.appendChild(listWrap);

  const data = await api('getHistoricoConferente', { idUsuario: S.usuario.ID_USUARIO }).catch(function () { return { inspecoes: [], checklists: [] }; });

  function showInspecoes() {
    listWrap.innerHTML = '';
    if (!data.inspecoes.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🔎</span>Nenhuma inspeção registrada.</div>')); return; }
    data.inspecoes.slice().reverse().forEach(function (i) {
      listWrap.appendChild(el(
        '<div class="list-item" style="cursor:default"><span><span class="shiplabel">' + escapeHtml(i.ID_INSPECAO) + '</span>' +
        '<div class="list-item__title" style="margin-top:6px">' + escapeHtml(i.ARMAZEM) + '</div>' +
        '<div class="list-item__sub">' + escapeHtml(i.DATA) + ' ' + escapeHtml(i.HORA) + '</div></span></div>'
      ));
    });
  }
  function showChecklists() {
    listWrap.innerHTML = '';
    if (!data.checklists.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🧹</span>Nenhum checklist registrado.</div>')); return; }
    data.checklists.slice().reverse().forEach(function (c) {
      listWrap.appendChild(el(
        '<div class="list-item" style="cursor:default"><span><span class="list-item__title">' + escapeHtml(c.ARMAZEM) + ' — ' + escapeHtml(c.ITEM) + '</span>' +
        '<div class="list-item__sub">' + escapeHtml(c.PERIODICIDADE) + ' · ' + escapeHtml(c.DATA) + ' · ' + escapeHtml(c.RESULTADO) + '</div></span></div>'
      ));
    });
  }
  tabs.querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { b.dataset.t === 'inspecoes' ? showInspecoes() : showChecklists(); };
  });
  showInspecoes();
}

// ------------------------- ADMIN: HOME -------------------------

function renderAdminHome() {
  appendHtml(app,
    screenHeader('Área administrativa', 'Olá, ' + S.usuario.NOME) +
    '<div class="stack">' +
      menuCard('✅', 'Validação de inspeções', 'Revisar inspeções dos conferentes', 'validacaoInspecoes') +
      menuCard('➕', 'Registrar pendência', 'Abrir uma pendência manualmente', 'registrarPendencia') +
      menuCard('📋', 'Dashboard de pendências', 'Status e distribuição', 'dashPendencias') +
      menuCard('🐞', 'Dashboard de carunchos', 'Capturas por armazém e armadilha', 'dashCarunchos') +
      menuCard('🧹', 'Dashboard de limpeza', 'Checklists realizados e pendentes', 'dashChecklist') +
    '</div>'
  );
  bindMenuCards();
}

// ------------------------- ADMIN: VALIDAÇÃO DE INSPEÇÕES -------------------------

async function renderValidacaoInspecoes() {
  app.appendChild(el(screenHeader('Validação de inspeções', S.unidade.UNIDADE)));
  const filterWrap = el(
    '<div class="filters">' +
      '<select id="fArmazem"><option value="">Todos os armazéns</option></select>' +
      '<select id="fResultado">' +
        '<option value="">Todos os status</option>' +
        '<option value="PENDENTE_VALIDACAO">Pendente de validação</option>' +
        '<option value="APROVADA">Aprovada</option>' +
        '<option value="COM_PENDENCIA">Com pendência</option>' +
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
    const rows = await api('getInspecoes', { unidade: S.unidade.UNIDADE, armazem: selArm.value, status: document.getElementById('fResultado').value }).catch(function () { return []; });
    listWrap.innerHTML = '';
    if (!rows.length) { listWrap.appendChild(el('<div class="empty"><span class="ic">🔎</span>Nenhuma inspeção encontrada.</div>')); return; }
    rows.forEach(function (i) {
      const item = el(
        '<button type="button" class="list-item" style="width:100%">' +
          '<span><span class="shiplabel">' + escapeHtml(i.ID_INSPECAO) + '</span>' +
          '<div class="list-item__title" style="margin-top:6px">' + escapeHtml(i.ARMAZEM) + ' — ' + escapeHtml(i.USUARIO) + '</div>' +
          '<div class="list-item__sub">' + escapeHtml(i.DATA) + ' ' + escapeHtml(i.HORA) + '</div></span>' +
          '<span class="tag ' + statusInspecaoTag(i.RESULTADO) + '">' + statusInspecaoLabel(i.RESULTADO) + '</span>' +
        '</button>'
      );
      item.onclick = function () { go('inspecaoDetalheAdmin', { inspecaoAtual: i }); };
      listWrap.appendChild(item);
    });
  }
  selArm.onchange = load;
  document.getElementById('fResultado').onchange = load;
  load();
}

function statusInspecaoLabel(r) {
  return { PENDENTE_VALIDACAO: 'Pendente', APROVADA: 'Aprovada', COM_PENDENCIA: 'Com pendência' }[r] || r;
}
function statusInspecaoTag(r) {
  return { PENDENTE_VALIDACAO: 'tag--aberta', APROVADA: 'tag--finalizada', COM_PENDENCIA: 'tag--validacao' }[r] || 'tag--aberta';
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
          '<strong>' + escapeHtml(o.TIPO) + '</strong>' +
          '<p class="subtle">' + escapeHtml(o.DESCRICAO) + '</p>' +
          (o.FOTO ? '<img class="photo-preview" src="' + escapeHtml(o.FOTO) + '">' : '') +
        '</div>'
      );
      card.appendChild(box);
    });
    det.capturas.forEach(function (c) {
      card.appendChild(el(
        '<div class="stack" style="padding:10px 0;border-bottom:1px solid var(--line)">' +
          '<strong>Captura — ' + escapeHtml(c.ARMADILHA) + '</strong>' +
          '<p class="subtle">Quantidade: ' + escapeHtml(c.QUANTIDADE) + (c.BAIA ? ' · Baia: ' + escapeHtml(c.BAIA) : '') + '</p>' +
        '</div>'
      ));
    });
  } else {
    card.appendChild(el('<p class="subtle">Nenhuma ocorrência ou captura registrada nesta inspeção.</p>'));
  }

  const actWrap = el('<div class="card stack"><h3 class="title-lg">Avaliar inspeção</h3></div>');
  app.appendChild(actWrap);
  const row = el('<div class="row" style="gap:10px"></div>');
  actWrap.appendChild(row);
  const btnAprovar = el('<button class="btn btn--primary" style="flex:1">Aprovada</button>');
  const btnPendencia = el('<button class="btn btn--danger" style="flex:1">Com pendência</button>');
  row.appendChild(btnAprovar); row.appendChild(btnPendencia);

  btnAprovar.onclick = async function () {
    await api('validarInspecao', { idInspecao: i.ID_INSPECAO, resultado: 'APROVADA' });
    toast('Inspeção aprovada.', false, true);
    go('validacaoInspecoes');
  };
  btnPendencia.onclick = async function () {
    await api('validarInspecao', { idInspecao: i.ID_INSPECAO, resultado: 'COM_PENDENCIA' });
    go('registrarPendencia', { pendenciaOrigemInspecao: i });
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
        descricao: descField.getValue(), foto: foto.getValue()
      });
      toast('Pendência ' + data.idPendencia + ' registrada para ' + (data.responsavel || 'responsável não definido') + '.', false, true);
      S.pendenciaOrigemInspecao = null;
      go('dashPendencias');
    } catch (e) { btn.disabled = false; btn.textContent = 'Registrar pendência'; }
  };
}

// ------------------------- DASHBOARDS -------------------------

async function renderDashCarunchos() {
  app.appendChild(el(screenHeader('Dashboard de carunchos', S.unidade.UNIDADE)));
  const body = el('<div class="stack" id="body"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);
  const d = await api('getDashboardCarunchos', { unidade: S.unidade.UNIDADE }).catch(function () { return null; });
  body.innerHTML = '';
  if (!d) return;
  body.appendChild(el(
    '<div class="kpi-grid">' +
      kpi(d.totalCapturas, 'Total capturado') +
      kpi(d.armadilhasComCaptura, 'Armadilhas c/ captura') +
      kpi(d.mediaCaptura, 'Média por registro') +
      kpi(d.registros.length, 'Registros') +
    '</div>'
  ));
  body.appendChild(barCard('Capturas por armazém', d.porArmazem));
  body.appendChild(barCard('Capturas por armadilha', d.porArmadilha));
}

async function renderDashChecklist() {
  app.appendChild(el(screenHeader('Dashboard de limpeza', S.unidade.UNIDADE)));
  const body = el('<div class="stack" id="body"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);
  const d = await api('getDashboardChecklist', { unidade: S.unidade.UNIDADE }).catch(function () { return null; });
  body.innerHTML = '';
  if (!d) return;
  body.appendChild(el(
    '<div class="kpi-grid">' + kpi(d.total, 'Itens registrados') + kpi(d.naoConformidades, 'Não conformidades') + '</div>'
  ));
  body.appendChild(barCard('Por conferente', d.porConferente));
  body.appendChild(barCard('Por armazém', d.porArmazem));
  body.appendChild(barCard('Por periodicidade', d.porPeriodicidade));
}

async function renderDashPendencias() {
  app.appendChild(el(screenHeader('Dashboard de pendências', S.unidade.UNIDADE)));
  const body = el('<div class="stack" id="body"><p class="subtle">Carregando…</p></div>');
  app.appendChild(body);
  const d = await api('getDashboardPendencias', { unidade: S.unidade.UNIDADE }).catch(function () { return null; });
  body.innerHTML = '';
  if (!d) return;
  body.appendChild(el(
    '<div class="kpi-grid">' +
      kpi(d.abertas, 'Abertas') + kpi(d.emTratamento, 'Em tratamento') +
      kpi(d.aguardandoValidacao, 'Aguard. validação') + kpi(d.finalizadas, 'Finalizadas') +
    '</div>'
  ));
  body.appendChild(barCard('Por armazém', d.porArmazem));
  body.appendChild(barCard('Por ocorrência', d.porOcorrencia));

  const listCard = el('<div class="card stack"><h3 class="title-lg">Pendências recentes</h3></div>');
  body.appendChild(listCard);
  const listInner = el('<div class="stack"></div>');
  listCard.appendChild(listInner);
  renderPendenciasList(listInner, d.registros.slice(0, 12), function (p) { go('pendenciaDetalhe', { pendenciaAtual: p }); });
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
