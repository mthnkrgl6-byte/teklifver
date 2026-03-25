const menuButtons = document.querySelectorAll('.menu-btn');
const pages = {
  quote: document.getElementById('quote-page'),
  price: document.getElementById('price-page')
};

const state = {
  previewRows: [],
  priceLists: JSON.parse(localStorage.getItem('priceLists') || '[]'),
  convertedRows: [],
  offerRows: [],
  chatDemandText: ''
};

const $ = (id) => document.getElementById(id);
const qs = (selector) => document.querySelector(selector);
const normalize = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9çğıöşü\s]/gi, ' ').replace(/\s+/g, ' ').trim();
const n = (v) => Number(v) || 0;
const SUPPORTED_PRICE_EXTENSIONS = ['xlsx', 'xls', 'csv'];
const SEMANTIC_SYNONYMS = {
  pp: 'pprc',
  ppr: 'pprc',
  pvcu: 'pvc',
  reduksiyon: 'reduksiyon',
  rediksiyon: 'reduksiyon',
  rekor: 'reduksiyon',
  dirsek87: 'dirsek90',
  dirsek90: 'dirsek90',
  boru: 'boru'
};
const STOPWORDS = new Set(['ve', 'ile', 'icin', 'için', 'adet', 'metre', 'mt', 'pn', 'mm', 'super', 'kalde']);

menuButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    menuButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(pages).forEach((p) => p.classList.add('hidden'));
    pages[btn.dataset.page].classList.remove('hidden');
  });
});

function saveLists() {
  localStorage.setItem('priceLists', JSON.stringify(state.priceLists));
}

function renderEditableRows(tbody, rows, mode) {
  tbody.innerHTML = '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" data-row="${i}" /></td>
      <td contenteditable="true" data-k="code">${r.code || ''}</td>
      <td contenteditable="true" data-k="name">${r.name || ''}</td>
      <td contenteditable="true" data-k="price">${n(r.price).toFixed(2)}</td>
      ${mode === 'converted' ? `<td contenteditable="true" data-k="qty">${n(r.qty)}</td><td>${r.listName || ''}</td>` : ''}
    `;
    tr.querySelectorAll('[contenteditable=true]').forEach((cell) => {
      cell.addEventListener('input', () => {
        const key = cell.dataset.k;
        rows[i][key] = cell.textContent.trim();
      });
    });
    tbody.appendChild(tr);
  });
}

function renderPricePreview() {
  renderEditableRows(qs('#price-preview-table tbody'), state.previewRows, 'preview');
}

function getPriceFile() {
  const fileInput = $('price-file');
  const file = fileInput?.files?.[0] || null;
  if (!file) return null;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!SUPPORTED_PRICE_EXTENSIONS.includes(extension)) return null;
  return file;
}

function updatePreviewButtonState() {
  const canPreview = Boolean(getPriceFile());
  $('preview-price').disabled = !canPreview;
}

function renderStoredLists() {
  const tbody = qs('#stored-lists-table tbody');
  tbody.innerHTML = '';
  state.priceLists.forEach((list, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="radio" name="list-radio" value="${idx}"/></td><td>${list.uploadedAt}</td><td>${list.name}</td><td>${list.items.length}</td>`;
    tbody.appendChild(tr);
  });
  refreshListSelectors();
}

async function parseExcelFile(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const rows = json.slice(1).filter((r) => r.length);
  return rows.map((r) => ({ code: `${r[0] || ''}`.trim(), name: `${r[1] || ''}`.trim(), price: n(r[2]) }));
}

async function extractTextFromImage(file) {
  if (!window.Tesseract) throw new Error('OCR kütüphanesi yüklenemedi');
  const result = await window.Tesseract.recognize(file, 'tur+eng');
  return result?.data?.text || '';
}

$('preview-price').addEventListener('click', async () => {
  const file = getPriceFile();
  if (!file) {
    alert('Lütfen geçerli bir Excel/CSV dosyası seçin (.xlsx, .xls, .csv).');
    updatePreviewButtonState();
    return;
  }
  try {
    state.previewRows = await parseExcelFile(file);
    if (!state.previewRows.length) {
      alert('Dosya okundu ancak önizlenecek satır bulunamadı. İlk satır başlık olmalı.');
    }
    renderPricePreview();
  } catch (err) {
    console.error('Fiyat listesi parse hatası:', err);
    alert('Dosya okunamadı. Lütfen dosya formatını kontrol edin ve tekrar deneyin.');
  }
});

