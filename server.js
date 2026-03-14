require("dotenv").config()

const express = require("express")
const cors = require("cors")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const { createClient } = require("@supabase/supabase-js")

const app = express()

const IS_PROD = String(process.env.NODE_ENV || "").toLowerCase() === "production"

const DEFAULT_ORIGINS = [
  "https://blackouts.site",
  "https://www.blackouts.site"
]

const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173"
]

const BASE_ORIGINS = IS_PROD
  ? DEFAULT_ORIGINS
  : DEFAULT_ORIGINS.concat(DEV_ORIGINS)

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || BASE_ORIGINS.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true)
    }

    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true)
    }

    return callback(null, false)
  }
}))
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const PORT = process.env.PORT || 3000
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN
const DELIVERY_BASE_URL = String(process.env.DELIVERY_BASE_URL || "https://blackouts.site")
  .trim()
  .replace(/\/+$/, "")

const rateLimitLogin = criarRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Muitas tentativas de login. Aguarde alguns minutos."
})

const rateLimitPedidos = criarRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Muitas tentativas de pedido. Aguarde alguns minutos."
})

const rateLimitPedidoStatus = criarRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: "Muitas consultas de pedido. Aguarde alguns minutos."
})

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, papel: usuario.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  )
}

function obterRoleUsuario(user) {
  return String(
    user?.user_metadata?.role ||
    user?.app_metadata?.role ||
    ""
  ).toLowerCase()
}

async function obterRolePerfil(userId) {
  if (!userId) {
    return null
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle()

    if (error) {
      return null
    }

    return data?.role ? String(data.role).toLowerCase() : null
  } catch (error) {
    return null
  }
}
async function autenticarSupabase(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).json({ erro: "Token não enviado" })
  }

  const token = authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({ erro: "Token inválido" })
  }

  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data?.user) {
    return res.status(401).json({ erro: "Token expirado ou inválido" })
  }

  const rolePerfil = await obterRolePerfil(data.user.id)

  req.usuario = {
    id: data.user.id,
    email: data.user.email,
    papel: rolePerfil || obterRoleUsuario(data.user)
  }
  req.usuarioRaw = data.user
  next()
}

function somenteAdminSupabase(req, res, next) {
  const papel = String(req.usuario?.papel || "").toLowerCase()

  if (papel !== "administrador" && papel !== "admin") {
    return res.status(403).json({ erro: "Acesso permitido apenas para administrador" })
  }

  next()
}

async function somenteClienteSupabase(req, res, next) {
  const papel = String(req.usuario?.papel || "").toLowerCase()

  if (papel === "admin" || papel === "administrador" || papel === "customer") {
    return next()
  }

  const email = normalizarEmail(req.usuario?.email || "")

  if (!email) {
    return res.status(403).json({ erro: "Acesso permitido apenas para clientes" })
  }

  const { data, error } = await supabase
    .from("orders")
    .select("id")
    .ilike("customer_email", email)
    .eq("payment_status", "paid")
    .limit(1)

  if (error) {
    return res.status(500).json({ erro: "Erro ao validar cliente" })
  }

  if (!data || !data.length) {
    return res.status(403).json({ erro: "Acesso permitido apenas para clientes" })
  }

  next()
}

function obterIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    "desconhecido"
  )
}

function normalizarStatusEstoque(status) {
  const valor = String(status || "").toLowerCase()

  if (["available", "disponivel", "ativo", "livre"].includes(valor)) return "available"
  if (["sold", "vendida", "vendido", "entregue", "used", "usado"].includes(valor)) return "sold"

  return valor
}

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase()
}

const CATEGORIAS_VALIDAS = [
  "games",
  "assinaturas",
  "steam keys",
  "ia",
  "outros"
]

const STATUS_ESTOQUE_DISPONIVEL = ["available", "disponivel", "ativo", "livre"]

function normalizarBoolean(valor, padrao = false) {
  if (valor === undefined || valor === null) return padrao
  if (typeof valor === "boolean") return valor

  const texto = String(valor).trim().toLowerCase()
  if (["1", "true", "sim", "yes", "on"].includes(texto)) return true
  if (["0", "false", "nao", "no", "off"].includes(texto)) return false
  return padrao
}

function normalizarCategoria(categoria) {
  const valor = String(categoria || "").trim().toLowerCase()

  if (!valor) return "outros"
  if (["steam_keys", "steam-keys", "steamkey", "steam key"].includes(valor)) return "steam keys"
  if (["ia", "ias", "inteligencia artificial"].includes(valor)) return "ia"
  if (["assinatura", "assinaturas"].includes(valor)) return "assinaturas"
  if (["game", "games"].includes(valor)) return "games"
  if (["outro", "outros"].includes(valor)) return "outros"

  return CATEGORIAS_VALIDAS.includes(valor) ? valor : "outros"
}

function gerarSlug(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
}

