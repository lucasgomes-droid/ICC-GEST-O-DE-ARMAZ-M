/**
 * GESTÃO DE ARMAZÉNS — BACKEND (Google Apps Script)
 * ---------------------------------------------------
 * Este script deve ser colado no editor de Apps Script vinculado à sua
 * planilha do Google Sheets (Extensões > Apps Script).
 *
 * Ele expõe uma API HTTP (Web App) que o site estático (GitHub Pages)
 * consome via fetch(). Toda a "verdade" dos dados vive na planilha.
 *
 * IMPORTANTE:
 * 1. Rode a função `configurarPlanilha()` UMA VEZ (menu Executar > configurarPlanilha)
 *    para criar todas as abas com os cabeçalhos corretos.
 * 2. Implante como Web App: Implantar > Nova implantação > Tipo: App da Web
 *    - Executar como: Eu
 *    - Quem pode acessar: Qualquer pessoa
 * 3. Copie a URL gerada e cole em app.js na constante API_URL.
 */

// ======================= CONFIGURAÇÃO =======================

const SHEETS = {
  UNIDADES: 'CONFIG_UNIDADES',
  USUARIOS: 'CONFIG_USUARIOS',
  ARMAZENS: 'CONFIG_ARMAZENS',
  ARMADILHAS: 'CONFIG_ARMADILHAS',
  OCORRENCIAS_TIPOS: 'CONFIG_OCORRENCIAS',
  INSPECOES: 'INSPECOES',
  OCORRENCIAS_INSPECAO: 'OCORRENCIAS_INSPECAO',
  CAPTURAS: 'CAPTURA_CARUNCHOS',
  CHECKLISTS: 'CHECKLIST_LIMPEZA',
  PENDENCIAS: 'PENDENCIAS',
  SEQ: '_SEQ'
};

const HEADERS = {
  CONFIG_UNIDADES: ['ID_UNIDADE', 'UNIDADE', 'ATIVO'],
  CONFIG_USUARIOS: ['ID_USUARIO', 'NOME', 'USUARIO', 'UNIDADE', 'TIPO', 'SENHA', 'ATIVO'],
  CONFIG_ARMAZENS: ['ID_ARMAZEM', 'UNIDADE', 'ARMAZEM', 'RESPONSAVEL', 'ID_RESPONSAVEL', 'ATIVO'],
  CONFIG_ARMADILHAS: ['ID_ARMADILHA', 'UNIDADE', 'ARMAZEM', 'ARMADILHA', 'LOCAL', 'ATIVO'],
  CONFIG_OCORRENCIAS: ['ID_OCORRENCIA', 'TIPO', 'DESCRICAO', 'ATIVO'],
  INSPECOES: ['ID_INSPECAO', 'DATA', 'HORA', 'UNIDADE', 'ID_USUARIO', 'USUARIO', 'ARMAZEM', 'RESULTADO', 'OBSERVACAO'],
  OCORRENCIAS_INSPECAO: ['ID_OCORRENCIA_REGISTRO', 'ID_INSPECAO', 'UNIDADE', 'ARMAZEM', 'TIPO', 'DESCRICAO', 'FOTO', 'DATA', 'USUARIO'],
  CAPTURA_CARUNCHOS: ['ID_CAPTURA', 'ID_INSPECAO', 'UNIDADE', 'ARMAZEM', 'ARMADILHA', 'QUANTIDADE', 'PRODUTO_PROXIMO', 'BAIA', 'OBSERVACAO', 'DATA', 'USUARIO'],
  CHECKLIST_LIMPEZA: ['ID_CHECKLIST', 'DATA', 'HORA', 'UNIDADE', 'USUARIO', 'ARMAZEM', 'PERIODICIDADE', 'ITEM', 'RESULTADO', 'OBSERVACAO', 'FOTO'],
  PENDENCIAS: ['ID_PENDENCIA', 'ID_INSPECAO', 'UNIDADE', 'ARMAZEM', 'RESPONSAVEL', 'ID_RESPONSAVEL', 'CONFERENTE', 'ID_CONFERENTE', 'ADMIN_REGISTROU', 'ORIGEM', 'TIPO', 'DESCRICAO', 'FOTO_ORIGEM', 'DATA_ABERTURA', 'STATUS', 'DATA_RESOLUCAO', 'DESCRICAO_SOLUCAO', 'FOTO_SOLUCAO', 'DATA_VALIDACAO', 'ADMIN_VALIDADOR'],
  _SEQ: ['PREFIXO', 'ULTIMO_NUMERO']
};