$('price-file').addEventListener('change', updatePreviewButtonState);

$('add-preview-row').addEventListener('click', () => {
  state.previewRows.push({ code: '', name: '', price: 0 });
  renderPricePreview();
});
$('remove-preview-row').addEventListener('click', () => {
  const checks = [...document.querySelectorAll('#price-preview-table tbody input[type=checkbox]:checked')].map((x) => Number(x.dataset.row));
  state.previewRows = state.previewRows.filter((_, i) => !checks.includes(i));
  renderPricePreview();
});
$('select-all-preview').addEventListener('change', (e) => {
  document.querySelectorAll('#price-preview-table tbody input[type=checkbox]').forEach((c) => (c.checked = e.target.checked));
});

$('upload-price-list').addEventListener('click', () => {
  const name = $('price-list-name').value.trim() || `Liste-${state.priceLists.length + 1}`;
  if (!state.previewRows.length) return alert('Önce önizleme oluşturun');
  state.priceLists.push({
    id: Date.now(),
    name,
    uploadedAt: new Date().toLocaleString('tr-TR'),
    items: state.previewRows.map((x) => ({ ...x, price: n(x.price) }))
  });
  state.previewRows = [];
  saveLists();
  renderPricePreview();
  renderStoredLists();
  alert('Fiyat listesi yüklendi.');
});

$('delete-list').addEventListener('click', () => {
  const selected = document.querySelector('input[name=list-radio]:checked');
  if (!selected) return alert('Liste seçiniz');
  state.priceLists.splice(Number(selected.value), 1);
  saveLists();
  renderStoredLists();
});
$('edit-list').addEventListener('click', () => {
  const selected = document.querySelector('input[name=list-radio]:checked');
  if (!selected) return alert('Liste seçiniz');
  const list = state.priceLists[Number(selected.value)];
  $('price-list-name').value = `${list.name} (düzenlendi)`;
  state.previewRows = list.items.map((x) => ({ ...x }));
  renderPricePreview();
  state.priceLists.splice(Number(selected.value), 1);
  saveLists();
  renderStoredLists();
});

function refreshListSelectors() {
  const sel = $('converter-price-lists');
  sel.innerHTML = '';
  state.priceLists.forEach((l) => {
    const row = document.createElement('label');
    row.innerHTML = `<input type="checkbox" data-converter-list="${l.id}" checked /> ${l.name}`;
    sel.appendChild(row);
  });

  const detail = $('discount-list-selectors');
  detail.innerHTML = '';
  state.priceLists.forEach((l) => {
    const row = document.createElement('div');
    row.innerHTML = `<label><input type="checkbox" data-list-id="${l.id}" checked /> ${l.name}</label>
      <label>İskonto % <input type="number" min="0" max="100" value="0" data-discount="${l.id}"/></label>`;
    row.className = 'form-grid';
    detail.appendChild(row);
  });
}

function similarity(a, b) {
  const aa = normalize(a); const bb = normalize(b);
  if (!aa || !bb) return 0;
  if (aa.includes(bb) || bb.includes(aa)) return 0.95;
  const canon = (w) => SEMANTIC_SYNONYMS[w] || w;
  const aw = [...new Set(aa.split(' ').map(canon).filter(Boolean))];
  const bw = [...new Set(bb.split(' ').map(canon).filter(Boolean))];
  const common = aw.filter((w) => bw.includes(w)).length;
  const jaccard = common / Math.max((new Set([...aw, ...bw])).size, 1);
  const aJoined = aw.join(' ');
  const bJoined = bw.join(' ');
  const bigrams = (s) => {
    const out = [];
    for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
    return out;
  };
  const ab = bigrams(aJoined);
  const bb2 = bigrams(bJoined);
  const bgCommon = ab.filter((g) => bb2.includes(g)).length;
  const dice = (2 * bgCommon) / Math.max(ab.length + bb2.length, 1);
  return Math.max(common / Math.max(aw.length, bw.length), jaccard, dice);
}

function extractDimensions(text) {
  const src = (text || '').toString().toLowerCase();
  const match = src.match(/(\d+(?:[\.,]\d+)?)\s*(?:x|×|\*|\/|-)\s*(\d+(?:[\.,]\d+)?)/);
  if (!match) return null;
  const normalizeDimNumber = (value) => {
    let v = value.trim();
    if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
    if (/^\d{1,3}(,\d{3})+$/.test(v)) v = v.replace(/,/g, '');
    v = v.replace(',', '.');
    return String(Number(v) || 0);
  };
  return `${normalizeDimNumber(match[1])}x${normalizeDimNumber(match[2])}`;
}

