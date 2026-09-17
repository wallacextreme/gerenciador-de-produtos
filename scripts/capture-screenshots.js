import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const OUTPUT_DIR = path.resolve('docs/screenshots');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const PAGES = [
  { name: '01_dashboard.png', hash: '#/dashboard', title: 'Dashboard' },
  { name: '02_produtos.png', hash: '#/produtos', title: 'Produtos' },
  { name: '03_estoque.png', hash: '#/estoque', title: 'Estoque' },
  { name: '04_vendas_pdv.png', hash: '#/vendas', title: 'Vendas PDV' },
  { name: '05_compras.png', hash: '#/compras', title: 'Ordens de Compra' },
  { name: '06_cotacoes.png', hash: '#/cotacoes', title: 'Cotações' },
  { name: '07_relatorios.png', hash: '#/relatorios', title: 'Relatórios' },
  { name: '08_configuracoes.png', hash: '#/configuracoes', title: 'Configurações' }
];

async function capture() {
  console.log(`Iniciando captura com: ${CHROME_PATH}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1366,860'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 860, deviceScaleFactor: 1.5 });

  // 1. Carrega a aplicação inicial e aguarda carregar banco e seed demo
  console.log('Acessando http://localhost:3000/#/dashboard...');
  await page.goto('http://localhost:3000/#/dashboard', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  for (const item of PAGES) {
    const targetUrl = `http://localhost:3000/${item.hash}`;
    console.log(`Navegando para ${item.title} (${targetUrl})...`);
    await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1200));

    const outputPath = path.join(OUTPUT_DIR, item.name);
    await page.screenshot({ path: outputPath, fullPage: false });
    console.log(`✓ Salvo: ${item.name}`);
  }

  await browser.close();
  console.log('Todas as capturas foram concluídas com sucesso!');
}

capture().catch(err => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
