# Passos prontos (Supabase + Variaveis)

## 1. Rodar a migration no Supabase

1. Acesse o projeto no Supabase.
2. Abra o SQL Editor.
3. Cole e execute o conteudo de `MIGRATION_SUPABASE.sql`.
4. Confirme se as colunas existem na tabela `orders` e se o indice foi criado.

## 2. Conferir variaveis de ambiente em producao

### Backend (Render)

1. `SUPABASE_URL`
2. `SUPABASE_SERVICE_ROLE_KEY`
3. `JWT_SECRET`
4. `MP_ACCESS_TOKEN`
5. `CORS_ORIGINS`
6. `PORT` (se aplicavel)

### Frontend (Vercel)

1. Atualize o arquivo `config.js` com:
2. `SUPABASE_URL`
3. `SUPABASE_ANON_KEY`
4. `API_URL` (endpoint da API em producao)

## Observacoes rapidas

1. `SUPABASE_ANON_KEY` e `SUPABASE_URL` nunca devem usar a chave service role no frontend.
2. Se o dominio principal for `https://blackouts.site`, mantenha esse valor em `CORS_ORIGINS` e `DELIVERY_BASE_URL`.

## 3. Supabase Auth (redirect criar-senha)

1. No Supabase, abra `Authentication` > `URL Configuration`.
2. Em `Redirect URLs`, adicione: `https://blackouts.site/criar-senha`.
3. Salve.