function parseDimensionParts(dim) {
  if (!dim || !dim.includes('x')) return null;
  const [a, b] = dim.split('x').map((v) => Number(v));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { a, b };
}

function isCloseDimension(demandDim, itemDim) {
  const d = parseDimensionParts(demandDim);
  const i = parseDimensionParts(itemDim);
  if (!d || !i) return false;
  const firstRatioDiff = Math.abs(d.a - i.a) / Math.max(d.a, i.a, 1);
  const secondRatioDiff = Math.abs(d.b - i.b) / Math.max(d.b, i.b, 1);
  return firstRatioDiff <= 0.15 && secondRatioDiff <= 0.05;
}

function isReductionDimensionCompatible(demandDim, itemDim) {
  if (!demandDim || !itemDim) return false;
  if (demandDim === itemDim) return true;
  const d = parseDimensionParts(demandDim);
  const i = parseDimensionParts(itemDim);
  if (!d || !i) return false;
  return (Math.abs(d.a - i.b) <= 0.5 && Math.abs(d.b - i.a) <= 0.5);
}

function extractNominalSize(text) {
  const src = (text || '').toString().toLowerCase();
  const mmMatch = src.match(/(\d+(?:[\.,]\d+)?)\s*mm\b/);
  if (mmMatch) return Number(mmMatch[1].replace(',', '.'));
  const leadingMatch = src.match(/\b(\d+(?:[\.,]\d+)?)\s*(?:pp|pprc|pvc|boru|pn)\b/);
  if (leadingMatch) return Number(leadingMatch[1].replace(',', '.'));
  return null;
}