function normalizarPrecoPromocional(preco, promo) {
  const precoBase = Number(preco || 0)
  const promoNumber = promo === null || promo === undefined ? null : Number(promo)

  if (!promoNumber || Number.isNaN(promoNumber)) return null
  if (promoNumber <= 0) return null
  if (precoBase > 0 && promoNumber >= precoBase) return null

  return promoNumber
}

function calcularPrecoFinal(preco, precoPromocional) {
  const precoBase = Number(preco || 0)
  const promoValido = normalizarPrecoPromocional(precoBase, precoPromocional)
  return promoValido ?? precoBase
}

function criarRateLimiter({ windowMs, max, message }) {
  const hits = new Map()
  const limpezaIntervalo = windowMs * 4
  let ultimaLimpeza = Date.now()

  return (req, res, next) => {
    const key = obterIp(req)
    const agora = Date.now()

    if (agora - ultimaLimpeza > limpezaIntervalo) {
      for (const [chave, registro] of hits.entries()) {
        if (agora - registro.inicio > windowMs) {
          hits.delete(chave)
        }
      }
      ultimaLimpeza = agora
    }

    const registro = hits.get(key)

    if (!registro || agora - registro.inicio > windowMs) {
      hits.set(key, { inicio: agora, contagem: 1 })
      return next()
    }

    registro.contagem += 1

    if (registro.contagem > max) {
      return res.status(429).json({ erro: message || "Muitas requisições. Tente novamente mais tarde." })
    }

    next()
  }
}

async function carregarProdutosComEstoque({
  orderBy,
  orderDirection = "asc",
  apenasAtivos = false,
  categoria,
  apenasDestaque = false,
  limit
} = {}) {
  let query = supabase.from("products").select("*")

  if (apenasAtivos) {
    query = query.eq("ativo", true)
  }

  if (categoria) {
    query = query.eq("categoria", categoria)
  }

  if (apenasDestaque) {
    query = query.eq("destaque", true)
  }

  if (orderBy) {
    query = query.order(orderBy, { ascending: orderDirection === "asc" })
  }

  if (limit) {
    query = query.limit(limit)
  }

  const { data: produtos, error } = await query

  if (error) {
    return { error }
  }

  const { data: estoque, error: erroEstoque } = await supabase
    .from("inventory_items")
    .select("product_id, status")

  if (erroEstoque) {
    return { error: erroEstoque }
  }

  const estoquePorProduto = {}

  for (const item of estoque || []) {
    const statusNormalizado = normalizarStatusEstoque(item.status)

    if (statusNormalizado !== "available") {
      continue
    }

    const productId = item.product_id

    if (productId === null || productId === undefined) {
      continue
    }

    estoquePorProduto[productId] = (estoquePorProduto[productId] || 0) + 1
  }

  const produtosComEstoque = (produtos || []).map((produto) => {
    const nome = produto.nome ?? produto.name ?? produto.title ?? ""
    const descricao = produto.descricao ?? produto.description ?? ""
    const preco = Number(produto.preco ?? produto.price ?? 0)
    const precoPromocional = normalizarPrecoPromocional(preco, produto.preco_promocional ?? produto.precoPromocional)
    const bannerUrl = produto.banner_url ?? produto.bannerUrl ?? produto.image_url ?? null
    const categoriaProduto = normalizarCategoria(produto.categoria ?? produto.type ?? "outros")
    const quantidade =
      produto.quantidade === null || produto.quantidade === undefined
        ? null
        : Number(produto.quantidade)
    const inventoryDisponivel = estoquePorProduto[produto.id] || 0

    let estoqueDisponivel = inventoryDisponivel
    if (quantidade !== null && !Number.isNaN(quantidade)) {
      estoqueDisponivel = Math.min(quantidade, inventoryDisponivel)
    }

    return {
      id: produto.id,
      nome,
      slug: produto.slug || (nome ? gerarSlug(nome) : null),
      categoria: categoriaProduto,
      descricao,
      banner_url: bannerUrl,
      preco,
      preco_promocional: precoPromocional,
      quantidade: quantidade !== null && !Number.isNaN(quantidade) ? quantidade : null,
      ativo: produto.ativo !== undefined ? Boolean(produto.ativo) : true,
      destaque: produto.destaque !== undefined ? Boolean(produto.destaque) : false,
      total_vendas: Number(produto.total_vendas ?? 0),
      created_at: produto.created_at || null,
      updated_at: produto.updated_at || null,
      inventory_available: inventoryDisponivel,
      stock_available: estoqueDisponivel,
      preco_final: calcularPrecoFinal(preco, precoPromocional)
    }
  })

  return { data: produtosComEstoque }
}

async function verificarEstoqueDisponivel(productId) {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, status")
    .eq("product_id", productId)
    .in("status", STATUS_ESTOQUE_DISPONIVEL)
    .limit(1)

  if (error) {
    return { error }
  }

  return { available: Array.isArray(data) && data.length > 0 }
}

