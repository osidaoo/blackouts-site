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
    {
      id: usuario.id,
      papel: usuario.papel
    },
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
  } catch (error) {
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

app.get("/", (req, res) => {
  res.json({ status: "API Blackouts online" })
})

app.get("/teste-login", (req, res) => {
  res.json({
    rota: "/login ativa",
    metodo: "POST"
  })
})

app.get("/debug/admin", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("usuarios_admin")
      .select("id, nome, email, papel")
      .order("id", { ascending: true })

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao listar admins" })
  }
})

app.get("/produtos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("produtos")
      .select("*")
      .order("id", { ascending: true })

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json(data)
  } catch (error) {
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
  } catch (error) {
    res.status(500).json({ erro: "Erro interno no login" })
  }
})

app.get("/me", autenticarToken, (req, res) => {
  res.json({
    usuario: req.usuario
  })
})

app.get("/admin/dashboard", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { data: produtos, error: erroProdutos } = await supabase
      .from("produtos")
      .select("*")

    if (erroProdutos) {
      return res.status(500).json({ erro: erroProdutos.message })
    }

    const { data: pedidos, error: erroPedidos } = await supabase
      .from("pedidos")
      .select("*")

    if (erroPedidos) {
      return res.status(500).json({ erro: erroPedidos.message })
    }

    const hoje = new Date()
    const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())

    const pedidosLista = pedidos || []
    const produtosLista = produtos || []

    const pedidosHoje = pedidosLista.filter((pedido) => {
      if (!pedido.criado_em) return false
      return new Date(pedido.criado_em) >= inicioHoje
    })

    const faturamentoTotal = pedidosLista.reduce((total, pedido) => {
      return total + Number(pedido.preco || 0)
    }, 0)

    const faturamentoHoje = pedidosHoje.reduce((total, pedido) => {
      return total + Number(pedido.preco || 0)
    }, 0)

    const estoqueTotal = produtosLista.reduce((total, produto) => {
      return total + Number(produto.estoque || 0)
    }, 0)

    res.json({
      pedidos_totais: pedidosLista.length,
      faturamento_total: faturamentoTotal,
      pedidos_hoje: pedidosHoje.length,
      faturamento_hoje: faturamentoHoje,
      produtos_totais: produtosLista.length,
      estoque_total: estoqueTotal
    })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao carregar dashboard" })
  }
})

app.get("/admin/produtos", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("produtos")
      .select("*")
      .order("id", { ascending: true })

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json(data)
  } catch (error) {
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
      .insert([
        {
          nome,
          preco: Number(preco),
          estoque: Number(estoque)
        }
      ])
      .select()

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json(data)
  } catch (error) {
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
      .update({
        nome,
        preco: Number(preco),
        estoque: Number(estoque)
      })
      .eq("id", id)
      .select()

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao atualizar produto" })
  }
})

app.delete("/admin/produtos/:id", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const { error } = await supabase
      .from("produtos")
      .delete()
      .eq("id", id)

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json({ sucesso: true })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao deletar produto" })
  }
})

app.get("/admin/pedidos", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .order("criado_em", { ascending: false })

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar pedidos" })
  }
})

app.get("/admin/contas", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("contas_digitais")
      .select("*")
      .order("id", { ascending: false })

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar contas" })
  }
})

app.post("/admin/contas", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { produto_id, login, senha } = req.body

    if (!produto_id || !login || !senha) {
      return res.status(400).json({ erro: "Produto, login e senha são obrigatórios" })
    }

    const { data, error } = await supabase
      .from("contas_digitais")
      .insert([
        {
          produto_id: Number(produto_id),
          login,
          senha,
          status: "disponivel"
        }
      ])
      .select()

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao cadastrar conta" })
  }
})

app.post("/pedidos", async (req, res) => {
  try {
    const { produto_id, nome_cliente, email_cliente } = req.body

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
      .insert([
        {
          produto_id: produto.id,
          produto_nome: produto.nome,
          preco: Number(produto.preco),
          nome_cliente,
          email_cliente,
          status: "aguardando_pagamento"
        }
      ])
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
      .insert([
        {
          pedido_id: pedido.id,
          mp_payment_id: String(mpData.id),
          status: mpData.status || "pending",
          qr_code: qrCode,
          qr_code_base64: qrCodeBase64,
          valor: Number(produto.preco)
        }
      ])

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
  } catch (error) {
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

      if (conta) {
        entrega = conta
      }
    }

    res.json({
      pedido: {
        id: pedido.id,
        status: pedido.status,
        produto_nome: pedido.produto_nome,
        preco: pedido.preco,
        criado_em: pedido.criado_em
      },
      entrega
    })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao consultar pedido" })
  }
})

app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id

    if (!paymentId) {
      return res.status(200).send("ok")
    }

    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      }
    )

    const pagamento = await mpResponse.json()

    if (pagamento.status !== "approved") {
      return res.status(200).send("ok")
    }

    const pedidoId = Number(pagamento.external_reference)

    if (!pedidoId) {
      return res.status(200).send("ok")
    }

    const { data: pedido } = await supabase
      .from("pedidos")
      .select("*")
      .eq("id", pedidoId)
      .single()

    if (!pedido) {
      return res.status(200).send("ok")
    }

    if (pedido.status === "pago") {
      return res.status(200).send("ok")
    }

    const { data: conta } = await supabase
      .from("contas_digitais")
      .select("*")
      .eq("produto_id", pedido.produto_id)
      .eq("status", "disponivel")
      .order("id", { ascending: true })
      .limit(1)
      .single()

    if (!conta) {
      console.log("SEM ESTOQUE PARA ENTREGAR")
      return res.status(200).send("ok")
    }

    await supabase
      .from("contas_digitais")
      .update({
        status: "vendida",
        pedido_id: pedido.id
      })
      .eq("id", conta.id)

    await supabase
      .from("pedidos")
      .update({
        status: "pago",
        conta_entregue_id: conta.id
      })
      .eq("id", pedido.id)

    await supabase
      .from("pagamentos")
      .update({
        status: "approved"
      })
      .eq("mp_payment_id", String(paymentId))

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