const FOLDER_NAME = 'GestaoArmazens_Fotos';

// ======================= SETUP (rodar uma vez) =======================

function configurarPlanilha() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(function (sheetName) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    const headers = HEADERS[sheetName];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  });

  // Seed inicial de exemplo (pode editar/apagar depois na planilha)
  seedIfEmpty_(SHEETS.UNIDADES, [
    ['UNI-001', 'Macatuba', 'SIM'],
    ['UNI-002', 'Jundiaí I', 'SIM'],
    ['UNI-003', 'Jundiaí II', 'SIM']
  ]);
  seedIfEmpty_(SHEETS.USUARIOS, [
    ['USR-001', 'Lucas', 'lucas', 'Macatuba', 'ADMIN', '1234', 'SIM'],
    ['USR-002', 'João', 'joao', 'Macatuba', 'CONFERENTE', '', 'SIM']
  ]);
  seedIfEmpty_(SHEETS.ARMAZENS, [
    ['ARM-001', 'Macatuba', 'Armazém 01', 'João', 'USR-002', 'SIM']
  ]);
  seedIfEmpty_(SHEETS.OCORRENCIAS_TIPOS, [
    ['OC-001', 'Produto avariado', 'Produto com avaria física', 'SIM'],
    ['OC-002', 'Goteira', 'Goteira identificada na cobertura', 'SIM'],
    ['OC-003', 'Risco de queda', 'Carga/baia com risco de queda', 'SIM'],
    ['OC-004', 'Risco de tombamento', 'Carga com risco de tombamento', 'SIM'],
    ['OC-005', 'Falha de limpeza', 'Não conformidade de limpeza', 'SIM'],
    ['OC-006', 'Não realização da inspeção', '', 'SIM'],
    ['OC-007', 'Divergência no checklist', '', 'SIM'],
    ['OC-008', 'Outro', 'Descrição livre', 'SIM']
  ]);

  SpreadsheetApp.flush();
  return 'Planilha configurada com sucesso.';
}

function seedIfEmpty_(sheetName, rows) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (sheet.getLastRow() <= 1) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

// ======================= ENTRY POINTS HTTP =======================