async function reservarItemEstoque(productId) {
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const { data: itens, error: erroBusca } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("product_id", productId)
      .in("status", STATUS_ESTOQUE_DISPONIVEL)
      .limit(20)

    if (erroBusca) {
      return { error: erroBusca }
    }

    if (!Array.isArray(itens) || !itens.length) {
      return { data: null }
    }

    for (const item of itens) {
      const { data: atualizados, error: erroUpdate } = await supabase
        .from("inventory_items")
        .update({ status: "sold" })
        .eq("id", item.id)
        .in("status", STATUS_ESTOQUE_DISPONIVEL)
        .select()

      if (erroUpdate) {
        continue
      }

      if (Array.isArray(atualizados) && atualizados.length) {
        return { data: atualizados[0] }
      }
    }
  }

  return { data: null }
}

async function reservarItemEstoqueAtomico(productId) {
  const { data, error } = await supabase.rpc("reserve_inventory_item", {
    p_product_id: String(productId)
  })

  if (error) {
    return { error }
  }

  if (!data) {
    return { data: null }
  }

  if (Array.isArray(data)) {
    return { data: data[0] || null }
  }

  return { data }
}

async function registrarAlertaSemEstoque({ orderId, paymentId, productId, email }) {

  try {
    const { error } = await supabase
      .from("stock_alerts")
      .insert([{
        order_id: String(orderId),
        payment_id: String(paymentId),
        product_id: String(productId),
        customer_email: email || null,
        created_at: new Date().toISOString()
      }])

    if (error) {
      console.log("Falha ao registrar alerta de estoque:", error.message)
    }
  } catch (error) {
    console.log("Erro ao registrar alerta de estoque:", error)
  }
}

async function registrarVendaProduto(productId) {
  if (!productId) {
    return { data: null }
  }

  const { data, error } = await supabase.rpc("register_product_sale", {
    p_product_id: String(productId)
  })

  if (!error) {
    return { data }
  }

  const { data: produto, error: erroProduto } = await supabase
    .from("products")
    .select("total_vendas, quantidade")
    .eq("id", productId)
    .single()

  if (erroProduto) {
    return { error: erroProduto }
  }

  const totalVendas = Number(produto?.total_vendas || 0) + 1
  let quantidade = produto?.quantidade
  const atualizacao = { total_vendas: totalVendas }

  if (quantidade !== null && quantidade !== undefined) {
    const quantidadeNumero = Number(quantidade || 0)
    atualizacao.quantidade = Math.max(quantidadeNumero - 1, 0)
  }

  const { data: atualizado, error: erroAtualiza } = await supabase
    .from("products")
    .update(atualizacao)
    .eq("id", productId)
    .select()

  if (erroAtualiza) {
    return { error: erroAtualiza }
  }

  return { data: atualizado }
}

async function convidarClienteSeNecessario({ email, nome }) {
  const emailNormalizado = normalizarEmail(email)

  if (!emailNormalizado) {
    return
  }

  if (!supabase?.auth?.admin?.inviteUserByEmail) {
    console.log("Supabase admin indisponivel para convite.")
    return
  }

  try {
    const { data: usuarioData, error: erroUsuario } = await supabase.auth.admin.getUserByEmail(emailNormalizado)

    if (!erroUsuario && usuarioData?.user) {
      const roleAtual = obterRoleUsuario(usuarioData.user)

      if (roleAtual !== "customer") {
        const metadataAtual = usuarioData.user.user_metadata || {}
        await supabase.auth.admin.updateUserById(usuarioData.user.id, {
          user_metadata: {
            ...metadataAtual,
            role: "customer",
            name: metadataAtual.name || nome || null
          }
        })
      }

      return
    }

    const { error: erroConvite } = await supabase.auth.admin.inviteUserByEmail(emailNormalizado, {
      redirectTo: `${DELIVERY_BASE_URL}/criar-senha`,
      data: {
        role: "customer",
        name: nome || null
      }
    })

    if (erroConvite) {
      console.log("Erro ao convidar cliente:", erroConvite.message)
    }
  } catch (error) {
    console.log("Erro ao convidar cliente:", error)
  }
}

app.get("/", (req, res) => {
  res.json({ status: "API Blackouts online" })
})

app.get("/teste-login", (req, res) => {
  res.json({ rota: "/login ativa", metodo: "POST" })
})

app.get("/produtos", async (req, res) => {
  try {
    const categoria = req.query.categoria ? normalizarCategoria(req.query.categoria) : null
    const apenasDestaque = normalizarBoolean(req.query.destaque, false)
    const ordem = String(req.query.ordem || req.query.order || "").trim().toLowerCase()
    const limite = req.query.limite || req.query.limit
    const limiteNumero = limite ? Number(limite) : null

    let orderBy = "created_at"
    let orderDirection = "desc"

    if (ordem === "mais_vendidos" || ordem === "mais-vendidos" || ordem === "total_vendas") {
      orderBy = "total_vendas"
      orderDirection = "desc"
    } else if (ordem === "nome" || ordem === "name") {
      orderBy = "nome"
      orderDirection = "asc"
    }

    const { data, error } = await carregarProdutosComEstoque({
      orderBy,
      orderDirection,
      apenasAtivos: true,
      categoria,
      apenasDestaque,
      limit: Number.isFinite(limiteNumero) ? limiteNumero : undefined
    })

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data || [])
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar produtos" })
  }
})