function parseDemandText(text) {
  return text.split(/\n|,/).map((line) => {
    const qtyMatch = line.match(/(\d+[\.,]?\d*)\s*(?:adet|mt|metre|pcs|tane|kg|koli|paket)\b/i)
      || line.match(/(?:adet|mt|metre|pcs|tane|kg|koli|paket)\s*(\d+[\.,]?\d*)\b/i)
      || line.match(/(\d+[\.,]?\d*)$/);
    const qty = qtyMatch ? n(qtyMatch[1].replace(',', '.')) : 1;
    const normalized = normalize(line.replace(/\d+[\.,]?\d*/g, ' '));
    const name = normalized
      .replace(/\b(adet|mt|metre|pcs|tane|kg|koli|paket)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const mustTokens = name
      .split(' ')
      .map((w) => SEMANTIC_SYNONYMS[w] || w)
      .filter((w) => w && w.length > 2 && !STOPWORDS.has(w));
    return { raw: line.trim(), name, qty, dimension: extractDimensions(line), nominalSize: extractNominalSize(line), intents: extractIntentTags(line), mustTokens };
  }).filter((x) => x.name);
}

function extractIntentTags(text) {
  const s = normalize(text);
  const tags = new Set();
  if (s.includes('dirsek')) tags.add('dirsek');
  if (s.includes('reduksiyon') || s.includes('redüksiyon') || s.includes('rediksiyon') || s.includes('reduk')) tags.add('reduksiyon');
  if (s.includes('boru')) tags.add('boru');
  if (s.includes('te') || s.includes('inegal')) tags.add('te');
  if (s.includes('traslama') || s.includes('traşlama')) tags.add('traslama');
  if (/\b(87|90)\b/.test(s) && s.includes('dirsek')) tags.add('dirsek_90');
  return tags;
}

function convertWithRules(demands, pools, options = {}) {
  const minScore = options.minScore ?? 0.05;
  const out = [];
  demands.forEach((d) => {
    let best = null;
    const candidates = [];
    pools.forEach((list) => list.items.forEach((item) => {
      const itemText = `${item.code || ''} ${item.name || ''}`;
      const demandDimension = d.dimension;
      const itemDimension = extractDimensions(itemText);
      const demandNominalSize = d.nominalSize;
      const itemNominalSize = extractNominalSize(itemText);
      const itemIntents = extractIntentTags(itemText);
      if (demandDimension && !itemDimension) return;
      let dimensionBoost = 0;
      if (demandDimension && itemDimension) {
        if (d.intents.has('reduksiyon') && isReductionDimensionCompatible(demandDimension, itemDimension)) {
          dimensionBoost = 0.2;
        } else if (demandDimension === itemDimension) {
          dimensionBoost = 0.2;
        } else if (isCloseDimension(demandDimension, itemDimension)) {
          dimensionBoost = 0.05;
        } else {
          return;
        }
      }
      if (!demandDimension && demandNominalSize && itemNominalSize && Math.abs(demandNominalSize - itemNominalSize) > 0.5) return;
      if (d.intents.has('boru') && !itemIntents.has('boru') && !options.softIntent) return;
      if (d.intents.has('reduksiyon') && !itemIntents.has('reduksiyon')) return;
      if (d.intents.has('reduksiyon') && itemIntents.has('te')) return;
      if (d.intents.has('te') && !itemIntents.has('te')) return;
      if (d.intents.has('dirsek') && !itemIntents.has('dirsek') && !options.softIntent) return;
      if (d.intents.has('dirsek_90') && !(itemText.includes('87') || itemText.includes('90'))) return;
      if (!d.intents.has('traslama') && itemIntents.has('traslama')) return;
      const itemNorm = normalize(itemText);
      const missingCriticalToken = (d.mustTokens || []).some((tok) => !itemNorm.includes(tok));
      if (missingCriticalToken && (d.mustTokens || []).length <= 2) return;
      const tokenCoverage = (d.mustTokens || []).length
        ? (d.mustTokens.filter((tok) => itemNorm.includes(tok)).length / d.mustTokens.length)
        : 0;
      const s = Math.max(similarity(d.name, item.name), similarity(d.name, item.code)) + dimensionBoost + (tokenCoverage * 0.2);
      candidates.push({ item, score: s, listName: list.name });
      if (!best || s > best.score) best = { item, score: s, listName: list.name };
    }));
    if (!best || best.score < minScore) {
      // Relaxed fallback pass to avoid empty conversions.
      pools.forEach((list) => list.items.forEach((item) => {
        const itemText = `${item.code || ''} ${item.name || ''}`;
        const demandDimension = d.dimension;
        const itemDimension = extractDimensions(itemText);
        if (demandDimension && itemDimension && demandDimension !== itemDimension && !isReductionDimensionCompatible(demandDimension, itemDimension)) return;
        const relaxedScore = Math.max(similarity(d.raw, item.name), similarity(d.raw, item.code));
        if (!best || relaxedScore > best.score) best = { item, score: relaxedScore, listName: list.name };
      }));
    }

    if (best && best.score >= 0.02) {
      const alternatives = candidates
        .filter((c) => c.item.code !== best.item.code || c.item.name !== best.item.name)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((c) => ({
          code: c.item.code,
          name: c.item.name,
          price: n(c.item.price),
          listName: c.listName
        }));
      out.push({ code: best.item.code, name: best.item.name, qty: d.qty, price: n(best.item.price), listName: best.listName, alternatives });
    } else {
      out.push({ code: '-', name: d.raw || d.name, qty: d.qty, price: 0, listName: 'Eşleşmedi', alternatives: [] });
    }
  });
  return out;
}

function appendChatMessage(role, text) {
  const log = $('chat-log');
  const line = document.createElement('div');
  line.innerHTML = `<b>${role}:</b> ${text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function findClosestCatalogItem(demand, lists) {
  let best = null;
  lists.forEach((list) => list.items.forEach((item) => {
    const itemText = `${item.code || ''} ${item.name || ''}`;
    const itemDimension = extractDimensions(itemText);
    if (demand.dimension && itemDimension && demand.dimension !== itemDimension && !isReductionDimensionCompatible(demand.dimension, itemDimension)) return;
    const score = Math.max(similarity(demand.name, item.name), similarity(demand.raw, item.name), similarity(demand.raw, item.code));
    if (!best || score > best.score) best = { item, score, listName: list.name };
  }));
  return best;
}

$('chat-analyze').addEventListener('click', () => {
  const raw = $('chat-input').value.trim();
  if (!raw) return;
  appendChatMessage('Müşteri', raw);
  const prepared = raw
    .replace(/[;]+/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const parsedDemands = parseDemandText(prepared);
  const lists = state.priceLists.length ? state.priceLists : [];
  const correctedLines = parsedDemands.map((d) => {
    const nearest = findClosestCatalogItem(d, lists);
    if (nearest && nearest.score >= 0.2) {
      return `${d.qty} adet ${nearest.item.name}`;
    }
    return `${d.qty} adet ${d.raw || d.name}`;
  });
  const correctedText = correctedLines.join('\n');
  state.chatDemandText = correctedText;
  $('manual-demand').value = correctedText;
  appendChatMessage('ChatGPT', 'Talep analiz edildi, fiyat listesine en yakın ürün adlarıyla düzenlendi ve metin alanına aktarıldı.');
  $('chat-input').value = '';
});

$('convert-demand').addEventListener('click', async () => {
  try {
    const selected = [...document.querySelectorAll('[data-converter-list]:checked')].map((o) => Number(o.dataset.converterList));
    if (!selected.length) return alert('En az 1 fiyat listesi seçin');
    let text = '';
    if ($('manual-entry-check').checked || $('manual-demand').value.trim() || state.chatDemandText.trim()) {
      text += ($('manual-demand').value.trim() || state.chatDemandText) + '\n';
    }
    const excelFile = $('excel-input').files[0];
    const imageFile = $('image-input').files[0];
    const pdfFile = $('pdf-input').files[0];
    const wordFile = $('word-input').files[0];
    if (excelFile) {
      const parsed = await parseExcelFile(excelFile);
      text += parsed.map((r) => `${r.name} ${r.qty || ''}`).join('\n');
    }
    if (imageFile) {
      try {
        alert('Görsel OCR işleniyor, lütfen bekleyin...');
        const imageText = await extractTextFromImage(imageFile);
        text += `\n${imageText}`;
      } catch (err) {
        console.error('OCR hatası:', err);
        alert('Görselden metin okunamadı. Görseli daha net yükleyin.');
      }
    }
    if ((pdfFile || wordFile) && !excelFile && !imageFile && !$('manual-demand').value.trim()) {
      alert('PDF/Word dönüştürme henüz desteklenmiyor. Lütfen metin, Excel veya görsel (OCR) kullanın.');
      return;
    }
    if (!text.trim()) return alert('Dönüştürücü için metin veya dosya ekleyin');

    const demands = parseDemandText(text);
    const pools = state.priceLists.filter((l) => selected.includes(l.id));
    const out = convertWithRules(demands, pools, { minScore: 0.04, softIntent: false });
    state.convertedRows = out;
    renderConverted();
    if (!out.length) {
      alert('Seçili fiyat listelerinde talep metni ile eşleşen ürün bulunamadı. Ürün adlarını daha açık yazmayı deneyin.');
    }
  } catch (err) {
    console.error('Dönüştürme sırasında beklenmeyen hata:', err);
    alert('Dönüştürme sırasında hata oluştu. Lütfen dosyaları ve girişleri kontrol edip tekrar deneyin.');
  }
});

function renderConverted() {
  const tbody = qs('#converted-table tbody');
  tbody.innerHTML = '';
  state.convertedRows.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" data-row="${i}" /></td>
      <td contenteditable="true" data-k="code">${r.code}</td>
      <td contenteditable="true" data-k="name">${r.name}</td>
      <td contenteditable="true" data-k="qty">${r.qty}</td>
      <td contenteditable="true" data-k="price">${n(r.price).toFixed(2)}</td>
      <td>${r.listName}</td>
      <td>
        <select data-alt-select="${i}">
          <option value=\"current\">Mevcut Eşleşme</option>
          ${(r.alternatives || []).map((alt, altIndex) => `<option value=\"${altIndex}\">${alt.name} (${alt.listName})</option>`).join('')}
        </select>
      </td>`;
    tr.querySelectorAll('[contenteditable=true]').forEach((cell) => {
      cell.addEventListener('input', () => { state.convertedRows[i][cell.dataset.k] = cell.textContent.trim(); });
    });
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-alt-select]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const rowIndex = Number(e.target.dataset.altSelect);
      const altIndex = e.target.value;
      if (altIndex === 'current') return;
      const chosen = state.convertedRows[rowIndex]?.alternatives?.[Number(altIndex)];
      if (!chosen) return;
      state.convertedRows[rowIndex].code = chosen.code;
      state.convertedRows[rowIndex].name = chosen.name;
      state.convertedRows[rowIndex].price = chosen.price;
      state.convertedRows[rowIndex].listName = chosen.listName;
      renderConverted();
    });
  });
}

$('add-convert-row').addEventListener('click', () => {
  state.convertedRows.push({ code: '', name: '', qty: 1, price: 0, listName: '-' });
  renderConverted();
});
$('remove-convert-row').addEventListener('click', () => {
  const checks = [...document.querySelectorAll('#converted-table tbody input[type=checkbox]:checked')].map((x) => Number(x.dataset.row));
  state.convertedRows = state.convertedRows.filter((_, i) => !checks.includes(i));
  renderConverted();
});
$('select-all-converted').addEventListener('change', (e) => {
  document.querySelectorAll('#converted-table tbody input[type=checkbox]').forEach((c) => (c.checked = e.target.checked));
});

$('move-to-offer').addEventListener('click', () => {
  state.offerRows = state.convertedRows.map((x) => ({ ...x, discount: 0 }));
  renderOffer();
});

function totals() {
  const discounts = Object.fromEntries([...document.querySelectorAll('[data-discount]')].map((inp) => [inp.dataset.discount, n(inp.value)]));
  const gross = state.offerRows.reduce((t, r) => t + n(r.qty) * n(r.price), 0);

  state.offerRows.forEach((row) => {
    const src = state.priceLists.find((l) => l.name === row.listName);
    row.discount = src ? (discounts[src.id] || 0) : n(row.discount);
  });
  const discounted = state.offerRows.reduce((t, r) => t + n(r.qty) * n(r.price) * (1 - n(r.discount) / 100), 0);
  const vatRate = n($('vat-rate').value);
  const maturity = ['kart', 'cek'].includes($('payment-method').value) ? n($('maturity-rate').value) : 0;
  const maturityAmount = discounted * maturity / 100;
  const vatAmount = (discounted + maturityAmount) * vatRate / 100;
  const grand = discounted + maturityAmount + vatAmount;

  $('totals').innerHTML = `
    <div>İskontosuz Satır Toplamı: <b>${gross.toFixed(2)} ₺</b></div>
    <div>İskontolu Satır Toplamı: <b>${discounted.toFixed(2)} ₺</b></div>
    <div>KDV (${vatRate}%): <b>${vatAmount.toFixed(2)} ₺</b></div>
    <div>Vade Farkı: <b>${maturityAmount.toFixed(2)} ₺</b></div>
    <hr />
    <div>Genel Toplam: <b>${grand.toFixed(2)} ₺</b></div>`;

  return { gross, discounted, vatAmount, maturityAmount, grand, vatRate };
}

function renderOffer() {
  const tbody = qs('#offer-table tbody');
  tbody.innerHTML = '';
  state.offerRows.forEach((r, i) => {
    const line = n(r.qty) * n(r.price) * (1 - n(r.discount) / 100);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td contenteditable="true" data-k="code" data-i="${i}">${r.code}</td>
      <td contenteditable="true" data-k="name" data-i="${i}">${r.name}</td>
      <td contenteditable="true" data-k="qty" data-i="${i}">${r.qty}</td>
      <td contenteditable="true" data-k="price" data-i="${i}">${n(r.price).toFixed(2)}</td>
      <td contenteditable="true" data-k="discount" data-i="${i}">${n(r.discount)}</td>
      <td>${line.toFixed(2)}</td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[contenteditable=true]').forEach((c) => c.addEventListener('input', () => {
    const i = Number(c.dataset.i);
    state.offerRows[i][c.dataset.k] = c.textContent.trim();
    renderOffer();
  }));
  totals();
}

['vat-rate', 'payment-method', 'maturity-rate'].forEach((id) => $(id).addEventListener('input', totals));
document.addEventListener('input', (e) => { if (e.target.matches('[data-discount]')) renderOffer(); });

$('create-offer').addEventListener('click', () => {
  if (!state.offerRows.length) return alert('Teklif ürünleri boş');
  const t = totals();
  const now = new Date().toLocaleString('tr-TR');
  const company = $('company').value || '-';
  const validity = $('validity').value || '-';
  const desc = $('description').value || '-';
  alert(`Teklif oluşturuldu\nTarih: ${now}\nFirma: ${company}\nGeçerlilik: ${validity}\nToplam: ${t.grand.toFixed(2)} ₺\nAçıklama: ${desc}`);
});

document.querySelectorAll('[data-download]').forEach((btn) => btn.addEventListener('click', () => {
  alert(`${btn.dataset.download.toUpperCase()} indirme şablonu hazırlandı. (Demo)`);
}));

$('new-quote').addEventListener('click', () => {
  state.convertedRows = [];
  state.offerRows = [];
  $('manual-demand').value = '';
  renderConverted();
  renderOffer();
});

renderPricePreview();
renderStoredLists();
renderConverted();
renderOffer();
updatePreviewButtonState();
