const menuButtons = document.querySelectorAll('.menu-btn');
const pages = {
  quote: document.getElementById('quote-page'),
  price: document.getElementById('price-page')
};

const state = {
  previewRows: [],
  priceLists: JSON.parse(localStorage.getItem('priceLists') || '[]'),
  convertedRows: [],
  offerRows: []
};

const $ = (id) => document.getElementById(id);
const normalize = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9çğıöşü\s]/gi, ' ').replace(/\s+/g, ' ').trim();
const n = (v) => Number(v) || 0;

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
  renderEditableRows($('#price-preview-table tbody'), state.previewRows, 'preview');
}

function renderStoredLists() {
  const tbody = $('#stored-lists-table tbody');
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

$('preview-price').addEventListener('click', async () => {
  const file = $('price-file').files[0];
  if (!file) return alert('Dosya seçiniz');
  state.previewRows = await parseExcelFile(file);
  renderPricePreview();
});

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
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    sel.appendChild(opt);
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
  const aw = aa.split(' '); const bw = bb.split(' ');
  const common = aw.filter((w) => bw.includes(w)).length;
  return common / Math.max(aw.length, bw.length);
}

function parseDemandText(text) {
  return text.split(/\n|,/).map((line) => {
    const qtyMatch = line.match(/(\d+[\.,]?\d*)/);
    const qty = qtyMatch ? n(qtyMatch[1].replace(',', '.')) : 1;
    const name = normalize(line.replace(/\d+[\.,]?\d*/g, ' '));
    return { raw: line.trim(), name, qty };
  }).filter((x) => x.name);
}

$('convert-demand').addEventListener('click', async () => {
  const selected = [...$('converter-price-lists').selectedOptions].map((o) => Number(o.value));
  if (!selected.length) return alert('En az 1 fiyat listesi seçin');
  let text = '';
  if ($('manual-entry-check').checked) text += $('manual-demand').value + '\n';
  const excelFile = $('excel-input').files[0];
  if (excelFile) {
    const parsed = await parseExcelFile(excelFile);
    text += parsed.map((r) => `${r.name} ${r.price || ''}`).join('\n');
  }
  if (!text.trim()) return alert('Dönüştürücü için metin veya dosya ekleyin');

  const demands = parseDemandText(text);
  const pools = state.priceLists.filter((l) => selected.includes(l.id));
  const out = [];
  demands.forEach((d) => {
    let best = null;
    pools.forEach((list) => list.items.forEach((item) => {
      const s = Math.max(similarity(d.name, item.name), similarity(d.name, item.code));
      if (!best || s > best.score) best = { item, score: s, listName: list.name };
    }));
    if (best && best.score >= 0.2) out.push({ code: best.item.code, name: best.item.name, qty: d.qty, price: n(best.item.price), listName: best.listName });
  });
  state.convertedRows = out;
  renderConverted();
});

function renderConverted() {
  const tbody = $('#converted-table tbody');
  tbody.innerHTML = '';
  state.convertedRows.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" data-row="${i}" /></td>
      <td contenteditable="true" data-k="code">${r.code}</td>
      <td contenteditable="true" data-k="name">${r.name}</td>
      <td contenteditable="true" data-k="qty">${r.qty}</td>
      <td contenteditable="true" data-k="price">${n(r.price).toFixed(2)}</td>
      <td>${r.listName}</td>`;
    tr.querySelectorAll('[contenteditable=true]').forEach((cell) => {
      cell.addEventListener('input', () => { state.convertedRows[i][cell.dataset.k] = cell.textContent.trim(); });
    });
    tbody.appendChild(tr);
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
  const tbody = $('#offer-table tbody');
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