app.get("/produtos/mais-vendidos", async (req, res) => {
  try {
    const limite = req.query.limite || req.query.limit
    const limiteNumero = limite ? Number(limite) : 6

    const { data, error } = await carregarProdutosComEstoque({
      orderBy: "total_vendas",
      orderDirection: "desc",
      apenasAtivos: true,
      limit: Number.isFinite(limiteNumero) ? limiteNumero : 6
    })

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data || [])
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar mais vendidos" })
  }
})

app.post("/login", rateLimitLogin, (req, res) => {
  res.status(410).json({ erro: "Login legado desativado. Use o fluxo de autenticação do Supabase." })
})

app.get("/me", autenticarSupabase, (req, res) => {
  res.json({ usuario: req.usuario })
})

app.get("/admin/dashboard", autenticarSupabase, somenteAdminSupabase, async (req, res) => {
  try {
    const { data: produtos, error: erroProdutos } = await supabase
      .from("products")
      .select("*")

    if (erroProdutos) return res.status(500).json({ erro: erroProdutos.message })

    const { data: pedidos, error: erroPedidos } = await supabase
      .from("orders")
      .select("*")

    if (erroPedidos) return res.status(500).json({ erro: erroPedidos.message })

    const { data: estoque, error: erroEstoque } = await supabase
      .from("inventory_items")
      .select("*")

    if (erroEstoque) return res.status(500).json({ erro: erroEstoque.message })

    const hoje = new Date()
    const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())

    const pedidosLista = pedidos || []
    const produtosLista = produtos || []
    const estoqueLista = estoque || []

    const pedidosHoje = pedidosLista.filter((pedido) => {
      if (!pedido.created_at) return false
      return new Date(pedido.created_at) >= inicioHoje
    })

    const faturamentoTotal = pedidosLista.reduce((total, pedido) => total + Number(pedido.total || 0), 0)
    const faturamentoHoje = pedidosHoje.reduce((total, pedido) => total + Number(pedido.total || 0), 0)

    const estoqueDisponivel = estoqueLista.filter((item) => normalizarStatusEstoque(item.status) === "available").length

    res.json({
      pedidos_totais: pedidosLista.length,
      faturamento_total: faturamentoTotal,
      pedidos_hoje: pedidosHoje.length,
      faturamento_hoje: faturamentoHoje,
      produtos_totais: produtosLista.length,
      estoque_disponivel: estoqueDisponivel,
      estoque_total: estoqueDisponivel
    })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao carregar dashboard" })
  }
})

app.get("/admin/produtos", autenticarSupabase, somenteAdminSupabase, async (req, res) => {
  try {
    const { data, error } = await carregarProdutosComEstoque({
      orderBy: "created_at",
      orderDirection: "desc"
    })

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data || [])
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar produtos do admin" })
  }
})