function doGet(e) {
  try {
    const action = e.parameter.action;
    const result = routeAction_(action, e.parameter);
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const result = routeAction_(action, body.payload || {});
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function routeAction_(action, params) {
  const lock = LockService.getScriptLock();
  const readOnlyActions = ['getUnidades', 'getUsuarios', 'getArmazens', 'getArmadilhas',
    'getOcorrenciasTipos', 'getPendencias', 'getInspecoes', 'getHistoricoConferente',
    'getDashboardCarunchos', 'getDashboardChecklist', 'getDashboardPendencias', 'getInspecaoDetalhe'];

  if (!readOnlyActions.includes(action)) {
    lock.waitLock(10000);
  }
  try {
    switch (action) {
      case 'getUnidades': return { ok: true, data: getUnidades_() };
      case 'getUsuarios': return { ok: true, data: getUsuarios_(params.unidade) };
      case 'loginAdmin': return loginAdmin_(params);
      case 'getArmazens': return { ok: true, data: getArmazens_(params.unidade) };
      case 'getArmadilhas': return { ok: true, data: getArmadilhas_(params.unidade, params.armazem) };
      case 'getOcorrenciasTipos': return { ok: true, data: getOcorrenciasTipos_() };

      case 'createInspecao': return criarInspecao_(params);
      case 'createChecklist': return criarChecklist_(params);

      case 'createPendencia': return criarPendencia_(params);
      case 'getPendencias': return { ok: true, data: getPendencias_(params) };
      case 'resolverPendencia': return resolverPendencia_(params);
      case 'validarPendencia': return validarPendencia_(params);

      case 'getInspecoes': return { ok: true, data: getInspecoes_(params) };
      case 'getInspecaoDetalhe': return { ok: true, data: getInspecaoDetalhe_(params.idInspecao) };
      case 'validarInspecao': return validarInspecao_(params);

      case 'getHistoricoConferente': return { ok: true, data: getHistoricoConferente_(params.idUsuario) };

      case 'getDashboardCarunchos': return { ok: true, data: getDashboardCarunchos_(params) };
      case 'getDashboardChecklist': return { ok: true, data: getDashboardChecklist_(params) };
      case 'getDashboardPendencias': return { ok: true, data: getDashboardPendencias_(params) };

      default: return { ok: false, error: 'Ação desconhecida: ' + action };
    }
  } finally {
    if (!readOnlyActions.includes(action)) lock.releaseLock();
  }
}

// ======================= HELPERS DE PLANILHA =======================

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// Lê uma aba inteira e retorna array de objetos {HEADER: valor}
function readSheet_(name) {
  const sh = sheet_(name);
  const range = sh.getDataRange().getValues();
  const headers = range[0];
  const rows = range.slice(1);
  return rows
    .filter(function (r) { return r.join('') !== ''; })
    .map(function (r) {
      const obj = {};
      headers.forEach(function (h, i) { obj[h] = r[i]; });
      return obj;
    });
}

function appendRow_(sheetName, rowObj) {
  const sh = sheet_(sheetName);
  const headers = HEADERS[sheetName];
  const row = headers.map(function (h) { return rowObj[h] !== undefined ? rowObj[h] : ''; });
  sh.appendRow(row);
}

// Atualiza campos de uma linha identificada por um valor de ID numa coluna
function updateRowById_(sheetName, idColumn, idValue, updates) {
  const sh = sheet_(sheetName);
  const range = sh.getDataRange().getValues();
  const headers = range[0];
  const idIdx = headers.indexOf(idColumn);
  for (let i = 1; i < range.length; i++) {
    if (String(range[i][idIdx]) === String(idValue)) {
      Object.keys(updates).forEach(function (key) {
        const colIdx = headers.indexOf(key);
        if (colIdx > -1) {
          sh.getRange(i + 1, colIdx + 1).setValue(updates[key]);
        }
      });
      return true;
    }
  }
  return false;
}

function findRowById_(sheetName, idColumn, idValue) {
  const rows = readSheet_(sheetName);
  return rows.find(function (r) { return String(r[idColumn]) === String(idValue); }) || null;
}

// Gera IDs sequenciais únicos, ex: INS-000001
function nextId_(prefix) {
  const sh = sheet_(SHEETS.SEQ);
  const range = sh.getDataRange().getValues();
  for (let i = 1; i < range.length; i++) {
    if (range[i][0] === prefix) {
      const next = Number(range[i][1]) + 1;
      sh.getRange(i + 1, 2).setValue(next);
      return prefix + '-' + String(next).padStart(6, '0');
    }
  }
  sh.appendRow([prefix, 1]);
  return prefix + '-000001';
}

function nowDateStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT-3', 'dd/MM/yyyy');
}
function nowTimeStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT-3', 'HH:mm');
}

// Salva foto (data URL base64) no Drive e retorna a URL pública de visualização
function salvarFoto_(dataUrl, nomeArquivo) {
  if (!dataUrl) return '';
  const match = String(dataUrl).match(/^data:(.+);base64,(.*)$/);
  if (!match) return '';
  const contentType = match[1];
  const base64 = match[2];
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, contentType, nomeArquivo || ('foto_' + new Date().getTime()));

  let folders = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/uc?id=' + file.getId();
}

// ======================= CONFIG (unidades, usuários, armazéns...) =======================

function getUnidades_() {
  return readSheet_(SHEETS.UNIDADES).filter(function (u) { return String(u.ATIVO).toUpperCase() === 'SIM'; });
}

function getUsuarios_(unidade) {
  return readSheet_(SHEETS.USUARIOS).filter(function (u) {
    return u.UNIDADE === unidade && String(u.ATIVO).toUpperCase() === 'SIM';
  }).map(function (u) {
    return { ID_USUARIO: u.ID_USUARIO, NOME: u.NOME, USUARIO: u.USUARIO, TIPO: u.TIPO, UNIDADE: u.UNIDADE };
    // SENHA nunca é enviada ao frontend
  });
}

function loginAdmin_(params) {
  const usuarios = readSheet_(SHEETS.USUARIOS);
  const usuario = usuarios.find(function (u) {
    return String(u.ID_USUARIO) === String(params.idUsuario) && String(u.ATIVO).toUpperCase() === 'SIM';
  });
  if (!usuario) return { ok: false, error: 'Usuário não encontrado.' };
  if (String(usuario.SENHA) !== String(params.senha)) return { ok: false, error: 'Senha incorreta.' };
  return { ok: true, data: { ID_USUARIO: usuario.ID_USUARIO, NOME: usuario.NOME, TIPO: usuario.TIPO, UNIDADE: usuario.UNIDADE } };
}

