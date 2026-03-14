require("dotenv").config()

const express = require("express")
const cors = require("cors")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const { createClient } = require("@supabase/supabase-js")

const app = express()

app.use(cors())
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const PORT = process.env.PORT || 3000
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, papel: usuario.papel },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  )
}

function autenticarToken(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).json({ erro: "Token não enviado" })
  }

  const token = authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({ erro: "Token inválido" })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.usuario = decoded
    next()
  } catch {
    return res.status(401).json({ erro: "Token expirado ou inválido" })
  }
}

function somenteAdmin(req, res, next) {
  const papel = String(req.usuario?.papel || "").toLowerCase()

  if (papel !== "administrador" && papel !== "admin") {
    return res.status(403).json({ erro: "Acesso permitido apenas para administrador" })
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

app.get("/", (req, res) => {
  res.json({ status: "API Blackouts online" })
})

app.get("/teste-login", (req, res) => {
  res.json({ rota: "/login ativa", metodo: "POST" })
})

app.get("/produtos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("produtos")
      .select("*")
      .order("id", { ascending: true })

    if (error) return res.status(500).json({ erro: error.message })
    res.json(data)
  } catch {
    res.status(500).json({ erro: "Erro ao buscar produtos" })
  }
})

app.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body

    if (!email || !senha) {
      return res.status(400).json({ erro: "Email e senha são obrigatórios" })
    }

    const { data, error } = await supabase
      .from("usuarios_admin")
      .select("*")
      .ilike("email", email.trim())
      .single()

    if (error || !data) {
      return res.status(401).json({ erro: "Usuário não encontrado" })
    }

    const senhaValida = await bcrypt.compare(senha, data.senha_hash)

    if (!senhaValida) {
      return res.status(401).json({ erro: "Senha inválida" })
    }

    const token = gerarToken(data)

    res.json({
      token,
      usuario: {
        id: data.id,
        nome: data.nome,
        email: data.email,
        papel: data.papel
      }
    })
  } catch {
    res.status(500).json({ erro: "Erro interno no login" })
  }
})

app.get("/me", autenticarToken, (req, res) => {
  res.json({ usuario: req.usuario })
})

app.get("/admin/dashboard", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { data: produtos, error: erroProdutos } = await supabase.from("produtos").select("*")
    if (erroProdutos) return res.status(500).json({ erro: erroProdutos.message })

    const { data: pedidos, error: erroPedidos } = await supabase.from("pedidos").select("*")
    if (erroPedidos) return res.status(500).json({ erro: erroPedidos.message })

    const hoje = new Date()
    const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())

    const pedidosLista = pedidos || []
    const produtosLista = produtos || []

    const pedidosHoje = pedidosLista.filter((pedido) => {
      if (!pedido.criado_em) return false
      return new Date(pedido.criado_em) >= inicioHoje
    })

    const faturamentoTotal = pedidosLista.reduce((total, pedido) => total + Number(pedido.preco || 0), 0)
    const faturamentoHoje = pedidosHoje.reduce((total, pedido) => total + Number(pedido.preco || 0), 0)
    const estoqueTotal = produtosLista.reduce((total, produto) => total + Number(produto.estoque || 0), 0)

    res.json({
      pedidos_totais: pedidosLista.length,
      faturamento_total: faturamentoTotal,
      pedidos_hoje: pedidosHoje.length,
      faturamento_hoje: faturamentoHoje,
      produtos_totais: produtosLista.length,
      estoque_total: estoqueTotal
    })
  } catch {
    res.status(500).json({ erro: "Erro ao carregar dashboard" })
  }
})

app.get("/admin/produtos", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from("produtos").select("*").order("id", { ascending: true })
    if (error) return res.status(500).json({ erro: error.message })
    res.json(data)
  } catch {
    res.status(500).json({ erro: "Erro ao buscar produtos do admin" })
  }
})

