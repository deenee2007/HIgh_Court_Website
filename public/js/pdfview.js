// Shows a PDF inside the website page, page by page, on computers and phones.
import * as pdfjsLib from '/vendor/pdfjs/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';

const box = document.querySelector('[data-pdf-src]');
const status = box && box.querySelector('[data-pdf="status"]');
const controls = document.querySelector('[data-pdf-controls]');
const pagesLabel = document.querySelector('[data-pdf="pages"]');
let pdf = null;
let zoom = 1; // 1 = fit to the width of the page area
const pageEls = [];
const rendered = new Map();

function showError(msg) {
  if (status) status.innerHTML = '<i class="fas fa-triangle-exclamation fa-2x text-warning mb-3"></i><div></div>';
  if (status) status.querySelector('div').textContent = msg;
}

function currentPage() {
  const mid = window.scrollY + window.innerHeight / 3;
  let n = 1;
  pageEls.forEach((el, i) => { if (el.offsetTop <= mid) n = i + 1; });
  return n;
}
function updateLabel() {
  if (pdf && pagesLabel) pagesLabel.textContent = `Page ${currentPage()} of ${pdf.numPages}`;
}

async function renderPage(i) {
  const el = pageEls[i - 1];
  const key = `${i}@${zoom}@${box.clientWidth}`;
  if (rendered.get(i) === key) return;
  rendered.set(i, key);
  const page = await pdf.getPage(i);
  const base = page.getViewport({ scale: 1 });
  const width = Math.min(box.clientWidth, 1100) * zoom;
  const scale = width / base.width;
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  canvas.setAttribute('aria-label', `Page ${i}`);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null }).promise;
  if (rendered.get(i) !== key) return; // zoom changed meanwhile
  el.replaceChildren(canvas);
  el.style.minHeight = '';
}

function layoutPages(firstViewport) {
  const width = Math.min(box.clientWidth, 1100) * zoom;
  const h = Math.round(width * (firstViewport.height / firstViewport.width));
  pageEls.forEach((el) => {
    if (!el.firstChild) el.style.minHeight = `${h}px`;
    el.style.width = `${Math.round(width)}px`;
  });
}

let observer;
async function start() {
  try {
    pdf = await pdfjsLib.getDocument({
      url: box.getAttribute('data-pdf-src'),
      isEvalSupported: false,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      disableAutoFetch: true,
    }).promise;
  } catch (err) {
    showError('The document could not be opened here. Please use the Download button.');
    return;
  }
  const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
  status.remove();
  for (let i = 1; i <= pdf.numPages; i++) {
    const el = document.createElement('div');
    el.className = 'pdf-page';
    el.dataset.page = String(i);
    box.appendChild(el);
    pageEls.push(el);
  }
  layoutPages(first);
  observer = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) renderPage(Number(en.target.dataset.page)); });
  }, { rootMargin: '600px 0px' });
  pageEls.forEach((el) => observer.observe(el));
  if (controls) controls.hidden = false;
  updateLabel();
  window.addEventListener('scroll', updateLabel, { passive: true });

  const go = (n) => { const el = pageEls[Math.max(1, Math.min(pdf.numPages, n)) - 1]; window.scrollTo({ top: el.offsetTop - 90, behavior: 'smooth' }); };
  const rezoom = (z) => {
    const p = currentPage();
    zoom = Math.max(0.5, Math.min(3, z));
    rendered.clear();
    pageEls.forEach((el) => el.replaceChildren());
    layoutPages(first);
    pageEls.forEach((el) => { observer.unobserve(el); observer.observe(el); });
    go(p);
  };
  document.querySelector('[data-pdf="prev"]').addEventListener('click', () => go(currentPage() - 1));
  document.querySelector('[data-pdf="next"]').addEventListener('click', () => go(currentPage() + 1));
  document.querySelector('[data-pdf="zoomin"]').addEventListener('click', () => rezoom(zoom + 0.25));
  document.querySelector('[data-pdf="zoomout"]').addEventListener('click', () => rezoom(zoom - 0.25));
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => rezoom(zoom), 300); });
}

if (box) start();