app.post("/admin/produtos", autenticarSupabase, somenteAdminSupabase, async (req, res) => {
  try {
    const nome = req.body.nome ?? req.body.name
    const slugInput = req.body.slug
    const categoria = normalizarCategoria(req.body.categoria ?? req.body.category ?? req.body.type)
    const descricao = req.body.descricao ?? req.body.description ?? null
    const bannerUrl = req.body.banner_url ?? req.body.bannerUrl ?? req.body.image_url ?? null
    const preco = Number(req.body.preco ?? req.body.price ?? 0)
    const precoPromocional = normalizarPrecoPromocional(preco, req.body.preco_promocional ?? req.body.precoPromocional)
    const quantidade = req.body.quantidade ?? req.body.quantity ?? 0
    const ativo = normalizarBoolean(req.body.ativo, true)
    const destaque = normalizarBoolean(req.body.destaque, false)

    if (!nome || preco === undefined || Number.isNaN(preco)) {
      return res.status(400).json({ erro: "Nome e preço são obrigatórios" })
    }

    const slugFinal = slugInput ? gerarSlug(slugInput) : gerarSlug(nome)
    const quantidadeNumero = Math.max(Number(quantidade || 0), 0)

    const { data, error } = await supabase
      .from("products")
      .insert([{
        nome,
        slug: slugFinal || null,
        categoria,
        descricao,
        banner_url: bannerUrl || null,
        preco,
        preco_promocional: precoPromocional,
        quantidade: quantidadeNumero,
        ativo,
        destaque,
        total_vendas: 0
      }])
      .select()

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao criar produto" })
  }
})
app.put("/admin/produtos/:id", autenticarSupabase, somenteAdminSupabase, async (req, res) => {
  try {
    const { id } = req.params

    const atualizacao = {}

    if (req.body.nome !== undefined || req.body.name !== undefined) {
      const nome = req.body.nome ?? req.body.name
      if (!nome) {
        return res.status(400).json({ erro: "Nome é obrigatório" })
      }
      atualizacao.nome = nome
    }

    if (req.body.slug !== undefined) {
      atualizacao.slug = req.body.slug ? gerarSlug(req.body.slug) : null
    }

    if (req.body.categoria !== undefined || req.body.category !== undefined || req.body.type !== undefined) {
      atualizacao.categoria = normalizarCategoria(req.body.categoria ?? req.body.category ?? req.body.type)
    }

    if (req.body.descricao !== undefined || req.body.description !== undefined) {
      atualizacao.descricao = req.body.descricao ?? req.body.description ?? null
    }

    if (req.body.banner_url !== undefined || req.body.bannerUrl !== undefined || req.body.image_url !== undefined) {
      atualizacao.banner_url = req.body.banner_url ?? req.body.bannerUrl ?? req.body.image_url ?? null
    }

    if (req.body.preco !== undefined || req.body.price !== undefined) {
      const preco = Number(req.body.preco ?? req.body.price)
      if (Number.isNaN(preco)) {
        return res.status(400).json({ erro: "Preço inválido" })
      }
      atualizacao.preco = preco
      const promo = normalizarPrecoPromocional(preco, req.body.preco_promocional ?? req.body.precoPromocional)
      atualizacao.preco_promocional = promo
    } else if (req.body.preco_promocional !== undefined || req.body.precoPromocional !== undefined) {
      const precoBase = Number(req.body.preco_base ?? req.body.preco ?? req.body.price ?? 0)
      atualizacao.preco_promocional = normalizarPrecoPromocional(precoBase, req.body.preco_promocional ?? req.body.precoPromocional)
    }

    if (req.body.quantidade !== undefined || req.body.quantity !== undefined) {
      const quantidade = Math.max(Number(req.body.quantidade ?? req.body.quantity ?? 0), 0)
      atualizacao.quantidade = quantidade
    }

    if (req.body.ativo !== undefined) {
      atualizacao.ativo = normalizarBoolean(req.body.ativo, true)
    }

    if (req.body.destaque !== undefined) {
      atualizacao.destaque = normalizarBoolean(req.body.destaque, false)
    }

    if (!Object.keys(atualizacao).length) {
      return res.status(400).json({ erro: "Nenhum campo para atualizar" })
    }

    const { data, error } = await supabase
      .from("products")
      .update(atualizacao)
      .eq("id", id)
      .select()

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao atualizar produto" })
  }
})

app.delete("/admin/produtos/:id", autenticarSupabase, somenteAdminSupabase, async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await supabase
      .from("products")
      .update({ ativo: false })
      .eq("id", id)
      .select()

    if (error) return res.status(500).json({ erro: error.message })

    res.json({ sucesso: true, produto: data?.[0] || null })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao inativar produto" })
  }
})