app.post("/admin/produtos", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { nome, preco, estoque } = req.body

    if (!nome || preco === undefined || estoque === undefined) {
      return res.status(400).json({ erro: "Nome, preço e estoque são obrigatórios" })
    }

    const { data, error } = await supabase
      .from("produtos")
      .insert([{ nome, preco: Number(preco), estoque: Number(estoque) }])
      .select()

    if (error) return res.status(500).json({ erro: error.message })
    res.json(data)
  } catch {
    res.status(500).json({ erro: "Erro ao criar produto" })
  }
})

app.put("/admin/produtos/:id", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { nome, preco, estoque } = req.body

    if (!nome || preco === undefined || estoque === undefined) {
      return res.status(400).json({ erro: "Nome, preço e estoque são obrigatórios" })
    }

    const { data, error } = await supabase
      .from("produtos")
      .update({ nome, preco: Number(preco), estoque: Number(estoque) })
      .eq("id", id)
      .select()

    if (error) return res.status(500).json({ erro: error.message })
    res.json(data)
  } catch {
    res.status(500).json({ erro: "Erro ao atualizar produto" })
  }
})

app.delete("/admin/produtos/:id", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await supabase.from("produtos").delete().eq("id", id)
    if (error) return res.status(500).json({ erro: error.message })
    res.json({ sucesso: true })
  } catch {
    res.status(500).json({ erro: "Erro ao deletar produto" })
  }
})

app.get("/admin/pedidos", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .order("criado_em", { ascending: false })

    if (error) return res.status(500).json({ erro: error.message })
    res.json(data)
  } catch {
    res.status(500).json({ erro: "Erro ao buscar pedidos" })
  }
})

app.post("/pedidos", async (req, res) => {
  try {
    const { produto_id, nome_cliente, email_cliente } = req.body
    const ip_cliente = obterIp(req)

    if (!produto_id || !nome_cliente || !email_cliente) {
      return res.status(400).json({ erro: "Produto, nome e email são obrigatórios" })
    }

    const { data: produto, error: erroProduto } = await supabase
      .from("produtos")
      .select("*")
      .eq("id", produto_id)
      .single()

    if (erroProduto || !produto) {
      return res.status(404).json({ erro: "Produto não encontrado" })
    }

    const { data: pedidoInserido, error: erroPedido } = await supabase
      .from("pedidos")
      .insert([{
        produto_id: produto.id,
        produto_nome: produto.nome,
        preco: Number(produto.preco),
        nome_cliente,
        email_cliente,
        ip_cliente,
        status: "aguardando_pagamento"
      }])
      .select()

    if (erroPedido || !pedidoInserido || !pedidoInserido[0]) {
      return res.status(500).json({ erro: erroPedido?.message || "Erro ao criar pedido" })
    }

    const pedido = pedidoInserido[0]

    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({ erro: "Mercado Pago não configurado" })
    }

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "X-Idempotency-Key": `pedido-${pedido.id}-${Date.now()}`
      },
      body: JSON.stringify({
        transaction_amount: Number(produto.preco),
        description: produto.nome,
        payment_method_id: "pix",
        notification_url: "https://blackouts-site.onrender.com/webhook/mercadopago",
        payer: {
          email: email_cliente,
          first_name: nome_cliente
        },
        external_reference: String(pedido.id)
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
      .from("pagamentos")
      .insert([{
        pedido_id: pedido.id,
        mp_payment_id: String(mpData.id),
        status: mpData.status || "pending",
        qr_code: qrCode,
        qr_code_base64: qrCodeBase64,
        valor: Number(produto.preco),
        detalhe_status: mpData.status_detail || null
      }])

    if (erroPagamento) {
      return res.status(500).json({ erro: erroPagamento.message })
    }

    res.json({
      sucesso: true,
      pedido_id: pedido.id,
      pagamento_id: mpData.id,
      status: mpData.status,
      pix: {
        qr_code: qrCode,
        qr_code_base64: qrCodeBase64
      },
      entrega_url: `https://blackouts-site.vercel.app/entrega.html?pedido=${pedido.id}&email=${encodeURIComponent(email_cliente)}`
    })
  } catch {
    res.status(500).json({ erro: "Erro ao criar pedido com PIX" })
  }
})