function getArmazens_(unidade) {
  return readSheet_(SHEETS.ARMAZENS).filter(function (a) {
    return a.UNIDADE === unidade && String(a.ATIVO).toUpperCase() === 'SIM';
  });
}

function getArmadilhas_(unidade, armazem) {
  return readSheet_(SHEETS.ARMADILHAS).filter(function (a) {
    return a.UNIDADE === unidade && (!armazem || a.ARMAZEM === armazem) && String(a.ATIVO).toUpperCase() === 'SIM';
  });
}

function getOcorrenciasTipos_() {
  return readSheet_(SHEETS.OCORRENCIAS_TIPOS).filter(function (o) { return String(o.ATIVO).toUpperCase() === 'SIM'; });
}

// ======================= INSPEÇÃO =======================

function criarInspecao_(p) {
  const idInspecao = nextId_('INS');
  appendRow_(SHEETS.INSPECOES, {
    ID_INSPECAO: idInspecao,
    DATA: nowDateStr_(),
    HORA: nowTimeStr_(),
    UNIDADE: p.unidade,
    ID_USUARIO: p.idUsuario,
    USUARIO: p.usuario,
    ARMAZEM: p.armazem,
    RESULTADO: 'PENDENTE_VALIDACAO',
    OBSERVACAO: p.observacao || ''
  });

  // Ocorrências (produto avariado, goteira, risco de queda, risco de tombamento, etc.)
  (p.ocorrencias || []).forEach(function (oc) {
    const foto = salvarFoto_(oc.foto, idInspecao + '_ocorrencia');
    appendRow_(SHEETS.OCORRENCIAS_INSPECAO, {
      ID_OCORRENCIA_REGISTRO: nextId_('OCR'),
      ID_INSPECAO: idInspecao,
      UNIDADE: p.unidade,
      ARMAZEM: p.armazem,
      TIPO: oc.tipo,
      DESCRICAO: oc.descricao || '',
      FOTO: foto,
      DATA: nowDateStr_(),
      USUARIO: p.usuario
    });
  });

  // Capturas de carunchos (uma ou mais armadilhas na mesma inspeção)
  (p.capturas || []).forEach(function (cap) {
    appendRow_(SHEETS.CAPTURAS, {
      ID_CAPTURA: nextId_('CAR'),
      ID_INSPECAO: idInspecao,
      UNIDADE: p.unidade,
      ARMAZEM: p.armazem,
      ARMADILHA: cap.armadilha,
      QUANTIDADE: cap.quantidade,
      PRODUTO_PROXIMO: cap.produtoProximo ? 'SIM' : 'NAO',
      BAIA: cap.baia || '',
      OBSERVACAO: cap.observacao || '',
      DATA: nowDateStr_(),
      USUARIO: p.usuario
    });
  });

  return { ok: true, data: { idInspecao: idInspecao } };
}

function getInspecoes_(params) {
  let rows = readSheet_(SHEETS.INSPECOES).filter(function (r) { return r.UNIDADE === params.unidade; });
  if (params.armazem) rows = rows.filter(function (r) { return r.ARMAZEM === params.armazem; });
  if (params.usuario) rows = rows.filter(function (r) { return r.USUARIO === params.usuario; });
  if (params.status) rows = rows.filter(function (r) { return r.RESULTADO === params.status; });
  if (params.dataInicial) rows = rows.filter(function (r) { return toDate_(r.DATA) >= toDate_(params.dataInicial); });
  if (params.dataFinal) rows = rows.filter(function (r) { return toDate_(r.DATA) <= toDate_(params.dataFinal); });
  return rows.sort(function (a, b) { return b.ID_INSPECAO.localeCompare(a.ID_INSPECAO); });
}

function getInspecaoDetalhe_(idInspecao) {
  const inspecao = findRowById_(SHEETS.INSPECOES, 'ID_INSPECAO', idInspecao);
  const ocorrencias = readSheet_(SHEETS.OCORRENCIAS_INSPECAO).filter(function (o) { return o.ID_INSPECAO === idInspecao; });
  const capturas = readSheet_(SHEETS.CAPTURAS).filter(function (c) { return c.ID_INSPECAO === idInspecao; });
  return { inspecao: inspecao, ocorrencias: ocorrencias, capturas: capturas };
}

function validarInspecao_(p) {
  updateRowById_(SHEETS.INSPECOES, 'ID_INSPECAO', p.idInspecao, { RESULTADO: p.resultado });
  return { ok: true };
}

