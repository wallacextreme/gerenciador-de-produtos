-- ==============================================================================
-- GestãoPro — Supabase Storage Migration (PHASE 14.1)
-- Criação do Bucket Privado 'product-images' e Políticas Row Level Security (RLS)
-- ==============================================================================
-- NOTA DE SEGURANÇA:
-- 1. Este script é estritamente local nesta fase e NÃO deve ser executado
--    automaticamente contra o Supabase Cloud sem autorização prévia.
-- 2. O bucket é 100% privado (public = false). Nenhum acesso anônimo é permitido.
-- 3. A autenticação baseia-se em tokens JWT do Firebase Auth com claims
--    mapeadas para 'role' = 'authenticated', 'appRole' e 'tenantId'.
-- ==============================================================================

-- 1. Criar o bucket privado 'product-images' se não existir
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-images',
    'product-images',
    false,
    10485760, -- 10MB máximo por foto
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

-- 2. RLS já vem habilitado por padrão em storage.objects gerenciado pelo Supabase Storage
-- (Comando ALTER TABLE storage.objects suprimido pois a tabela pertence à role do sistema supabase_storage_admin)

-- 3. Remover policies legadas com os mesmos nomes caso existam
DROP POLICY IF EXISTS "product_images_select_tenant_policy" ON storage.objects;
DROP POLICY IF EXISTS "product_images_insert_tenant_policy" ON storage.objects;
DROP POLICY IF EXISTS "product_images_update_tenant_policy" ON storage.objects;
DROP POLICY IF EXISTS "product_images_delete_tenant_policy" ON storage.objects;

-- ------------------------------------------------------------------------------
-- POLÍTICA 1: LEITURA (SELECT / DOWNLOAD)
-- Permite leitura de imagens do próprio tenant para qualquer membro autenticado.
-- Caminho canônico: tenants/{tenantId}/products/{productId}/{photoId}.{ext}
-- ------------------------------------------------------------------------------
CREATE POLICY "product_images_select_tenant_policy"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'product-images'
    AND (auth.jwt() ->> 'role') = 'authenticated'
    AND (auth.jwt() ->> 'tenantId') IS NOT NULL
    AND split_part(name, '/', 1) = 'tenants'
    AND split_part(name, '/', 2) = (auth.jwt() ->> 'tenantId')
    AND split_part(name, '/', 3) = 'products'
    AND split_part(name, '/', 4) <> ''
    AND split_part(name, '/', 5) <> ''
    AND split_part(name, '/', 6) = ''
);

-- ------------------------------------------------------------------------------
-- POLÍTICA 2: UPLOAD (INSERT)
-- Permite envio de novas fotos no próprio tenant exclusivamente por admin/operator.
-- Exige estritamente o contrato canônico: role: 'authenticated' e appRole válido.
-- ------------------------------------------------------------------------------
CREATE POLICY "product_images_insert_tenant_policy"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'product-images'
    AND (auth.jwt() ->> 'role') = 'authenticated'
    AND (auth.jwt() ->> 'tenantId') IS NOT NULL
    AND split_part(name, '/', 1) = 'tenants'
    AND split_part(name, '/', 2) = (auth.jwt() ->> 'tenantId')
    AND split_part(name, '/', 3) = 'products'
    AND split_part(name, '/', 4) <> ''
    AND split_part(name, '/', 5) <> ''
    AND split_part(name, '/', 6) = ''
    AND (auth.jwt() ->> 'appRole') IN ('admin', 'operator')
);

-- ------------------------------------------------------------------------------
-- POLÍTICA 3: SUBSTITUIÇÃO / ATUALIZAÇÃO (UPDATE)
-- Permite substituição de fotos existentes no próprio tenant por admin/operator.
-- ------------------------------------------------------------------------------
CREATE POLICY "product_images_update_tenant_policy"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'product-images'
    AND (auth.jwt() ->> 'role') = 'authenticated'
    AND (auth.jwt() ->> 'tenantId') IS NOT NULL
    AND split_part(name, '/', 1) = 'tenants'
    AND split_part(name, '/', 2) = (auth.jwt() ->> 'tenantId')
    AND split_part(name, '/', 3) = 'products'
    AND split_part(name, '/', 4) <> ''
    AND split_part(name, '/', 5) <> ''
    AND split_part(name, '/', 6) = ''
    AND (auth.jwt() ->> 'appRole') IN ('admin', 'operator')
)
WITH CHECK (
    bucket_id = 'product-images'
    AND (auth.jwt() ->> 'role') = 'authenticated'
    AND (auth.jwt() ->> 'tenantId') IS NOT NULL
    AND split_part(name, '/', 1) = 'tenants'
    AND split_part(name, '/', 2) = (auth.jwt() ->> 'tenantId')
    AND split_part(name, '/', 3) = 'products'
    AND split_part(name, '/', 4) <> ''
    AND split_part(name, '/', 5) <> ''
    AND split_part(name, '/', 6) = ''
    AND (auth.jwt() ->> 'appRole') IN ('admin', 'operator')
);

-- ------------------------------------------------------------------------------
-- POLÍTICA 4: EXCLUSÃO (DELETE)
-- Permite exclusão de fotos do próprio tenant exclusivamente por admin/operator.
-- ------------------------------------------------------------------------------
CREATE POLICY "product_images_delete_tenant_policy"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'product-images'
    AND (auth.jwt() ->> 'role') = 'authenticated'
    AND (auth.jwt() ->> 'tenantId') IS NOT NULL
    AND split_part(name, '/', 1) = 'tenants'
    AND split_part(name, '/', 2) = (auth.jwt() ->> 'tenantId')
    AND split_part(name, '/', 3) = 'products'
    AND split_part(name, '/', 4) <> ''
    AND split_part(name, '/', 5) <> ''
    AND split_part(name, '/', 6) = ''
    AND (auth.jwt() ->> 'appRole') IN ('admin', 'operator')
);