app.get("/pedido-status", async (req, res) => {
  try {
    const pedidoId = Number(req.query.pedido)
    const email = String(req.query.email || "").trim().toLowerCase()

    if (!pedidoId || !email) {
      return res.status(400).json({ erro: "Pedido e email são obrigatórios" })
    }

    const { data: pedido, error: erroPedido } = await supabase
      .from("pedidos")
      .select("*")
      .eq("id", pedidoId)
      .ilike("email_cliente", email)
      .single()

    if (erroPedido || !pedido) {
      return res.status(404).json({ erro: "Pedido não encontrado" })
    }

    let entrega = null

    if (pedido.conta_entregue_id) {
      const { data: conta } = await supabase
        .from("contas_digitais")
        .select("id, login, senha, status")
        .eq("id", pedido.conta_entregue_id)
        .single()

      if (conta) entrega = conta
    }

    res.json({
      pedido: {
        id: pedido.id,
        status: pedido.status,
        produto_nome: pedido.produto_nome,
        preco: pedido.preco,
        criado_em: pedido.criado_em,
        payment_id_externo: pedido.payment_id_externo || null,
        entregue_em: pedido.entregue_em || null
      },
      entrega
    })
  } catch {
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

    if (pagamento.status !== "approved") {
      console.log("Pagamento ainda não aprovado:", pagamento.status)
      return res.status(200).send("pagamento ainda não aprovado")
    }

    const pedidoId = Number(pagamento.external_reference)

    if (!pedidoId) {
      console.log("external_reference inválido:", pagamento.external_reference)
      return res.status(200).send("ok")
    }

    const { data: pedido, error: erroPedido } = await supabase
      .from("pedidos")
      .select("*")
      .eq("id", pedidoId)
      .single()

    if (erroPedido || !pedido) {
      console.log("Pedido não encontrado:", erroPedido)
      return res.status(200).send("ok")
    }

    if (pedido.status === "pago") {
      console.log("Pedido já estava pago:", pedido.id)
      return res.status(200).send("ok")
    }

    const { data: conta, error: erroConta } = await supabase
      .from("contas_digitais")
      .select("*")
      .eq("produto_id", pedido.produto_id)
      .eq("status", "disponivel")
      .order("id", { ascending: true })
      .limit(1)
      .single()

    if (erroConta || !conta) {
      console.log("Sem estoque para entregar:", erroConta)
      return res.status(200).send("ok")
    }

    const { error: erroAtualizaConta } = await supabase
      .from("contas_digitais")
      .update({
        status: "vendida",
        pedido_id: pedido.id
      })
      .eq("id", conta.id)

    if (erroAtualizaConta) {
      console.log("Erro ao atualizar conta:", erroAtualizaConta)
      return res.status(500).send("erro ao atualizar conta")
    }

    const agora = new Date().toISOString()

    const { error: erroAtualizaPedido } = await supabase
      .from("pedidos")
      .update({
        status: "pago",
        conta_entregue_id: conta.id,
        payment_id_externo: String(paymentId),
        entregue_em: agora
      })
      .eq("id", pedido.id)

    if (erroAtualizaPedido) {
      console.log("Erro ao atualizar pedido:", erroAtualizaPedido)
      return res.status(500).send("erro ao atualizar pedido")
    }

    const { error: erroAtualizaPagamento } = await supabase
      .from("pagamentos")
      .update({
        status: "approved",
        webhook_recebido: true,
        pago_em: agora,
        detalhe_status: pagamento.status_detail || null
      })
      .eq("mp_payment_id", String(paymentId))

    if (erroAtualizaPagamento) {
      console.log("Erro ao atualizar pagamento:", erroAtualizaPagamento)
      return res.status(500).send("erro ao atualizar pagamento")
    }

    console.log("CONTA ENTREGUE:", conta.login)

    return res.status(200).send("ok")
  } catch (error) {
    console.log("Erro webhook:", error)
    return res.status(500).send("erro")
  }
})

app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT)
})