// ======================= CHECKLIST DE LIMPEZA =======================

function criarChecklist_(p) {
  const idChecklist = nextId_('CHK');
  (p.itens || []).forEach(function (item) {
    const foto = salvarFoto_(item.foto, idChecklist + '_' + item.item);
    appendRow_(SHEETS.CHECKLISTS, {
      ID_CHECKLIST: idChecklist,
      DATA: nowDateStr_(),
      HORA: nowTimeStr_(),
      UNIDADE: p.unidade,
      USUARIO: p.usuario,
      ARMAZEM: p.armazem,
      PERIODICIDADE: p.periodicidade,
      ITEM: item.item,
      RESULTADO: item.resultado,
      OBSERVACAO: item.observacao || '',
      FOTO: foto
    });
  });
  return { ok: true, data: { idChecklist: idChecklist } };
}

// ======================= PENDÊNCIAS =======================

function criarPendencia_(p) {
  // Direcionamento automático: consulta o responsável do armazém
  const armazem = readSheet_(SHEETS.ARMAZENS).find(function (a) {
    return a.UNIDADE === p.unidade && a.ARMAZEM === p.armazem;
  });
  const responsavel = armazem ? armazem.RESPONSAVEL : '';
  const idResponsavel = armazem ? armazem.ID_RESPONSAVEL : '';

  const foto = salvarFoto_(p.foto, 'pendencia_' + new Date().getTime());
  const idPendencia = nextId_('PEN');

  appendRow_(SHEETS.PENDENCIAS, {
    ID_PENDENCIA: idPendencia,
    ID_INSPECAO: p.idInspecao || '',
    UNIDADE: p.unidade,
    ARMAZEM: p.armazem,
    RESPONSAVEL: responsavel,
    ID_RESPONSAVEL: idResponsavel,
    CONFERENTE: p.conferente || '',
    ID_CONFERENTE: p.idConferente || '',
    ADMIN_REGISTROU: p.admin || '',
    ORIGEM: p.origem || 'MANUAL',
    TIPO: p.tipo,
    DESCRICAO: p.descricao || '',
    FOTO_ORIGEM: foto,
    DATA_ABERTURA: nowDateStr_() + ' ' + nowTimeStr_(),
    STATUS: 'ABERTA',
    DATA_RESOLUCAO: '',
    DESCRICAO_SOLUCAO: '',
    FOTO_SOLUCAO: '',
    DATA_VALIDACAO: '',
    ADMIN_VALIDADOR: ''
  });

  return { ok: true, data: { idPendencia: idPendencia, responsavel: responsavel } };
}

function getPendencias_(params) {
  let rows = readSheet_(SHEETS.PENDENCIAS).filter(function (r) { return r.UNIDADE === params.unidade; });
  if (params.idResponsavel) rows = rows.filter(function (r) { return String(r.ID_RESPONSAVEL) === String(params.idResponsavel); });
  if (params.status) rows = rows.filter(function (r) { return r.STATUS === params.status; });
  if (params.armazem) rows = rows.filter(function (r) { return r.ARMAZEM === params.armazem; });
  return rows.sort(function (a, b) { return b.ID_PENDENCIA.localeCompare(a.ID_PENDENCIA); });
}

function resolverPendencia_(p) {
  if (!p.fotoSolucao) return { ok: false, error: 'Foto de comprovação é obrigatória para resolver a pendência.' };
  const foto = salvarFoto_(p.fotoSolucao, p.idPendencia + '_solucao');
  updateRowById_(SHEETS.PENDENCIAS, 'ID_PENDENCIA', p.idPendencia, {
    STATUS: 'AGUARDANDO_VALIDACAO',
    DESCRICAO_SOLUCAO: p.descricaoSolucao || '',
    FOTO_SOLUCAO: foto,
    DATA_RESOLUCAO: nowDateStr_() + ' ' + nowTimeStr_()
  });
  return { ok: true };
}

function validarPendencia_(p) {
  updateRowById_(SHEETS.PENDENCIAS, 'ID_PENDENCIA', p.idPendencia, {
    STATUS: p.aprovado ? 'FINALIZADA' : 'EM_TRATAMENTO',
    DATA_VALIDACAO: nowDateStr_() + ' ' + nowTimeStr_(),
    ADMIN_VALIDADOR: p.adminValidador || ''
  });
  return { ok: true };
}