app.get("/admin/pedidos", autenticarSupabase, somenteAdminSupabase, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        *,
        order_items (*, products (nome, name, banner_url, preco, preco_promocional)),
        payments (*)
      `)
      .order("created_at", { ascending: false })

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data || [])
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar pedidos" })
  }
})
app.get("/admin/estoque", autenticarSupabase, somenteAdminSupabase, async (req, res) => {
  try {
    const produtoFiltro = String(req.query.product_id || req.query.produto || "").trim()

    let query = supabase
      .from("inventory_items")
      .select("*")

    if (produtoFiltro) {
      query = query.eq("product_id", produtoFiltro)
    }

    const { data: estoque, error: erroEstoque } = await query
      .order("created_at", { ascending: false })

    if (erroEstoque) return res.status(500).json({ erro: erroEstoque.message })

    const { data: produtos, error: erroProdutos } = await supabase
      .from("products")
      .select("id, nome, name")

    if (erroProdutos) return res.status(500).json({ erro: erroProdutos.message })

    const produtosMap = new Map(
      (produtos || []).map((produto) => [produto.id, produto.nome || produto.name])
    )

    const resposta = (estoque || []).map((item) => ({
      ...item,
      status: normalizarStatusEstoque(item.status),
      product_name: produtosMap.get(item.product_id) || null
    }))

    res.json(resposta)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao carregar estoque" })
  }
})

app.post("/admin/estoque", autenticarSupabase, somenteAdminSupabase, async (req, res) => {
  try {
    const {
      product_id,
      content_login,
      content_password,
      content_extra,
      status
    } = req.body

    if (!product_id || !content_login || !content_password) {
      return res.status(400).json({ erro: "Produto, login e senha são obrigatórios" })
    }

    const statusNormalizado = normalizarStatusEstoque(status || "available") || "available"

    const { data, error } = await supabase
      .from("inventory_items")
      .insert([{
        product_id,
        content_login,
        content_password,
        content_extra: content_extra || null,
        status: statusNormalizado
      }])
      .select()
      .single()

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao criar item de estoque" })
  }
})

app.put("/admin/estoque/:id", autenticarSupabase, somenteAdminSupabase, async (req, res) => {
  try {
    const { id } = req.params
    const {
      product_id,
      content_login,
      content_password,
      content_extra,
      status
    } = req.body

    const atualizacao = {}

    if (product_id !== undefined) atualizacao.product_id = product_id
    if (content_login !== undefined) atualizacao.content_login = content_login
    if (content_password !== undefined) atualizacao.content_password = content_password
    if (content_extra !== undefined) atualizacao.content_extra = content_extra || null
    if (status !== undefined) {
      atualizacao.status = normalizarStatusEstoque(status || "available") || "available"
    }

    if (!Object.keys(atualizacao).length) {
      return res.status(400).json({ erro: "Nenhum campo para atualizar" })
    }

    const { data, error } = await supabase
      .from("inventory_items")
      .update(atualizacao)
      .eq("id", id)
      .select()
      .single()

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao atualizar estoque" })
  }
})

app.delete("/admin/estoque/:id", autenticarSupabase, somenteAdminSupabase, async (req, res) => {
  try {
    const { id } = req.params

    const { error } = await supabase
      .from("inventory_items")
      .delete()
      .eq("id", id)

    if (error) return res.status(500).json({ erro: error.message })

    res.json({ sucesso: true })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao deletar item de estoque" })
  }
})

app.get("/cliente/pedidos", autenticarSupabase, somenteClienteSupabase, async (req, res) => {
  try {
    const email = normalizarEmail(req.usuario?.email || "")

    if (!email) {
      return res.status(400).json({ erro: "Email do cliente não encontrado" })
    }

    const { data, error } = await supabase
      .from("orders")
      .select(`
        *,
        order_items (*, products (nome, name, banner_url, preco, preco_promocional))
      `)
      .ilike("customer_email", email)
      .order("created_at", { ascending: false })

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data || [])
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar pedidos do cliente" })
  }
})

app.post("/pedidos", rateLimitPedidos, async (req, res) => {
  try {
    const { produto_id, nome_cliente, email_cliente } = req.body
    const ip_cliente = obterIp(req)

    if (!produto_id || !nome_cliente || !email_cliente) {
      return res.status(400).json({ erro: "Produto, nome e email são obrigatórios" })
    }

    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({ erro: "Mercado Pago não configurado" })
    }

    const { data: produto, error: erroProduto } = await supabase
      .from("products")
      .select("*")
      .eq("id", produto_id)
      .single()

    if (erroProduto || !produto) {
      return res.status(404).json({ erro: "Produto não encontrado" })
    }

    const nomeProduto = produto.nome ?? produto.name ?? "Produto"
    const precoBase = Number(produto.preco ?? produto.price ?? 0)
    const precoPromocional = normalizarPrecoPromocional(precoBase, produto.preco_promocional ?? produto.precoPromocional)
    const precoFinal = calcularPrecoFinal(precoBase, precoPromocional)
    const quantidadeProduto = produto.quantidade ?? produto.quantity
    const quantidadeNumero =
      quantidadeProduto === null || quantidadeProduto === undefined
        ? null
        : Number(quantidadeProduto)
    const ativoProduto = produto.ativo !== undefined ? Boolean(produto.ativo) : true

    if (!ativoProduto) {
      return res.status(409).json({ erro: "Produto inativo no momento" })
    }

    if (precoBase <= 0 || Number.isNaN(precoBase)) {
      return res.status(400).json({ erro: "Preço inválido do produto" })
    }

    if (quantidadeNumero !== null && (Number.isNaN(quantidadeNumero) || quantidadeNumero <= 0)) {
      return res.status(409).json({ erro: "Produto sem estoque disponível" })
    }

    const { available: estoqueDisponivel, error: erroEstoqueDisponivel } =
      await verificarEstoqueDisponivel(produto.id)

    if (erroEstoqueDisponivel) {
      return res.status(500).json({ erro: "Erro ao verificar estoque" })
    }

    if (!estoqueDisponivel) {
      return res.status(409).json({ erro: "Produto sem estoque disponível" })
    }

    const payloadOrder = {
      user_id: null,
      status: "pending",
      total: Number(precoFinal),
      payment_status: "pending",
      customer_name: nome_cliente,
      customer_email: email_cliente
    }

    let { data: orderInserida, error: erroOrder } = await supabase
      .from("orders")
      .insert([payloadOrder])
      .select()
      .single()

    if (erroOrder) {
      const payloadFallback = {
        user_id: null,
        status: "pending",
        total: Number(precoFinal),
        payment_status: "pending"
      }

      const tentativaFallback = await supabase
        .from("orders")
        .insert([payloadFallback])
        .select()
        .single()

      orderInserida = tentativaFallback.data
      erroOrder = tentativaFallback.error
    }

    if (erroOrder || !orderInserida) {
      return res.status(500).json({ erro: erroOrder?.message || "Erro ao criar order" })
    }

    const order = orderInserida

    const { data: orderItemInserido, error: erroOrderItem } = await supabase
      .from("order_items")
      .insert([{
        order_id: order.id,
        product_id: produto.id,
        price: Number(precoFinal),
        quantity: 1,
        delivery_status: "pending",
        delivered_content: null
      }])
      .select()
      .single()

    if (erroOrderItem || !orderItemInserido) {
      return res.status(500).json({ erro: erroOrderItem?.message || "Erro ao criar item do pedido" })
    }

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "X-Idempotency-Key": `order-${order.id}-${Date.now()}`
      },
      body: JSON.stringify({
        transaction_amount: Number(precoFinal),
        description: nomeProduto,
        payment_method_id: "pix",
        notification_url: "https://api.blackouts.site/webhook/mercadopago",
        external_reference: String(order.id),
        payer: {
          email: email_cliente,
          first_name: nome_cliente
        },
        metadata: {
          order_id: String(order.id),
          product_id: String(produto.id),
          nome_cliente,
          email_cliente,
          ip_cliente
        }
      })
    })

    const mpData = await mpResponse.json()

    if (!mpResponse.ok) {
      return res.status(500).json({
        erro: "Erro ao gerar PIX no Mercado Pago",
        detalhe: mpData
      })
    }

    const qrCode = mpData?.point_of_interaction?.transaction_data?.qr_code || null
    const qrCodeBase64 = mpData?.point_of_interaction?.transaction_data?.qr_code_base64 || null

    const { error: erroPagamento } = await supabase
      .from("payments")
      .insert([{
        order_id: order.id,
        provider: "mercadopago",
        provider_payment_id: String(mpData.id),
        status: mpData.status || "pending",
        amount: Number(precoFinal)
      }])

    if (erroPagamento) {
      return res.status(500).json({ erro: erroPagamento.message })
    }

    res.json({
      sucesso: true,
      pedido_id: order.id,
      pagamento_id: mpData.id,
      status: mpData.status,
      pix: {
        qr_code: qrCode,
        qr_code_base64: qrCodeBase64
      },
      entrega_url: `${DELIVERY_BASE_URL}/entrega.html?pedido=${order.id}&email=${encodeURIComponent(email_cliente)}`
    })
  } catch (error) {
    console.log("Erro ao criar pedido com PIX:", error)
    res.status(500).json({ erro: "Erro ao criar pedido com PIX" })
  }
})

app.get("/pedido-status", rateLimitPedidoStatus, async (req, res) => {
  try {
    const pedidoId = String(req.query.pedido || "").trim()
    const emailCliente = normalizarEmail(req.query.email)

    if (!pedidoId) {
      return res.status(400).json({ erro: "Pedido é obrigatório" })
    }

    if (!emailCliente) {
      return res.status(400).json({ erro: "Email é obrigatório" })
    }

    const { data: order, error: erroOrder } = await supabase
      .from("orders")
      .select("*")
      .eq("id", pedidoId)
      .single()

    if (erroOrder || !order) {
      return res.status(404).json({ erro: "Pedido não encontrado" })
    }

    const emailPedido = normalizarEmail(
      order.customer_email || order.email_cliente || order.cliente_email
    )

    if (!emailPedido || emailPedido !== emailCliente) {
      return res.status(403).json({ erro: "Email não confere com o pedido" })
    }

    const { data: orderItem, error: erroOrderItem } = await supabase
      .from("order_items")
      .select(`
        *,
        products (*)
      `)
      .eq("order_id", order.id)
      .limit(1)
      .single()

    if (erroOrderItem || !orderItem) {
      return res.status(404).json({ erro: "Item do pedido não encontrado" })
    }

    const statusPagamento = String(order.payment_status || "").toLowerCase()

    const pago = ["paid", "approved"].includes(statusPagamento)

    let entrega = null

    if (pago && orderItem.delivered_content) {
      try {
        entrega = JSON.parse(orderItem.delivered_content)
      } catch {
        entrega = { conteudo: orderItem.delivered_content }
      }
    }

    res.json({
      pedido: {
        id: order.id,
        status: order.status,
        payment_status: order.payment_status,
        total: order.total,
        criado_em: order.created_at,
        produto_nome: orderItem.products?.nome || orderItem.products?.name || null,
        entregue_em: pago ? order.created_at : null
      },
      entrega
    })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao consultar pedido" })
  }
})

app.post("/webhook/mercadopago", async (req, res) => {
  try {
    console.log("Webhook Mercado Pago recebido:", JSON.stringify(req.body, null, 2))

    const paymentId =
      req.body?.data?.id ||
      req.query?.id ||
      req.body?.id

    if (!paymentId) {
      console.log("paymentId não encontrado no webhook")
      return res.status(200).send("ok")
    }

    if (!MP_ACCESS_TOKEN) {
      console.log("MP_ACCESS_TOKEN não configurado")
      return res.status(500).send("mercado pago nao configurado")
    }

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    })

    const pagamento = await mpResponse.json()

    if (!mpResponse.ok) {
      console.log("Erro ao consultar pagamento no Mercado Pago:", pagamento)
      return res.status(500).send("erro ao consultar pagamento")
    }

    console.log("Pagamento consultado:", pagamento)

    const orderId = String(
      pagamento.external_reference ||
      pagamento.metadata?.order_id ||
      ""
    ).trim()

    if (!orderId) {
      console.log("orderId não encontrado no pagamento")
      return res.status(200).send("ok")
    }

    const { data: paymentRegistro, error: erroBuscaPayment } = await supabase
      .from("payments")
      .select("*")
      .eq("provider_payment_id", String(paymentId))
      .single()

    if (erroBuscaPayment || !paymentRegistro) {
      console.log("Pagamento não encontrado na tabela payments:", erroBuscaPayment)
      return res.status(200).send("ok")
    }

    const agora = new Date().toISOString()

    if (pagamento.status !== "approved") {
      await supabase
        .from("payments")
        .update({
          status: pagamento.status || "pending"
        })
        .eq("id", paymentRegistro.id)

      await supabase
        .from("orders")
        .update({
          payment_status: pagamento.status || "pending"
        })
        .eq("id", orderId)

      console.log("Pagamento ainda não aprovado:", pagamento.status)
      return res.status(200).send("pagamento ainda não aprovado")
    }

    const { data: order, error: erroOrder } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single()

    if (erroOrder || !order) {
      console.log("Order não encontrada:", erroOrder)
      return res.status(200).send("ok")
    }

    const { data: orderItem, error: erroOrderItem } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", order.id)
      .limit(1)
      .single()

    if (erroOrderItem || !orderItem) {
      console.log("Order item não encontrado:", erroOrderItem)
      return res.status(200).send("ok")
    }

    if (String(order.payment_status).toLowerCase() === "paid") {
      console.log("Pedido já estava pago:", order.id)
      return res.status(200).send("ok")
    }

    let contaDisponivel = null
    const reservaAtomica = await reservarItemEstoqueAtomico(orderItem.product_id)

    if (reservaAtomica.error) {
      console.log("Reserva atomica falhou, usando fallback:", reservaAtomica.error.message)
      const reservaFallback = await reservarItemEstoque(orderItem.product_id)

      if (reservaFallback.error) {
        console.log("Erro ao buscar estoque:", reservaFallback.error)
        return res.status(500).send("erro ao buscar estoque")
      }

      contaDisponivel = reservaFallback.data
    } else {
      contaDisponivel = reservaAtomica.data
    }

    if (!contaDisponivel) {
      console.log("Sem estoque para entregar")

      await supabase
        .from("orders")
        .update({
          status: "paid",
          payment_status: "paid"
        })
        .eq("id", order.id)

      await supabase
        .from("payments")
        .update({
          status: "approved"
        })
        .eq("id", paymentRegistro.id)

      console.log("Pagamento aprovado sem estoque:", {
        orderId: order.id,
        paymentId: paymentRegistro.id,
        productId: orderItem.product_id,
        email: order.customer_email || order.email_cliente || order.cliente_email || null
      })

      await registrarAlertaSemEstoque({
        orderId: order.id,
        paymentId: paymentRegistro.id,
        productId: orderItem.product_id,
        email: order.customer_email || order.email_cliente || order.cliente_email || null
      })

      await registrarVendaProduto(orderItem.product_id)

      await convidarClienteSeNecessario({
        email: order.customer_email || order.email_cliente || order.cliente_email || null,
        nome: order.customer_name || order.nome_cliente || order.cliente_nome || null
      })

      return res.status(200).send("ok")
    }

    const deliveredContent = JSON.stringify({
      tipo: "inventory_item",
      inventory_item_id: contaDisponivel.id,
      login: contaDisponivel.content_login,
      senha: contaDisponivel.content_password,
      extra: contaDisponivel.content_extra || null
    })

    const { error: erroAtualizaOrderItem } = await supabase
      .from("order_items")
      .update({
        delivery_status: "delivered",
        delivered_content: deliveredContent
      })
      .eq("id", orderItem.id)

    if (erroAtualizaOrderItem) {
      console.log("Erro ao atualizar order_items:", erroAtualizaOrderItem)
      return res.status(500).send("erro ao atualizar entrega")
    }

    const { error: erroAtualizaOrder } = await supabase
      .from("orders")
      .update({
        status: "paid",
        payment_status: "paid"
      })
      .eq("id", order.id)

    if (erroAtualizaOrder) {
      console.log("Erro ao atualizar orders:", erroAtualizaOrder)
      return res.status(500).send("erro ao atualizar pedido")
    }

    const { error: erroAtualizaPayment } = await supabase
      .from("payments")
      .update({
        status: "approved"
      })
      .eq("id", paymentRegistro.id)

    if (erroAtualizaPayment) {
      console.log("Erro ao atualizar payments:", erroAtualizaPayment)
      return res.status(500).send("erro ao atualizar pagamento")
    }


    await registrarVendaProduto(orderItem.product_id)
    console.log("CONTA ENTREGUE:", contaDisponivel.content_login)

    await convidarClienteSeNecessario({
      email: order.customer_email || order.email_cliente || order.cliente_email || null,
      nome: order.customer_name || order.nome_cliente || order.cliente_nome || null
    })

    return res.status(200).send("ok")
  } catch (error) {
    console.log("Erro webhook:", error)
    return res.status(500).send("erro")
  }
})

app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT)
})














