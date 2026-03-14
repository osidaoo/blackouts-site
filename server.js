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
    { id: usuario.id, papel: usuario.role },
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

function normalizarStatusEstoque(status) {
  const valor = String(status || "").toLowerCase()

  if (["available", "disponivel", "ativo", "livre"].includes(valor)) return "available"
  if (["sold", "vendida", "vendido", "entregue", "used", "usado"].includes(valor)) return "sold"

  return valor
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
      .from("products")
      .select("*")
      .order("name", { ascending: true })

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data || [])
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
      .from("users")
      .select("*")
      .ilike("email", email.trim())
      .single()

    if (error || !data) {
      return res.status(401).json({ erro: "Usuário não encontrado" })
    }

    const senhaValida = await bcrypt.compare(senha, data.password_hash)

    if (!senhaValida) {
      return res.status(401).json({ erro: "Senha inválida" })
    }

    const token = gerarToken(data)

    res.json({
      token,
      usuario: {
        id: data.id,
        nome: data.name,
        email: data.email,
        papel: data.role
      }
    })
  } catch (error) {
    res.status(500).json({ erro: "Erro interno no login" })
  }
})

app.get("/me", autenticarToken, (req, res) => {
  res.json({ usuario: req.usuario })
})

app.get("/admin/dashboard", autenticarToken, somenteAdmin, async (req, res) => {
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
      estoque_disponivel: estoqueDisponivel
    })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao carregar dashboard" })
  }
})

app.get("/admin/produtos", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: true })

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data || [])
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar produtos do admin" })
  }
})

app.post("/admin/produtos", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { name, slug, type, price, description, image_url } = req.body

    if (!name || price === undefined) {
      return res.status(400).json({ erro: "Nome e preço são obrigatórios" })
    }

    const { data, error } = await supabase
      .from("products")
      .insert([{
        name,
        slug: slug || null,
        type: type || "account",
        price: Number(price),
        description: description || null,
        image_url: image_url || null
      }])
      .select()

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao criar produto" })
  }
})

app.put("/admin/produtos/:id", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { name, slug, type, price, description, image_url } = req.body

    if (!name || price === undefined) {
      return res.status(400).json({ erro: "Nome e preço são obrigatórios" })
    }

    const { data, error } = await supabase
      .from("products")
      .update({
        name,
        slug: slug || null,
        type: type || "account",
        price: Number(price),
        description: description || null,
        image_url: image_url || null
      })
      .eq("id", id)
      .select()

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao atualizar produto" })
  }
})

app.delete("/admin/produtos/:id", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", id)

    if (error) return res.status(500).json({ erro: error.message })

    res.json({ sucesso: true })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao deletar produto" })
  }
})

app.get("/admin/pedidos", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        *,
        order_items (*),
        payments (*)
      `)
      .order("created_at", { ascending: false })

    if (error) return res.status(500).json({ erro: error.message })

    res.json(data || [])
  } catch (error) {
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

    const { data: orderInserida, error: erroOrder } = await supabase
      .from("orders")
      .insert([{
        user_id: null,
        status: "pending",
        total: Number(produto.price),
        payment_status: "pending"
      }])
      .select()
      .single()

    if (erroOrder || !orderInserida) {
      return res.status(500).json({ erro: erroOrder?.message || "Erro ao criar order" })
    }

    const order = orderInserida

    const { data: orderItemInserido, error: erroOrderItem } = await supabase
      .from("order_items")
      .insert([{
        order_id: order.id,
        product_id: produto.id,
        price: Number(produto.price),
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
        transaction_amount: Number(produto.price),
        description: produto.name,
        payment_method_id: "pix",
        notification_url: "https://blackouts-site.onrender.com/webhook/mercadopago",
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
        amount: Number(produto.price)
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
      entrega_url: `https://blackouts-site.vercel.app/entrega.html?pedido=${order.id}&email=${encodeURIComponent(email_cliente)}`
    })
  } catch (error) {
    console.log("Erro ao criar pedido com PIX:", error)
    res.status(500).json({ erro: "Erro ao criar pedido com PIX" })
  }
})

app.get("/pedido-status", async (req, res) => {
  try {
    const pedidoId = String(req.query.pedido || "").trim()

    if (!pedidoId) {
      return res.status(400).json({ erro: "Pedido é obrigatório" })
    }

    const { data: order, error: erroOrder } = await supabase
      .from("orders")
      .select("*")
      .eq("id", pedidoId)
      .single()

    if (erroOrder || !order) {
      return res.status(404).json({ erro: "Pedido não encontrado" })
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

    let entrega = null

    if (orderItem.delivered_content) {
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
        produto_nome: orderItem.products?.name || null,
        entregue_em: order.payment_status === "paid" ? order.created_at : null
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

    const { data: itemEstoque, error: erroEstoque } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("product_id", orderItem.product_id)
      .limit(50)

    if (erroEstoque) {
      console.log("Erro ao buscar estoque:", erroEstoque)
      return res.status(500).send("erro ao buscar estoque")
    }

    const contaDisponivel = (itemEstoque || []).find(
      (item) => normalizarStatusEstoque(item.status) === "available"
    )

    if (!contaDisponivel) {
      console.log("Sem estoque para entregar")
      return res.status(200).send("ok")
    }

    const deliveredContent = JSON.stringify({
      tipo: "inventory_item",
      inventory_item_id: contaDisponivel.id,
      login: contaDisponivel.content_login,
      senha: contaDisponivel.content_password,
      extra: contaDisponivel.content_extra || null
    })

    const { error: erroAtualizaEstoque } = await supabase
      .from("inventory_items")
      .update({
        status: "sold"
      })
      .eq("id", contaDisponivel.id)

    if (erroAtualizaEstoque) {
      console.log("Erro ao atualizar estoque:", erroAtualizaEstoque)
      return res.status(500).send("erro ao atualizar estoque")
    }

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

    console.log("CONTA ENTREGUE:", contaDisponivel.content_login)

    return res.status(200).send("ok")
  } catch (error) {
    console.log("Erro webhook:", error)
    return res.status(500).send("erro")
  }
})

app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT)
})