// ======================= HISTÓRICO =======================

function getHistoricoConferente_(idUsuario) {
  const inspecoes = readSheet_(SHEETS.INSPECOES).filter(function (i) { return String(i.ID_USUARIO) === String(idUsuario); });
  const checklists = readSheet_(SHEETS.CHECKLISTS).filter(function (c) { return c.USUARIO && String(c.USUARIO) === String(idUsuario); });
  return { inspecoes: inspecoes, checklists: checklists };
}

// ======================= DASHBOARDS =======================

function getDashboardCarunchos_(params) {
  let capturas = readSheet_(SHEETS.CAPTURAS).filter(function (c) { return c.UNIDADE === params.unidade; });
  if (params.armazem) capturas = capturas.filter(function (c) { return c.ARMAZEM === params.armazem; });
  if (params.dataInicial) capturas = capturas.filter(function (c) { return toDate_(c.DATA) >= toDate_(params.dataInicial); });
  if (params.dataFinal) capturas = capturas.filter(function (c) { return toDate_(c.DATA) <= toDate_(params.dataFinal); });

  const totalCapturas = capturas.reduce(function (s, c) { return s + Number(c.QUANTIDADE || 0); }, 0);
  const porArmazem = agruparSoma_(capturas, 'ARMAZEM', 'QUANTIDADE');
  const porArmadilha = agruparSoma_(capturas, 'ARMADILHA', 'QUANTIDADE');
  const armadilhasComCaptura = new Set(capturas.map(function (c) { return c.ARMADILHA; })).size;
  const media = capturas.length ? (totalCapturas / capturas.length) : 0;

  return {
    totalCapturas: totalCapturas,
    porArmazem: porArmazem,
    porArmadilha: porArmadilha,
    armadilhasComCaptura: armadilhasComCaptura,
    mediaCaptura: Math.round(media * 100) / 100,
    registros: capturas
  };
}

function getDashboardChecklist_(params) {
  let rows = readSheet_(SHEETS.CHECKLISTS).filter(function (c) { return c.UNIDADE === params.unidade; });
  if (params.armazem) rows = rows.filter(function (c) { return c.ARMAZEM === params.armazem; });
  if (params.conferente) rows = rows.filter(function (c) { return c.USUARIO === params.conferente; });
  if (params.periodicidade) rows = rows.filter(function (c) { return c.PERIODICIDADE === params.periodicidade; });

  return {
    total: rows.length,
    naoConformidades: rows.filter(function (r) { return r.RESULTADO && r.RESULTADO !== 'OK'; }).length,
    porConferente: agruparContagem_(rows, 'USUARIO'),
    porArmazem: agruparContagem_(rows, 'ARMAZEM'),
    porPeriodicidade: agruparContagem_(rows, 'PERIODICIDADE'),
    registros: rows
  };
}

function getDashboardPendencias_(params) {
  const rows = readSheet_(SHEETS.PENDENCIAS).filter(function (p) { return p.UNIDADE === params.unidade; });
  return {
    abertas: rows.filter(function (r) { return r.STATUS === 'ABERTA'; }).length,
    emTratamento: rows.filter(function (r) { return r.STATUS === 'EM_TRATAMENTO'; }).length,
    aguardandoValidacao: rows.filter(function (r) { return r.STATUS === 'AGUARDANDO_VALIDACAO'; }).length,
    finalizadas: rows.filter(function (r) { return r.STATUS === 'FINALIZADA'; }).length,
    total: rows.length,
    porArmazem: agruparContagem_(rows, 'ARMAZEM'),
    porConferente: agruparContagem_(rows, 'CONFERENTE'),
    porOcorrencia: agruparContagem_(rows, 'TIPO'),
    registros: rows
  };
}

// ======================= UTIL =======================

function agruparSoma_(rows, campoChave, campoValor) {
  const acc = {};
  rows.forEach(function (r) {
    const k = r[campoChave] || 'N/A';
    acc[k] = (acc[k] || 0) + Number(r[campoValor] || 0);
  });
  return acc;
}

function agruparContagem_(rows, campoChave) {
  const acc = {};
  rows.forEach(function (r) {
    const k = r[campoChave] || 'N/A';
    acc[k] = (acc[k] || 0) + 1;
  });
  return acc;
}

function toDate_(str) {
  // aceita dd/MM/yyyy
  if (!str) return new Date(0);
  const parts = String(str).split('/');
  if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]);
  return new Date(str);
}
