import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getStorage, connectStorageEmulator, ref, uploadBytes } from 'firebase/storage';
import { FirebaseStorageProvider } from '../src/js/sync/FirebaseStorageProvider.js';

const PROJECT_ID = 'demo-gerenciador-produtos-staging';
const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
const AUTH_ADMIN_URL = `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

describe('PHASE 13.15 — Firebase Storage Emulator & Provider Integration Suite', () => {
  let app;
  let auth;
  let storage;
  let provider;
  let testUid;
  let testEmail;
  const testTenant = 'tenant_staging_01';
  const testPassword = 'SyntheticPassword123!';

  // Bytes de teste sintéticos (imagem WebP válida de 32 bytes)
  const syntheticBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
    0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
    0x00, 0x07, 0x10, 0x05, 0x18, 0x88, 0x88, 0x08
  ]);

  const config = {
    projectId: PROJECT_ID,
    storageBucket: `${PROJECT_ID}.appspot.com`,
    apiKey: 'fake-api-key',
    authEmulatorHost: AUTH_EMULATOR_HOST,
    storageEmulatorHost: STORAGE_EMULATOR_HOST,
    tenantId: testTenant
  };

  beforeAll(async () => {
    // 1. Criar identidade sintética no Auth Emulator
    testEmail = `operator_${Date.now()}@tenant_staging_01.com`;
    const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword, returnSecureToken: true })
    });
    const signupData = await signupRes.json();
    if (!signupData.localId) {
      throw new Error(`Falha ao criar usuário sintético no Auth Emulator: ${JSON.stringify(signupData)}`);
    }
    testUid = signupData.localId;

    // 2. Configurar custom claims oficiais canônicas (tenantId, role técnico e appRole)
    const updateRes = await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        localId: testUid,
        customAttributes: JSON.stringify({ tenantId: testTenant, role: 'authenticated', appRole: 'operator' })
      })
    });
    if (!updateRes.ok) {
      throw new Error(`Falha ao atribuir custom claims no Auth Emulator: HTTP ${updateRes.status}`);
    }

    // 3. Inicializar Firebase App e autenticar cliente
    const apps = getApps();
    app = apps.find((a) => a.name === '[DEFAULT]') || initializeApp(config);
    auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });

    const cred = await signInWithEmailAndPassword(auth, testEmail, testPassword);
    const tokenResult = await cred.user.getIdTokenResult(true);

    if (tokenResult.claims.tenantId !== testTenant || tokenResult.claims.appRole !== 'operator') {
      throw new Error('Custom claims no ID Token não correspondem ao esperado!');
    }

    // 4. Inicializar FirebaseStorageProvider
    const mockAuthService = {
      getTenantId: () => testTenant,
      getCurrentUser: () => ({ uid: testUid, email: testEmail, role: 'operator', appRole: 'operator' })
    };

    provider = new FirebaseStorageProvider(config, mockAuthService);
    await provider.initialize();
    storage = provider.storage;
  });

  afterAll(async () => {
    // Limpeza de segurança do objeto sintético criado caso o teste tenha sido interrompido
    if (provider && provider.isConfigured()) {
      try {
        const productId = 'prod_perm_01';
        const photoId = 'photo_perm_01';
        const remotePath = `tenants/${testTenant}/products/${productId}/${photoId}.webp`;
        await provider.delete(photoId, remotePath);
      } catch {}
    }
    // Garantir signOut
    if (auth && auth.currentUser) {
      try {
        await signOut(auth);
      } catch {}
    }
  });

  // =========================================================================
  // C.1 e C.2: Inicialização e Verificação de Sessão
  // =========================================================================
  it('C.1 & C.2: deve validar inicialização correta, emuladores locais e claims do token', async () => {
    expect(provider.isConfigured()).toBe(true);
    expect(provider.getTenantId()).toBe(testTenant);
    expect(provider.app).toBeDefined();

    // Confirmar que o provider compartilha o mesmo container de app autenticado
    const currentAuthUser = getAuth(provider.app).currentUser;
    expect(currentAuthUser).toBeDefined();
    expect(currentAuthUser.uid).toBe(testUid);

    const token = await currentAuthUser.getIdTokenResult();
    expect(token.claims.tenantId).toBe(testTenant);
    expect(token.claims.role).toBe('authenticated');
    expect(token.claims.appRole).toBe('operator');
    expect(token.claims.aud).toBe(PROJECT_ID);
  });

  // =========================================================================
  // C.3: Upload e Verificação de Integridade dos Bytes
  // =========================================================================
  it('C.3: deve executar upload sintético pelo provider e comprovar 100% de integridade binária', async () => {
    const syntheticBlob = new Blob([syntheticBytes], { type: 'image/webp' });
    const productId = 'prod_perm_01';
    const photoId = 'photo_perm_01';

    const result = await provider.upload(syntheticBlob, {
      tenantId: testTenant,
      productId,
      photoId,
      mimeType: 'image/webp'
    });

    expect(result).toBeDefined();
    expect(result.photoId).toBe(photoId);
    expect(result.remotePath).toBe(`tenants/${testTenant}/products/${productId}/${photoId}.webp`);
    expect(result.url).toContain(STORAGE_EMULATOR_HOST);
    expect(result.sizeBytes).toBe(syntheticBytes.length);
    expect(result.mimeType).toBe('image/webp');

    // Existência
    const exists = await provider.exists(photoId, result.remotePath);
    expect(exists).toBe(true);

    // Metadados
    const meta = await provider.getMetadata(photoId, result.remotePath);
    expect(meta).toBeDefined();
    expect(meta.sizeBytes).toBe(syntheticBytes.length);
    expect(meta.mimeType).toBe('image/webp');

    // Download pelo provedor
    const downloadedBlob = await provider.download(photoId, result.remotePath);
    expect(downloadedBlob).toBeDefined();

    const downloadedAb = await downloadedBlob.arrayBuffer();
    const downloadedBytes = new Uint8Array(downloadedAb);

    // Validação estrita byte-a-byte
    expect(downloadedBytes.length).toBe(syntheticBytes.length);
    expect(Buffer.from(downloadedBytes).equals(Buffer.from(syntheticBytes))).toBe(true);
  });

  // =========================================================================
  // C.4: Exclusão e Validação de Ausência Pós-Exclusão
  // =========================================================================
  it('C.4: deve excluir o objeto sintético e confirmar ausência via provider.exists()', async () => {
    const productId = 'prod_perm_01';
    const photoId = 'photo_perm_01';
    const remotePath = `tenants/${testTenant}/products/${productId}/${photoId}.webp`;

    const deleteSuccess = await provider.delete(photoId, remotePath);
    expect(deleteSuccess).toBe(true);

    const existsAfterDelete = await provider.exists(photoId, remotePath);
    expect(existsAfterDelete).toBe(false);

    // Tentativa de download de objeto excluído deve lançar NOT_FOUND
    await expect(provider.download(photoId, remotePath)).rejects.toThrow();
  });

  // =========================================================================
  // ETAPA D: Testes Negativos de Segurança e Regras
  // =========================================================================
  describe('ETAPA D: Testes Negativos e Barreiras de Segurança', () => {
    it('D.1: Provedor e storage.rules devem rejeitar upload em outro tenant (cross-tenant no emulador)', async () => {
      const syntheticBlob = new Blob([syntheticBytes], { type: 'image/webp' });
      await expect(
        provider.upload(syntheticBlob, {
          tenantId: 'tenant_other_99',
          productId: 'prod_illegal',
          photoId: 'photo_illegal',
          mimeType: 'image/webp'
        })
      ).rejects.toThrow(/storage\/unauthorized/i);
    });

    it('D.1b: Provedor deve rejeitar antecipadamente operação com caminho remoto cross-tenant (validação no cliente)', async () => {
      await expect(
        provider.delete('photo_illegal', 'tenants/tenant_other_99/products/p1/illegal.webp')
      ).rejects.toThrow(/Acesso cross-tenant negado/);
    });

    it('D.2: Provedor deve rejeitar upload com MIME type proibido (application/pdf)', async () => {
      const pdfBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' });
      await expect(
        provider.upload(pdfBlob, {
          tenantId: testTenant,
          productId: 'prod_pdf',
          photoId: 'photo_pdf',
          mimeType: 'application/pdf'
        })
      ).rejects.toThrow(/Tipo de arquivo não permitido/);
    });

    it('D.3: Provedor deve rejeitar upload com tamanho excedendo o limite de 10MB', async () => {
      const oversizeBlob = {
        size: 11 * 1024 * 1024,
        type: 'image/webp',
        length: 11 * 1024 * 1024
      };
      await expect(
        provider.upload(oversizeBlob, {
          tenantId: testTenant,
          productId: 'prod_huge',
          photoId: 'photo_huge',
          mimeType: 'image/webp'
        })
      ).rejects.toThrow(/Arquivo excede o limite máximo/);
    });

    it('D.4: storage.rules deve rejeitar escrita direta em outro tenant (cross-tenant no emulador)', async () => {
      // Teste direto na camada de regras do emulador contornando validação local do provedor
      const illegalRemoteRef = ref(storage, 'tenants/tenant_other_99/products/prod_hack/photo_hack.webp');
      await expect(
        uploadBytes(illegalRemoteRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });

    it('D.5: storage.rules deve rejeitar escrita por usuário sem papel permitido (role "viewer")', async () => {
      // Criar usuário com papel viewer no mesmo tenant
      const viewerEmail = `viewer_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: viewerEmail, password: testPassword, returnSecureToken: true })
      });
      const viewerUid = (await signupRes.json()).localId;

      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: viewerUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'viewer' })
        })
      });

      // Autenticar viewer
      const viewerApp = initializeApp(config, `viewer-app-${Date.now()}`);
      const viewerAuth = getAuth(viewerApp);
      connectAuthEmulator(viewerAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(viewerAuth, viewerEmail, testPassword);

      const viewerStorage = getStorage(viewerApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(viewerStorage, '127.0.0.1', 9199);

      const viewerTargetRef = ref(viewerStorage, `tenants/${testTenant}/products/prod_viewer/photo_viewer.webp`);
      await expect(
        uploadBytes(viewerTargetRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });

    it('D.6: storage.rules deve rejeitar upload não autenticado após signOut', async () => {
      await signOut(auth);
      const targetRef = ref(storage, `tenants/${testTenant}/products/prod_unauth/photo_unauth.webp`);
      await expect(
        uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });

    it('D.7: storage.rules deve autorizar upload com novo token canônico (role: "authenticated", appRole: "operator")', async () => {
      const canonicalOpEmail = `canonical_op_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: canonicalOpEmail, password: testPassword, returnSecureToken: true })
      });
      const canonicalUid = (await signupRes.json()).localId;

      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: canonicalUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'authenticated', appRole: 'operator' })
        })
      });

      const canonicalApp = initializeApp(config, `canonical-op-app-${Date.now()}`);
      const canonicalAuth = getAuth(canonicalApp);
      connectAuthEmulator(canonicalAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(canonicalAuth, canonicalOpEmail, testPassword);

      const canonicalStorage = getStorage(canonicalApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(canonicalStorage, '127.0.0.1', 9199);

      const targetRef = ref(canonicalStorage, `tenants/${testTenant}/products/prod_canonical_op/photo_op.webp`);
      const uploadRes = await uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' });
      expect(uploadRes).toBeDefined();
      expect(uploadRes.metadata.name).toBe('photo_op.webp');
    });

    it('D.8: storage.rules deve rejeitar upload com novo token (role: "authenticated", appRole: "viewer")', async () => {
      const canonicalViewerEmail = `canonical_viewer_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: canonicalViewerEmail, password: testPassword, returnSecureToken: true })
      });
      const canonicalViewerUid = (await signupRes.json()).localId;

      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: canonicalViewerUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'authenticated', appRole: 'viewer' })
        })
      });

      const canonicalViewerApp = initializeApp(config, `canonical-viewer-app-${Date.now()}`);
      const canonicalViewerAuth = getAuth(canonicalViewerApp);
      connectAuthEmulator(canonicalViewerAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(canonicalViewerAuth, canonicalViewerEmail, testPassword);

      const canonicalViewerStorage = getStorage(canonicalViewerApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(canonicalViewerStorage, '127.0.0.1', 9199);

      const targetRef = ref(canonicalViewerStorage, `tenants/${testTenant}/products/prod_canonical_viewer/photo_viewer.webp`);
      await expect(
        uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });

    it('D.9: storage.rules deve rejeitar escrita com token novo incompleto (role: "authenticated" sem appRole)', async () => {
      const incompleteEmail = `incomplete_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: incompleteEmail, password: testPassword, returnSecureToken: true })
      });
      const incompleteUid = (await signupRes.json()).localId;

      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: incompleteUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'authenticated' })
        })
      });

      const incompleteApp = initializeApp(config, `incomplete-app-${Date.now()}`);
      const incompleteAuth = getAuth(incompleteApp);
      connectAuthEmulator(incompleteAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(incompleteAuth, incompleteEmail, testPassword);

      const incompleteStorage = getStorage(incompleteApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(incompleteStorage, '127.0.0.1', 9199);

      const targetRef = ref(incompleteStorage, `tenants/${testTenant}/products/prod_incomplete/photo_incomplete.webp`);
      await expect(
        uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });

    it('D.10: storage.rules deve autorizar upload com token canônico admin (role: "authenticated", appRole: "admin")', async () => {
      const canonicalAdminEmail = `canonical_admin_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: canonicalAdminEmail, password: testPassword, returnSecureToken: true })
      });
      const canonicalAdminUid = (await signupRes.json()).localId;

      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: canonicalAdminUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'authenticated', appRole: 'admin' })
        })
      });

      const canonicalAdminApp = initializeApp(config, `canonical-admin-app-${Date.now()}`);
      const canonicalAdminAuth = getAuth(canonicalAdminApp);
      connectAuthEmulator(canonicalAdminAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(canonicalAdminAuth, canonicalAdminEmail, testPassword);

      const canonicalAdminStorage = getStorage(canonicalAdminApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(canonicalAdminStorage, '127.0.0.1', 9199);

      const targetRef = ref(canonicalAdminStorage, `tenants/${testTenant}/products/prod_canonical_admin/photo_admin.webp`);
      const uploadRes = await uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' });
      expect(uploadRes).toBeDefined();
      expect(uploadRes.metadata.name).toBe('photo_admin.webp');
    });

    it('D.11: storage.rules deve rejeitar escrita com token legado admin sem appRole (cutover canônico)', async () => {
      const legacyAdminEmail = `legacy_admin_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: legacyAdminEmail, password: testPassword, returnSecureToken: true })
      });
      const legacyAdminUid = (await signupRes.json()).localId;

      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: legacyAdminUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'admin' })
        })
      });

      const legacyAdminApp = initializeApp(config, `legacy-admin-app-${Date.now()}`);
      const legacyAdminAuth = getAuth(legacyAdminApp);
      connectAuthEmulator(legacyAdminAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(legacyAdminAuth, legacyAdminEmail, testPassword);

      const legacyAdminStorage = getStorage(legacyAdminApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(legacyAdminStorage, '127.0.0.1', 9199);

      const targetRef = ref(legacyAdminStorage, `tenants/${testTenant}/products/prod_legacy_admin/photo_leg_adm.webp`);
      await expect(
        uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });

    it('D.11b: storage.rules deve autorizar upload com token canônico (role: "authenticated", appRole: "admin")', async () => {
      const canonicalAdminEmail = `canonical_admin_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: canonicalAdminEmail, password: testPassword, returnSecureToken: true })
      });
      const canonicalAdminUid = (await signupRes.json()).localId;

      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: canonicalAdminUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'authenticated', appRole: 'admin' })
        })
      });

      const canonicalAdminApp = initializeApp(config, `canonical-admin-app-${Date.now()}`);
      const canonicalAdminAuth = getAuth(canonicalAdminApp);
      connectAuthEmulator(canonicalAdminAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(canonicalAdminAuth, canonicalAdminEmail, testPassword);

      const canonicalAdminStorage = getStorage(canonicalAdminApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(canonicalAdminStorage, '127.0.0.1', 9199);

      const targetRef = ref(canonicalAdminStorage, `tenants/${testTenant}/products/prod_canonical_admin/photo_can_adm.webp`);
      const uploadRes = await uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' });
      expect(uploadRes).toBeDefined();
      expect(uploadRes.metadata.name).toBe('photo_can_adm.webp');
    });

    it('D.12: storage.rules deve rejeitar escrita com claims conflitantes/inválidas (role: "admin", appRole: "superadmin")', async () => {
      const superadminEmail = `superadmin_fail_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: superadminEmail, password: testPassword, returnSecureToken: true })
      });
      const superadminUid = (await signupRes.json()).localId;

      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: superadminUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'admin', appRole: 'superadmin' })
        })
      });

      const superadminApp = initializeApp(config, `superadmin-app-${Date.now()}`);
      const superadminAuth = getAuth(superadminApp);
      connectAuthEmulator(superadminAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(superadminAuth, superadminEmail, testPassword);

      const superadminStorage = getStorage(superadminApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(superadminStorage, '127.0.0.1', 9199);

      const targetRef = ref(superadminStorage, `tenants/${testTenant}/products/prod_superadmin/photo_superadmin.webp`);
      await expect(
        uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });

    it('D.13: storage.rules deve rejeitar escrita com claims conflitantes (role: "admin", appRole: "viewer")', async () => {
      const conflictViewerEmail = `conflict_viewer_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: conflictViewerEmail, password: testPassword, returnSecureToken: true })
      });
      const conflictViewerUid = (await signupRes.json()).localId;

      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: conflictViewerUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'admin', appRole: 'viewer' })
        })
      });

      const conflictViewerApp = initializeApp(config, `conflict-viewer-app-${Date.now()}`);
      const conflictViewerAuth = getAuth(conflictViewerApp);
      connectAuthEmulator(conflictViewerAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(conflictViewerAuth, conflictViewerEmail, testPassword);

      const conflictViewerStorage = getStorage(conflictViewerApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(conflictViewerStorage, '127.0.0.1', 9199);

      const targetRef = ref(conflictViewerStorage, `tenants/${testTenant}/products/prod_conflict_viewer/photo_cv.webp`);
      await expect(
        uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });

    it('D.14: storage.rules deve rejeitar escrita quando appRole estiver presente com valor null (fail-closed)', async () => {
      const nullAppRoleEmail = `null_approle_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: nullAppRoleEmail, password: testPassword, returnSecureToken: true })
      });
      const nullAppRoleUid = (await signupRes.json()).localId;

      // Token com 'role': 'admin' mas contendo a chave 'appRole': null
      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: nullAppRoleUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'admin', appRole: null })
        })
      });

      const nullAppRoleApp = initializeApp(config, `null-approle-app-${Date.now()}`);
      const nullAppRoleAuth = getAuth(nullAppRoleApp);
      connectAuthEmulator(nullAppRoleAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(nullAppRoleAuth, nullAppRoleEmail, testPassword);

      const nullAppRoleStorage = getStorage(nullAppRoleApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(nullAppRoleStorage, '127.0.0.1', 9199);

      // Em storage.rules, 'appRole' in request.auth.token é verdadeiro, desativando o fallback legado
      const targetRef = ref(nullAppRoleStorage, `tenants/${testTenant}/products/prod_null_approle/photo_null.webp`);
      await expect(
        uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });

    it('D.15: storage.rules deve rejeitar escrita quando appRole estiver presente com string vazia "" (fail-closed)', async () => {
      const emptyAppRoleEmail = `empty_approle_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emptyAppRoleEmail, password: testPassword, returnSecureToken: true })
      });
      const emptyAppRoleUid = (await signupRes.json()).localId;

      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: emptyAppRoleUid,
          customAttributes: JSON.stringify({ tenantId: testTenant, role: 'admin', appRole: '' })
        })
      });

      const emptyAppRoleApp = initializeApp(config, `empty-approle-app-${Date.now()}`);
      const emptyAppRoleAuth = getAuth(emptyAppRoleApp);
      connectAuthEmulator(emptyAppRoleAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(emptyAppRoleAuth, emptyAppRoleEmail, testPassword);

      const emptyAppRoleStorage = getStorage(emptyAppRoleApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(emptyAppRoleStorage, '127.0.0.1', 9199);

      const targetRef = ref(emptyAppRoleStorage, `tenants/${testTenant}/products/prod_empty_approle/photo_empty.webp`);
      await expect(
        uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });

    it('D.16: storage.rules deve rejeitar escrita quando token não contiver tenantId (mesmo com appRole: "admin")', async () => {
      const noTenantEmail = `notenant_${Date.now()}@tenant_staging_01.com`;
      const signupRes = await fetch(`${AUTH_ADMIN_URL}/accounts:signUp?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: noTenantEmail, password: testPassword, returnSecureToken: true })
      });
      const noTenantUid = (await signupRes.json()).localId;

      // Token sem tenantId
      await fetch(`${AUTH_ADMIN_URL}/projects/${PROJECT_ID}/accounts:update?key=fake-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          localId: noTenantUid,
          customAttributes: JSON.stringify({ role: 'authenticated', appRole: 'admin' })
        })
      });

      const noTenantApp = initializeApp(config, `notenant-app-${Date.now()}`);
      const noTenantAuth = getAuth(noTenantApp);
      connectAuthEmulator(noTenantAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      await signInWithEmailAndPassword(noTenantAuth, noTenantEmail, testPassword);

      const noTenantStorage = getStorage(noTenantApp, `gs://${config.storageBucket}`);
      connectStorageEmulator(noTenantStorage, '127.0.0.1', 9199);

      const targetRef = ref(noTenantStorage, `tenants/${testTenant}/products/prod_notenant/photo_notenant.webp`);
      await expect(
        uploadBytes(targetRef, syntheticBytes, { contentType: 'image/webp' })
      ).rejects.toThrow(/unauthorized/i);
    });
  });
});
